import { ipcMain } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import treeKill from 'tree-kill'
import { isWingetAvailable } from './silentInstaller'
import { logger } from './logger'

export interface WingetUpgrade {
  name: string
  id: string
  currentVersion: string
  availableVersion: string
}

export interface WingetListResult {
  ok: boolean
  items?: WingetUpgrade[]
  error?: string
  /** Primeiras linhas da saída do winget — diagnóstico de falha de parse. */
  rawLog?: string
  /** true quando o winget não está disponível/instalado no sistema. */
  wingetMissing?: boolean
}

export interface WingetUpgradeResult {
  ok: boolean
  /** Código de saída; null quando o processo não pôde iniciar ou foi morto por kill/timeout. */
  exitCode: number | null
  /** Últimas ~50 linhas da saída (stdout+stderr), para exibir como detalhe do item. */
  log: string
}

export interface WingetKillResult {
  ok: boolean
  error?: string
}

/** Erro de parse da saída do winget — carrega as primeiras linhas do stdout. */
export class WingetParseError extends Error {
  readonly rawLog: string

  constructor(message: string, rawLog: string) {
    super(message)
    this.name = 'WingetParseError'
    this.rawLog = rawLog
  }
}

const WINGET_BASE_ARGS = ['upgrade', '--accept-source-agreements', '--accept-package-agreements']
/** Sem flags: o winget v1.29.380 devolve o blob degenerado "Multiple installed packages found…" nesta máquina. */
const WINGET_LIST_ARGS = ['upgrade']
/** winget pode demorar na 1ª consulta (sincroniza as fontes) — evita travar para sempre. */
const WINGET_TIMEOUT_MS = 180_000
const RAW_LOG_MAX_LINES = 25
const RAW_LOG_MAX_CHARS = 4000

/** Args em array — nunca string de shell; winget é sempre chamado sem shell. */
function runWinget(args: string[]): Promise<WingetRun> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    let child: ReturnType<typeof spawn> | null = null

    const timer = setTimeout(() => {
      settled = true
      try {
        child?.kill()
      } catch {
        // Best-effort: mesmo sem matar o processo, devolvemos o que capturamos.
      }
      resolve({ code: null, output, timedOut: true })
    }, WINGET_TIMEOUT_MS)

    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn('winget', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      clearTimeout(timer)
      resolve({ code: null, output: String(err), timedOut: false })
      return
    }
    child = proc

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })

    proc.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code: null,
        output: output ? `${output}\n${err.message}` : err.message,
        timedOut: false
      })
    })

    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? null, output, timedOut: false })
    })
  })
}

interface WingetRun {
  /** Código de saída; null quando o processo não pôde iniciar ou foi morto por timeout. */
  code: number | null
  output: string
  timedOut: boolean
}

const UPGRADE_LOG_MAX_LINES = 50
const UPGRADE_LOG_MAX_CHARS = 3000

/** Últimas `n` linhas da saída (tolerante a \r e \r\n), com teto de caracteres. Exportada para testes. */
export function lastLines(text: string, n: number): string {
  const lines = text.split(/\r\n|\n|\r/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop() // newline final não conta como linha
  const tail = lines.slice(-n).join('\n')
  return tail.length > UPGRADE_LOG_MAX_CHARS ? tail.slice(-UPGRADE_LOG_MAX_CHARS) : tail
}

/** Processo winget de `winget:upgrade-one` em curso — alvo do `winget:kill-upgrade`. */
let currentUpgrade: ChildProcess | null = null

/**
 * Atualiza um único app:
 *   winget upgrade --id <id> --exact --accept-package-agreements --accept-source-agreements
 * Args em array (sem shell) — o id nunca é interpolado em string de comando.
 */
export function upgradeOne(id: string): Promise<WingetUpgradeResult> {
  if (currentUpgrade) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      log: 'Já existe uma atualização em andamento.'
    })
  }
  const args = [
    'upgrade',
    '--id',
    id,
    '--exact',
    '--accept-package-agreements',
    '--accept-source-agreements'
  ]
  return new Promise((resolve) => {
    let output = ''
    let settled = false

    let proc: ChildProcess
    try {
      proc = spawn('winget', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, exitCode: null, log: String(err) })
      return
    }
    currentUpgrade = proc

    const finish = (result: WingetUpgradeResult): void => {
      if (settled) return
      settled = true
      if (currentUpgrade === proc) currentUpgrade = null
      resolve(result)
    }

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    proc.on('error', (err) => {
      finish({
        ok: false,
        exitCode: null,
        log: lastLines(output ? `${output}\n${err.message}` : err.message, UPGRADE_LOG_MAX_LINES)
      })
    })
    proc.on('close', (code) => {
      finish({
        ok: code === 0,
        exitCode: code ?? null,
        log: lastLines(output, UPGRADE_LOG_MAX_LINES)
      })
    })
  })
}

