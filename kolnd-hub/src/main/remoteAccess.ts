import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { get as httpsGet } from 'https'
import { Socket, isIP } from 'net'
import { networkInterfaces } from 'os'
import type { NetworkInterfaceInfo } from 'os'
import { join } from 'path'
import { clipboard, shell } from 'electron'
import { getKloudGamesStatus } from './kloudGames'
import { logger } from './logger'
import { getRemoteAccessPrefs, getRemoteMode, setRemoteMode, setRemotePublicIp } from './store'
import {
  KLOUD_TCP_PORTS,
  KLOUD_WEB_URL,
  PUBLIC_IP_ENDPOINT,
  ZEROTIER_DOWNLOAD_URL,
  classifyLocalIPv4,
  comparePublicIp,
  flattenAddresses,
  isIPv4,
  isZeroTierInterfaceName,
  parseZeroTierNetworks,
  parseZeroTierStatus,
  type LocalAddresses,
  type PortTargetResult,
  type PublicIpResult,
  type RemoteActionResult,
  type RemoteModeResult,
  type RemoteStatus,
  type ZeroTierInfo
} from '../shared/remote'

/**
 * Diagnóstico de acesso remoto + instalação/abertura do ZeroTier.
 *
 * Nada aqui abre porta, altera firewall ou cria túnel por conta própria: o Hub
 * apenas LÊ o estado da máquina (`zerotier-cli`, portas TCP locais e
 * interfaces) e executa ações explícitas do usuário (instalar via winget,
 * abrir o app, abrir o painel). A única consulta externa é o IP público, e
 * somente no clique do botão — regra do projeto: nada sai da máquina sozinho.
 * Entrar numa rede é feito no app/painel do ZeroTier, nunca por `join` daqui.
 */

const ZEROTIER_PACKAGE_ID = 'ZeroTier.ZeroTierOne'
const WINGET_TIMEOUT_MS = 10 * 60 * 1000
const STATUS_TIMEOUT_MS = 8000
const PUBLIC_IP_TIMEOUT_MS = 6000
const PROBE_TIMEOUT_MS = 700
const MAX_ERROR_LENGTH = 300

/** Nomes que o instalador oficial do ZeroTier usa para o CLI/GUI no Windows. */
const CLI_FILE_NAMES = ['zerotier-cli.bat', 'zerotier-cli.cmd', 'zerotier-cli.exe', 'zerotier-cli']
const GUI_FILE_NAME = 'zerotier_desktop_ui.exe'

/** Erros de privilégio do CLI quando o token do serviço não é legível. */
const AUTH_ERROR = /authtoken|authentication token|not readable|insufficient privileges/i

/** Erros de CLI vão para a UI — corta e achata para não vazar lixo/linhas infinitas. */
function conciseError(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text
}

interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
}

/** `execFile` assíncrono com timeout — nunca bloqueia o event loop. */
function execText(
  exe: string,
  args: string[],
  timeoutMs: number,
  verbatim = false
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsVerbatimArguments: verbatim
      },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          error: error ? error.message : undefined
        })
      }
    )
  })
}

/**
 * O CLI oficial no Windows é um `.bat`, que o CreateProcess não executa
 * sozinho. Rodamos via `cmd.exe /c` (assíncrono, sem shell: true implícito);
 * os argumentos são constantes nossas, nunca texto do renderer. `verbatim`
 * evita que o Node escape as aspas do caminho do `.bat`.
 */
export function zeroTierCliInvocation(
  exe: string,
  args: string[]
): { command: string; args: string[]; verbatim: boolean } {
  if (!/\.(bat|cmd)$/i.test(exe)) return { command: exe, args, verbatim: false }
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `"${exe}" ${args.join(' ')}`],
    verbatim: true
  }
}

