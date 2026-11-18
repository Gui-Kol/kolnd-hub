import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { get as httpsGet } from 'https'
import { Socket, isIP } from 'net'
import { networkInterfaces } from 'os'
import type { NetworkInterfaceInfo } from 'os'
import { dirname, join } from 'path'
import { clipboard, shell } from 'electron'
import { getKloudGamesStatus } from './kloudGames'
import { logger } from './logger'
import { getRemoteAccessPrefs, setRemotePublicIp } from './store'
import {
  KLOUD_TCP_PORTS,
  KLOUD_WEB_URL,
  PUBLIC_IP_ENDPOINT,
  TAILSCALE_DOWNLOAD_URL,
  classifyLocalIPv4,
  comparePublicIp,
  flattenAddresses,
  isIPv4,
  parseTailscaleStatus,
  type LocalAddresses,
  type PortTargetResult,
  type PublicIpResult,
  type RemoteActionResult,
  type RemoteStatus,
  type TailscaleInfo
} from '../shared/remote'

/**
 * Diagnóstico de acesso remoto + instalação/abertura do Tailscale.
 *
 * Nada aqui abre porta, altera firewall ou cria túnel por conta própria: o Hub
 * apenas LÊ o estado da máquina (`tailscale status`, portas TCP locais e
 * interfaces) e executa ações explícitas do usuário (instalar via winget,
 * abrir o app, abrir o painel). A única consulta externa é o IP público, e
 * somente no clique do botão — regra do projeto: nada sai da máquina sozinho.
 */

const TAILSCALE_PACKAGE_ID = 'Tailscale.Tailscale'
const WINGET_TIMEOUT_MS = 10 * 60 * 1000
const STATUS_TIMEOUT_MS = 8000
const PUBLIC_IP_TIMEOUT_MS = 6000
const PROBE_TIMEOUT_MS = 700
const MAX_ERROR_LENGTH = 300

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
function execText(exe: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
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
 * Procura o CLI do Tailscale nos locais usuais e no PATH. `exists` é injetável
 * para teste (evita tocar no disco real).
 */
export function findTailscaleExe(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  const pathValue = env.PATH ?? env.Path ?? ''
  const candidates: Array<string | null | undefined> = [
    env.TAILSCALE_EXE,
    env.ProgramFiles ? join(env.ProgramFiles, 'Tailscale', 'tailscale.exe') : null,
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Tailscale', 'tailscale.exe') : null,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Tailscale', 'tailscale.exe') : null,
    ...pathValue
      .split(';')
      .filter(Boolean)
      .map((dir) => join(dir, 'tailscale.exe'))
  ]

  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate
  }
  return null
}

/** Lê as interfaces da máquina e separa LAN / tailnet / IPv6 global. */
export function collectLocalAddresses(
  nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): LocalAddresses {
  const lan = new Set<string>()
  const tailscale = new Set<string>()
  const ipv6 = new Set<string>()

  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal) continue
      const family = String(entry.family)
      if (family === 'IPv4') {
        const kind = classifyLocalIPv4(entry.address)
        if (kind === 'tailscale') tailscale.add(entry.address)
        else if (kind === 'lan') lan.add(entry.address)
      } else if (family === 'IPv6') {
        // Link-local (`fe80::`) não serve para acesso remoto.
        if (entry.address.toLowerCase().startsWith('fe80')) continue
        if (entry.address === '::1') continue
        ipv6.add(entry.address)
      }
    }
  }

  return { lan: [...lan], tailscale: [...tailscale], ipv6: [...ipv6] }
}