/**
 * Interrompe o winget em curso (item atual da fila). tree-kill mata a árvore
 * inteira (winget → filhos), estratégia já adotada no processManager.
 */
export function killUpgrade(): WingetKillResult {
  const proc = currentUpgrade
  const pid = proc?.pid
  if (!proc || !pid) {
    return { ok: false, error: 'Nenhuma atualização em andamento.' }
  }
  try {
    treeKill(pid, 'SIGTERM', (err) => {
      if (err) treeKill(pid, 'SIGKILL', () => undefined)
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Probe de suporte a `--output json` — detectado uma vez e cacheado em memória. */
let jsonSupportCache: boolean | null = null

/**
 * As flags `--accept-*` produzem uma saída degenerada ("Multiple installed packages
 * found…", 2 colunas, exit 0x8A150016) no `winget upgrade` de LISTAGEM do winget
 * v1.29.380 nesta máquina. Detectado uma única vez e cacheado em memória: na
 * primeira falha de parse, refazemos a chamada sem as flags e passamos a listar
 * sem elas. (Em máquinas onde as flags funcionam, nada muda.)
 */
let acceptFlagsWork: boolean | null = null

function listArgs(): string[] {
  return acceptFlagsWork === false ? WINGET_LIST_ARGS : WINGET_BASE_ARGS
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function excerpt(output: string): string {
  const lines = output.split(/\r?\n/).slice(0, RAW_LOG_MAX_LINES).join('\n')
  return lines.length > RAW_LOG_MAX_CHARS ? `${lines.slice(0, RAW_LOG_MAX_CHARS)}…` : lines
}

function wingetTimeoutError(): Error {
  return new Error('O winget demorou demais para responder. Tente novamente em alguns instantes.')
}

/** Lê o campo string (case-insensitive) de um objeto JSON do winget, com fallback de chaves. */
function pickField(rec: Record<string, unknown>, keys: string[]): string {
  const lower = new Map(Object.keys(rec).map((k) => [k.toLowerCase(), k]))
  for (const key of keys) {
    const real = lower.get(key.toLowerCase())
    if (real === undefined) continue
    const value = rec[real]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

/** Parse tolerante de `winget upgrade --output json` (schema varia entre versões). */
export function parseUpgradeJson(text: string): WingetUpgrade[] | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }

  // A raiz pode ser um array ou um objeto embrulhando um array (ex.: { Data: [...] }).
  let rows: unknown[] | null = null
  if (Array.isArray(data)) {
    rows = data
  } else if (data && typeof data === 'object') {
    for (const key of [
      'Data',
      'data',
      'Upgrades',
      'upgrades',
      'Packages',
      'packages',
      'Result',
      'value'
    ]) {
      const candidate = (data as Record<string, unknown>)[key]
      if (Array.isArray(candidate)) {
        rows = candidate
        break
      }
    }
  }
  if (!rows) return null

  const items: WingetUpgrade[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const id = pickField(rec, ['PackageIdentifier', 'Id', 'Identifier', 'id'])
    if (!id) continue
    const name = pickField(rec, ['PackageName', 'Name', 'name'])
    const currentVersion = pickField(rec, [
      'Version',
      'InstalledVersion',
      'CurrentVersion',
      'currentVersion'
    ])
    const availableVersion = pickField(rec, ['AvailableVersion', 'Available', 'availableVersion'])
    items.push({ name: name || id, id, currentVersion, availableVersion })
  }
  return items
}

/** Padrões que indicam "não há atualizações" (pt-BR e inglês). */
const NO_UPDATE_MARKERS = [
  'nenhuma atualização disponível',
  'nenhuma atualização aplicável',
  'nenhuma atualização encontrada',
  'não há atualizações',
  'no installed package found',
  'no applicable update found',
  'no newer package versions found',
  'no upgrades available',
  '0 upgrades available'
]

/** Linha separadora da tabela do winget (hífens, barras de caixa). */
function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return true
  return /^[-─━═\s]+$/.test(trimmed)
}

interface ColumnMap {
  name: number
  id: number
  version: number
  available: number
  source: number | null
}

function keywordIndex(line: string, pattern: RegExp): number | null {
  const match = pattern.exec(line)
  return match ? match.index : null
}

/**
 * Localiza a linha de cabeçalho da tabela (pt-BR e inglês) e devolve as
 * posições das colunas. As palavras-chave aceitas por coluna:
 *   Nome|Name · Id|ID|Identificador · Versão|Version · Disponível|Available · Origem|Source
 */
function findHeaderLine(lines: string[]): { lineIndex: number; cols: ColumnMap } | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const name = keywordIndex(line, /\b(nome|name)\b/i)
    const id = keywordIndex(line, /\b(identificador|id)\b/i)
    const version = keywordIndex(line, /\b(versão|version)\b/i)
    const available = keywordIndex(line, /\b(disponível|disponivel|available)\b/i)
    const source = keywordIndex(line, /\b(origem|source)\b/i)

    if (name === null || id === null || version === null || available === null) continue
    // Sanidade: colunas fora de ordem (linha que não é cabeçalho) → continua procurando.
    if (!(name < id && id < version && version < available)) continue

    return { lineIndex: index, cols: { name, id, version, available, source } }
  }
  return null
}

/** Parse posicional da tabela do winget, usando as posições do cabeçalho. */
export function parseUpgradeTable(output: string): WingetUpgrade[] {
  const lines = output.split(/\r?\n/)
  const header = findHeaderLine(lines)

  if (!header) {
    const lower = output.toLowerCase()
    if (NO_UPDATE_MARKERS.some((marker) => lower.includes(marker))) {
      return []
    }
    throw new WingetParseError(
      'Não foi possível ler a lista de atualizações do winget.',
      excerpt(output)
    )
  }

  const { cols } = header
  const items: WingetUpgrade[] = []

  for (let index = header.lineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) continue
    if (isSeparatorLine(line)) continue
    if (line.length < cols.available) continue // linha curta demais para conter as colunas

    const name = line.slice(cols.name, cols.id).trim()
    const id = line.slice(cols.id, cols.version).trim()
    const currentVersion = line.slice(cols.version, cols.available).trim()
    const availableVersion = line.slice(cols.available, cols.source ?? line.length).trim()

    // Ruído (avisos, notas de rodapé etc.): sem id ou sem nenhuma versão → ignora.
    if (!id) continue
    if (!currentVersion && !availableVersion) continue

    items.push({ name: name || id, id, currentVersion, availableVersion })
  }

  return items
}

function finalizeJson(output: string): WingetUpgrade[] {
  const items = parseUpgradeJson(output)
  if (items) return items // array vazio = nenhuma atualização — resultado válido
  throw new WingetParseError('Não foi possível ler a saída do winget.', excerpt(output))
}

/**
 * Marcas próprias que nunca devem aparecer na lista de atualizações. O Kloud Games
 * se disfarça com o id do Sunshine oficial (`LizardByte.Sunshine`), então o nome é a
 * única pista; o Kolnd Hub aparece via ARP com o productName. Comparar sempre com o
 * texto normalizado (minúsculo, sem acentos e só [a-z0-9]).
 */
const BLOCKED_BRANDS = ['kolndhub', 'kolnd', 'kloudgames', 'kloud']

/** Normaliza texto para comparação de marca (ex.: "KLOUD_GAMES" → "kloudgames"). */
function normalizeBrand(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos decompostos (ex.: "Klóud")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** true quando o nome ou o id do item carrega uma marca própria (Kloud Games / Kolnd Hub). */
export function isBlockedUpgrade(item: Pick<WingetUpgrade, 'name' | 'id'>): boolean {
  const name = normalizeBrand(item.name)
  const id = normalizeBrand(item.id)
  return BLOCKED_BRANDS.some((brand) => name.includes(brand) || id.includes(brand))
}

/** Remove os itens próprios da lista; loga o que foi ocultado para diagnóstico. */
export function filterBlockedUpgrades(items: WingetUpgrade[]): WingetUpgrade[] {
  const visible: WingetUpgrade[] = []
  const hidden: WingetUpgrade[] = []
  for (const item of items) {
    if (isBlockedUpgrade(item)) hidden.push(item)
    else visible.push(item)
  }
  if (hidden.length > 0) {
    logger.info(
      'winget',
      `ocultando ${hidden.length} atualização(ões) do próprio Hub/Kloud: ${hidden
        .map((item) => item.id)
        .join(', ')}`
    )
  }
  return visible
}

/**
 * Lista os apps com atualização disponível (`winget upgrade`).
 * Tenta `--output json` na primeira chamada (suporte detectado uma única vez
 * e cacheado em memória); sem suporte, cai para o parse posicional da tabela.
 * Se a tabela vier degenerada por causa das flags --accept-* (winget 1.29.380),
 * refaz uma única vez sem elas e cacheia a decisão para as próximas chamadas.
 * Lança WingetParseError/Error em caso de falha total.
 */
export async function listUpgradable(): Promise<WingetUpgrade[]> {
  const jsonArgs = [...listArgs(), '--output', 'json']

  // 1) Probe de suporte a JSON — só na primeira chamada (resultado fica cacheado).
  if (jsonSupportCache === null) {
    const probe = await runWinget(jsonArgs)
    if (probe.timedOut) throw wingetTimeoutError()
    if (looksLikeJson(probe.output)) {
      jsonSupportCache = true
      return filterBlockedUpgrades(finalizeJson(probe.output))
    }
    jsonSupportCache = false // ex.: "Argument name was not recognized" → usa a tabela
  } else if (jsonSupportCache === true) {
    const run = await runWinget(jsonArgs)
    if (run.timedOut) throw wingetTimeoutError()
    return filterBlockedUpgrades(finalizeJson(run.output))
  }

  // 2) Parse posicional da tabela. Se as flags --accept-* gerarem o blob degenerado
  //    "Multiple installed packages found…" (winget 1.29.380), tenta SEM elas uma vez
  //    e cacheia a decisão para as próximas chamadas.
  const run = await runWinget(listArgs())
  if (run.timedOut) throw wingetTimeoutError()
  try {
    return filterBlockedUpgrades(parseUpgradeTable(run.output))
  } catch (err) {
    if (err instanceof WingetParseError && acceptFlagsWork !== false) {
      logger.info(
        'winget',
        'saída degenerada com --accept-* no `winget upgrade`; tentando sem as flags'
      )
      const fallback = await runWinget(WINGET_LIST_ARGS)
      if (fallback.timedOut) throw wingetTimeoutError()
      const items = parseUpgradeTable(fallback.output) // sem as flags → pode lançar WingetParseError
      acceptFlagsWork = false
      return filterBlockedUpgrades(items)
    }
    throw err
  }
}

/** Registra os canais IPC relacionados ao winget. */
export function registerWingetIpc(): void {
  ipcMain.handle('winget:list-upgrades', async (): Promise<WingetListResult> => {
    if (!isWingetAvailable()) {
      return {
        ok: false,
        wingetMissing: true,
        error:
          'O winget (App Installer) não foi encontrado neste PC. Instale ou atualize o App Installer pela Microsoft Store e tente novamente.'
      }
    }
    try {
      const items = await listUpgradable()
      return { ok: true, items }
    } catch (err) {
      if (err instanceof WingetParseError) {
        return { ok: false, error: err.message, rawLog: err.rawLog }
      }
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle(
    'winget:upgrade-one',
    async (_event, payload: unknown): Promise<WingetUpgradeResult> => {
      const id =
        typeof payload === 'object' && payload !== null
          ? (payload as { id?: unknown }).id
          : undefined
      if (typeof id !== 'string' || !id.trim() || id.trim().length > 262 || /[\r\n]/.test(id)) {
        return { ok: false, exitCode: null, log: 'ID de pacote inválido.' }
      }
      if (!isWingetAvailable()) {
        return {
          ok: false,
          exitCode: null,
          log: 'O winget (App Installer) não foi encontrado neste PC. Instale ou atualize o App Installer pela Microsoft Store e tente novamente.'
        }
      }
      return upgradeOne(id.trim())
    }
  )

  ipcMain.handle('winget:kill-upgrade', (): WingetKillResult => killUpgrade())
}