/**
 * Procura o CLI do ZeroTier nos locais usuais e no PATH. `exists` é injetável
 * para teste (evita tocar no disco real). O instalador oficial coloca os
 * scripts em `Program Files (x86)\ZeroTier\One`; `%ProgramData%` é mantido na
 * lista porque instalações antigas/portáteis podem registrar o CLI lá.
 */
export function findZeroTierCli(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  const pathValue = env.PATH ?? env.Path ?? ''
  const roots = [
    env.ProgramData ? join(env.ProgramData, 'ZeroTier', 'One') : null,
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'ZeroTier', 'One') : null,
    env.ProgramFiles ? join(env.ProgramFiles, 'ZeroTier', 'One') : null
  ].filter((root): root is string => root !== null)

  const candidates: Array<string | null | undefined> = [
    env.ZEROTIER_CLI,
    ...roots.flatMap((root) => CLI_FILE_NAMES.map((name) => join(root, name))),
    ...pathValue
      .split(';')
      .filter(Boolean)
      .flatMap((dir) => CLI_FILE_NAMES.map((name) => join(dir, name)))
  ]

  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate
  }
  return null
}

/** GUI oficial (tray) do ZeroTier — é nela que o usuário entra/ingressa na rede. */
export function findZeroTierGui(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  const roots = [
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'ZeroTier', 'One') : null,
    env.ProgramFiles ? join(env.ProgramFiles, 'ZeroTier', 'One') : null
  ]
  for (const root of roots) {
    if (!root) continue
    const candidate = join(root, GUI_FILE_NAME)
    if (exists(candidate)) return candidate
  }
  return null
}

/**
 * Token do usuário copiado pelo instalador (`%LOCALAPPDATA%\ZeroTier`). O
 * serviço trava o token em `%ProgramData%` para Administradores; sem ele o CLI
 * só funciona elevado. Lemos o arquivo com `readFile` assíncrono e validamos o
 * formato antes de usar (nunca vai para log).
 */
async function readZeroTierAuthToken(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const candidates = [
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'ZeroTier', 'authtoken.secret') : null,
    env.ProgramData ? join(env.ProgramData, 'ZeroTier', 'One', 'authtoken.secret') : null
  ]

  for (const path of candidates) {
    if (!path) continue
    try {
      const token = (await readFile(path, 'utf8')).trim()
      // O ZeroTier gera 24 caracteres alfanuméricos; qualquer outra coisa é lixo.
      if (/^[A-Za-z0-9]{16,64}$/.test(token)) return token
    } catch {
      // Arquivo ausente/sem permissão: tenta o próximo.
    }
  }
  return null
}

/**
 * Roda o CLI. Se a consulta falhar por falta de token (caso comum sem UAC),
 * repete uma única vez com `-T<token do usuário>` — a alternativa sancionada
 * pelo ZeroTier para ferramentas não elevadas.
 */
async function runZeroTierCli(exePath: string, args: string[]): Promise<ExecResult> {
  const firstArgs = zeroTierCliInvocation(exePath, args)
  const first = await execText(
    firstArgs.command,
    firstArgs.args,
    STATUS_TIMEOUT_MS,
    firstArgs.verbatim
  )
  if (first.ok || !AUTH_ERROR.test(`${first.stderr} ${first.stdout}`)) return first

  const token = await readZeroTierAuthToken()
  if (!token) return first

  const retryArgs = zeroTierCliInvocation(exePath, [`-T${token}`, ...args])
  return execText(retryArgs.command, retryArgs.args, STATUS_TIMEOUT_MS, retryArgs.verbatim)
}