/** Status do Tailscale; nunca rejeita — erro vira `error` no objeto. */
export async function getTailscaleInfo(): Promise<TailscaleInfo> {
  const exePath = findTailscaleExe()
  const empty = parseTailscaleStatus(null)
  if (!exePath) {
    return { installed: false, ...empty, exePath: null }
  }

  const result = await execText(exePath, ['status', '--json'], STATUS_TIMEOUT_MS)
  let parsed = parseTailscaleStatus(null)
  const jsonStart = result.stdout.indexOf('{')
  if (jsonStart >= 0) {
    try {
      parsed = parseTailscaleStatus(JSON.parse(result.stdout.slice(jsonStart)))
    } catch {
      // Saída não-JSON (versões antigas/erro de serviço) — mantém o estado neutro.
    }
  }

  const info: TailscaleInfo = { installed: true, ...parsed, exePath }
  if (!result.ok) {
    const detail = result.stderr || result.error || 'não foi possível consultar o serviço'
    info.error = conciseError(detail)
    logger.info('remote-access', 'tailscale status falhou:', info.error)
  }
  return info
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
 * Testa as portas do Moonlight em localhost e, quando o Tailscale está
 * conectado, também no IP da tailnet (prova que o serviço escuta nessa
 * interface; o firewall ainda pode bloquear outra máquina).
 */
export async function checkKloudPorts(tailscaleIpv4: string | null): Promise<PortTargetResult[]> {
  const targets: Array<{ target: 'localhost' | 'tailscale'; host: string }> = [
    { target: 'localhost', host: '127.0.0.1' }
  ]
  if (isIPv4(tailscaleIpv4) && tailscaleIpv4 !== null && tailscaleIpv4 !== '127.0.0.1') {
    targets.push({ target: 'tailscale', host: tailscaleIpv4 })
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
  const tailscalePromise = getTailscaleInfo()
  const kloudPromise = getKloudGamesStatus().catch((err: unknown) => {
    logger.error('remote-access', 'Falha ao ler o status do Kloud Games:', err)
    return null
  })

  const [tailscale, kloud] = await Promise.all([tailscalePromise, kloudPromise])
  const addresses = collectLocalAddresses()
  const ports = await checkKloudPorts(tailscale.ipv4)
  const prefs = getRemoteAccessPrefs()
  const kind = prefs.lastPublicIp
    ? comparePublicIp(prefs.lastPublicIp, flattenAddresses(addresses))
    : 'unknown'

  return {
    tailscale,
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

/** Instala o Tailscale via winget (abre UAC). Idempotente. */
export async function installTailscale(): Promise<RemoteActionResult> {
  if (findTailscaleExe()) return { success: true, installedNow: false }

  // Checagem assíncrona: `winget --version` responde rápido, mas não pode
  // bloquear o event loop do main (regra do projeto).
  const winget = await execText('winget', ['--version'], 5000)
  if (!winget.ok) {
    return {
      success: false,
      error: `winget não encontrado. Baixe o Tailscale em ${TAILSCALE_DOWNLOAD_URL}`
    }
  }

  logger.info('remote-access', 'instalando Tailscale via winget')
  const result = await execText(
    'winget',
    [
      'install',
      '--id',
      TAILSCALE_PACKAGE_ID,
      '--exact',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ],
    WINGET_TIMEOUT_MS
  )

  // O winget pode sair != 0 mesmo instalando (ex.: reboot pendente) — o que
  // vale é o executável existir depois.
  if (findTailscaleExe()) {
    logger.info('remote-access', 'Tailscale instalado')
    return { success: true, installedNow: true }
  }

  const detail = result.stderr || result.stdout || result.error || 'winget falhou'
  return { success: false, error: conciseError(detail) }
}

/**
 * Abre o Tailscale. Instalado → app gráfico (login/MagicDNS sem console);
 * sem app gráfico → `tailscale up` em background; não instalado → download.
 */
export async function openTailscale(): Promise<RemoteActionResult> {
  const exePath = findTailscaleExe()
  if (!exePath) {
    await shell.openExternal(TAILSCALE_DOWNLOAD_URL)
    return { success: true, opened: 'download' }
  }

  const gui = join(dirname(exePath), 'tailscale-ipn.exe')
  if (existsSync(gui)) {
    const error = await shell.openPath(gui)
    if (error) return { success: false, error: conciseError(error) }
    return { success: true, opened: 'app' }
  }

  try {
    const child = spawn(exePath, ['up'], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (err) => {
      logger.error('remote-access', 'falha ao iniciar tailscale up:', err.message)
    })
    child.unref()
    return { success: true, opened: 'login' }
  } catch (err) {
    return {
      success: false,
      error: conciseError(err instanceof Error ? err.message : String(err))
    }
  }
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

/** Copia um texto curto (IP/MagicDNS) para a área de transferência. */
export function copyRemoteText(text: unknown): { success: boolean; error?: string } {
  if (typeof text !== 'string' || text.length === 0 || text.length > 512) {
    return { success: false, error: 'Texto inválido para copiar.' }
  }
  clipboard.writeText(text)
  return { success: true }
}