/** Extrai o JSON mesmo quando o CLI imprime avisos antes (saída suja). */
function parseJsonLoose(text: string): unknown {
  const start = text.search(/[[{]/)
  if (start < 0) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

/** Dicas de interface/endereço usadas para separar VPN de LAN (coleta no main). */
export interface ZeroTierNetworkHints {
  devices?: readonly string[]
  addresses?: readonly string[]
}

interface ZeroTierProbe {
  info: ZeroTierInfo
  hints: ZeroTierNetworkHints
}

/** Lê info + redes numa tacada só; nunca rejeita — erro vira `error` no objeto. */
async function readZeroTierProbe(): Promise<ZeroTierProbe> {
  const exePath = findZeroTierCli()
  const empty = parseZeroTierStatus(null, null)
  if (!exePath) {
    return { info: { installed: false, ...empty, exePath: null }, hints: {} }
  }

  const [infoResult, networksResult] = await Promise.all([
    runZeroTierCli(exePath, ['-j', 'info']),
    runZeroTierCli(exePath, ['-j', 'listnetworks'])
  ])

  const networksRaw = parseJsonLoose(networksResult.stdout)
  const parsed = parseZeroTierStatus(parseJsonLoose(infoResult.stdout), networksRaw)
  const networks = parseZeroTierNetworks(networksRaw)
  const hints: ZeroTierNetworkHints = {
    devices: networks.flatMap((network) => (network.deviceName ? [network.deviceName] : [])),
    addresses: networks.flatMap((network) => network.assigned)
  }

  const info: ZeroTierInfo = { installed: true, ...parsed, exePath }
  const failure = [infoResult, networksResult].find((result) => !result.ok)
  if (failure) {
    const detail = failure.stderr || failure.error || 'não foi possível consultar o serviço'
    info.error = conciseError(detail)
    logger.info('remote-access', 'zerotier-cli falhou:', info.error)
  }

  return { info, hints }
}

/** Status do ZeroTier; nunca rejeita — erro vira `error` no objeto. */
export async function getZeroTierInfo(): Promise<ZeroTierInfo> {
  return (await readZeroTierProbe()).info
}

/**
 * Lê as interfaces da máquina e separa LAN / ZeroTier / IPv6 global. Os nomes
 * e endereços da VPN vêm injetados (o `shared/` não toca em `os`/`net`).
 */
export function collectLocalAddresses(
  nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
  zerotier: ZeroTierNetworkHints = {}
): LocalAddresses {
  const lan = new Set<string>()
  const vpn = new Set<string>()
  const ipv6 = new Set<string>()
  const zerotierDevices = zerotier.devices ?? []
  const zerotierAddresses = zerotier.addresses ?? []

  for (const [name, entries] of Object.entries(nets)) {
    const vpnInterface = isZeroTierInterfaceName(name, zerotierDevices)
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue
      const family = String(entry.family)
      if (family === 'IPv4') {
        const kind = classifyLocalIPv4(entry.address, {
          interfaceName: name,
          zerotierDevices,
          zerotierAddresses
        })
        if (kind === 'zerotier') vpn.add(entry.address)
        else if (kind === 'lan') lan.add(entry.address)
      } else if (family === 'IPv6') {
        // Link-local (`fe80::`) e loopback não servem para acesso remoto.
        if (entry.address.toLowerCase().startsWith('fe80')) continue
        if (entry.address === '::1') continue
        // IPv6 da VPN não entra na lista de "IP global" (o endereço principal
        // já vem do próprio `info`/`listnetworks`).
        if (vpnInterface || zerotierAddresses.includes(entry.address.toLowerCase())) continue
        ipv6.add(entry.address)
      }
    }
  }

  return { lan: [...lan], zerotier: [...vpn], ipv6: [...ipv6] }
}

/** Um TCP connect curto: `true` = alguém escutando no host/porta. */
export function probeTcp(
  host: string,
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    let settled = false
    const finish = (open: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/**
 * Testa as portas do Moonlight em localhost e, quando o ZeroTier está
 * conectado, também no IP da rede (prova que o serviço escuta nessa
 * interface; o firewall ainda pode bloquear outra máquina).
 */
export async function checkKloudPorts(zerotierIpv4: string | null): Promise<PortTargetResult[]> {
  const targets: Array<{ target: 'localhost' | 'zerotier'; host: string }> = [
    { target: 'localhost', host: '127.0.0.1' }
  ]
  if (isIPv4(zerotierIpv4) && zerotierIpv4 !== null && zerotierIpv4 !== '127.0.0.1') {
    targets.push({ target: 'zerotier', host: zerotierIpv4 })
  }

  return Promise.all(
    targets.map(async ({ target, host }) => ({
      target,
      host,
      probes: await Promise.all(
        KLOUD_TCP_PORTS.map(async (port) => ({ port, open: await probeTcp(host, port) }))
      )
    }))
  )
}

/** Fotografia completa usada pela seção "Acesso remoto". */
export async function getRemoteStatus(): Promise<RemoteStatus> {
  const zerotierPromise = readZeroTierProbe()
  const kloudPromise = getKloudGamesStatus().catch((err: unknown) => {
    logger.error('remote-access', 'Falha ao ler o status do Kloud Games:', err)
    return null
  })

  const [probe, kloud] = await Promise.all([zerotierPromise, kloudPromise])
  const addresses = collectLocalAddresses(undefined, probe.hints)
  const ports = await checkKloudPorts(probe.info.ipv4)
  const prefs = getRemoteAccessPrefs()
  const kind = prefs.lastPublicIp
    ? comparePublicIp(prefs.lastPublicIp, flattenAddresses(addresses))
    : 'unknown'

  return {
    zerotier: probe.info,
    addresses,
    kloud: { installed: kloud?.installed ?? false, running: kloud?.running ?? false },
    ports,
    publicIp: {
      address: prefs.lastPublicIp,
      checkedAt: prefs.lastPublicIpCheckedAt,
      kind
    }
  }
}

/**
 * Liga/desliga o "Modo remoto" do card do Kloud Games.
 *
 * Só liga com o ZeroTier instalado E conectado (serviço on-line + rede com
 * endereço) — o Hub não finge um túnel que não existe. Desligar não derruba o
 * ZeroTier (o usuário pode usá-lo para outras coisas); apenas tira o Hub do
 * estado "remoto".
 */
export async function requestRemoteMode(
  value: unknown,
  getInfo: () => Promise<ZeroTierInfo> = getZeroTierInfo
): Promise<RemoteModeResult> {
  if (typeof value !== 'boolean') {
    return {
      success: false,
      enabled: getRemoteMode(),
      reason: 'invalid',
      error: 'Valor inválido para o modo remoto.'
    }
  }

  if (!value) {
    const saved = setRemoteMode(false)
    if (!saved.success) {
      return {
        success: false,
        enabled: false,
        reason: 'store-unavailable',
        error: saved.error
      }
    }
    return { success: true, enabled: false }
  }

  const info = await getInfo()
  if (!info.installed) {
    return {
      success: false,
      enabled: false,
      reason: 'zerotier-missing',
      error: 'Instale o ZeroTier para usar o modo remoto.'
    }
  }
  if (!info.connected) {
    return {
      success: false,
      enabled: false,
      reason: 'zerotier-disconnected',
      error: info.online
        ? 'Ingresse em uma rede do ZeroTier (e aguarde o status OK) antes de ativar o modo remoto.'
        : 'Abra o ZeroTier e conecte-se à sua rede antes de ativar o modo remoto.'
    }
  }

  const saved = setRemoteMode(true)
  if (!saved.success) {
    return {
      success: false,
      enabled: false,
      reason: 'store-unavailable',
      error: saved.error
    }
  }

  const address = info.ipv4 ?? info.ipv6
  logger.info('remote-access', `modo remoto ativado (${address ?? 'sem endereço'})`)
  return { success: true, enabled: true, address }
}

/**
 * Consulta o IP público no endpoint divulgado na UI. Só roda por clique.
 * Persiste o último resultado para a tela não precisar consultar de novo.
 */
export function fetchPublicIp(): Promise<PublicIpResult> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: PublicIpResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    logger.info('remote-access', 'consultando IP público (ação explícita do usuário)')

    const req = httpsGet(
      PUBLIC_IP_ENDPOINT,
      { timeout: PUBLIC_IP_TIMEOUT_MS, headers: { accept: 'application/json' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          finish({ success: false, error: `Serviço respondeu HTTP ${res.statusCode}.` })
          return
        }

        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
          if (body.length > 4096) {
            req.destroy()
            finish({ success: false, error: 'Resposta inesperada do serviço de IP.' })
          }
        })
        res.on('error', (err) => finish({ success: false, error: conciseError(err.message) }))
        res.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(body)
            const ip =
              parsed && typeof parsed === 'object' && 'ip' in parsed
                ? String((parsed as { ip: unknown }).ip)
                : ''
            if (isIP(ip) === 0) {
              finish({ success: false, error: 'O serviço não devolveu um IP válido.' })
              return
            }

            const kind = comparePublicIp(ip, flattenAddresses(collectLocalAddresses()))
            const checkedAt = new Date().toISOString()
            setRemotePublicIp(ip, checkedAt)
            finish({ success: true, ip, kind, checkedAt })
          } catch {
            finish({ success: false, error: 'Não foi possível interpretar a resposta.' })
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy()
      finish({ success: false, error: 'Tempo esgotado ao consultar o IP público.' })
    })
    req.on('error', (err) => finish({ success: false, error: conciseError(err.message) }))
  })
}

/** Instala o ZeroTier via winget (abre UAC). Idempotente. */
export async function installZeroTier(): Promise<RemoteActionResult> {
  if (findZeroTierCli()) return { success: true, installedNow: false }

  // Checagem assíncrona: `winget --version` responde rápido, mas não pode
  // bloquear o event loop do main (regra do projeto).
  const winget = await execText('winget', ['--version'], 5000)
  if (!winget.ok) {
    return {
      success: false,
      error: `winget não encontrado. Baixe o ZeroTier em ${ZEROTIER_DOWNLOAD_URL}`
    }
  }

  logger.info('remote-access', 'instalando ZeroTier via winget')
  const result = await execText(
    'winget',
    [
      'install',
      '--id',
      ZEROTIER_PACKAGE_ID,
      '--exact',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ],
    WINGET_TIMEOUT_MS
  )

  // O winget pode sair != 0 mesmo instalando (ex.: reboot pendente) — o que
  // vale é o executável existir depois.
  if (findZeroTierCli()) {
    logger.info('remote-access', 'ZeroTier instalado')
    return { success: true, installedNow: true }
  }

  const detail = result.stderr || result.stdout || result.error || 'winget falhou'
  return { success: false, error: conciseError(detail) }
}

/**
 * Abre o ZeroTier. Instalado → GUI oficial (é nela que se entra na conta e se
 * ingressa na rede); sem GUI → página oficial de download.
 */
export async function openZeroTier(): Promise<RemoteActionResult> {
  const gui = findZeroTierGui()
  if (!gui) {
    await shell.openExternal(ZEROTIER_DOWNLOAD_URL)
    return { success: true, opened: 'download' }
  }

  const error = await shell.openPath(gui)
  if (error) return { success: false, error: conciseError(error) }
  return { success: true, opened: 'app' }
}

/** Abre o painel web do Kloud Games (onde se digita o PIN do Moonlight). */
export async function openKloudWebPanel(): Promise<RemoteActionResult> {
  try {
    await shell.openExternal(KLOUD_WEB_URL)
    return { success: true, opened: 'web' }
  } catch (err) {
    return {
      success: false,
      error: conciseError(err instanceof Error ? err.message : String(err))
    }
  }
}

/** Copia um texto curto (IP) para a área de transferência. */
export function copyRemoteText(text: unknown): { success: boolean; error?: string } {
  if (typeof text !== 'string' || text.length === 0 || text.length > 512) {
    return { success: false, error: 'Texto inválido para copiar.' }
  }
  clipboard.writeText(text)
  return { success: true }
}
