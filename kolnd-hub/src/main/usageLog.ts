import { app } from 'electron'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync
} from 'fs'
import { join } from 'path'
import { logger } from './logger'
import {
  USAGE_ACTIONS,
  USAGE_EVENT_TYPES,
  USAGE_MAX_FILE_BYTES,
  USAGE_PAGES,
  USAGE_RETENTION_DEFAULT,
  USAGE_RETENTION_OPTIONS,
  type ClearUsageResult,
  type UsageAction,
  type UsageEvent,
  type UsageEventType,
  type UsagePage,
  type UsageReadOptions,
  type UsageSummary
} from '../shared/usage'

/**
 * Registro de uso local do Kolnd Hub.
 *
 * Um arquivo JSONL por dia local (`usage-AAAA-MM-DD.jsonl`) em
 * `%APPDATA%\kolnd-hub\logs`, ao lado do `kolnd-hub.log`. Cada linha é um
 * evento; nada sai da máquina.
 *
 * A escrita é best-effort, no mesmo padrão do `logger.ts`: falha de disco
 * nunca lança nem derruba o app. A poda por retenção só apaga arquivos que
 * casam `usage-YYYY-MM-DD.jsonl` — o `kolnd-hub.log*` nunca é tocado.
 *
 * Dependências (relógio/diretório/logger) são injetáveis para os testes não
 * precisarem de Electron.
 */

const USAGE_FILE_RE = /^usage-\d{4}-\d{2}-\d{2}\.jsonl$/
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_ID_LENGTH = 120
const MAX_NAME_LENGTH = 120
const MAX_VERSION_LENGTH = 40
/** Teto de segurança para `durationSeconds` (~10 anos). */
const MAX_DURATION_SECONDS = 315_360_000
/** Quantidade padrão de eventos devolvida por `readUsageEvents`. */
export const USAGE_READ_DEFAULT_LIMIT = 2000
export const USAGE_READ_MAX_LIMIT = 10_000

interface UsageDeps {
  now: () => Date
  logger: Pick<typeof logger, 'warn' | 'error'>
}

const defaultDeps: UsageDeps = {
  now: () => new Date(),
  logger
}

let deps: UsageDeps = { ...defaultDeps }
/** Hook exclusivo para testes: diretório do registro (null = padrão). */
let testUsageDir: string | null = null
/** Hook exclusivo para testes/descarte: `false` = não grava nada. */
let enabledProvider: (() => boolean) | null = null
/** Retenção efetiva (preferência do store), injetada uma vez pelo index.ts. */
let retentionProvider: (() => number) | null = null
/** Último dia em que a poda rodou (evita varrer o diretório em cada evento). */
let lastPrunedDayKey: string | null = null
/** Dia em que o aviso de arquivo cheio já foi emitido. */
let sizeGuardWarnedDayKey: string | null = null

function resetUsageState(): void {
  lastPrunedDayKey = null
  sizeGuardWarnedDayKey = null
}

/** Hook exclusivo para testes: força o diretório do registro (null = padrão). */
export function setUsageDirForTests(dir: string | null): void {
  testUsageDir = dir
  resetUsageState()
}

/** Hook exclusivo para testes: relógio e logger injetáveis (null = padrão). */
export function setUsageDepsForTests(overrides: Partial<UsageDeps> | null): void {
  deps = overrides ? { ...defaultDeps, ...overrides } : { ...defaultDeps }
  resetUsageState()
}

/**
 * Liga/desliga a gravação (preferência `usageLog.enabled` do store).
 * Chamado uma vez pelo `index.ts`; null = sempre ligado (testes).
 */
export function setUsageEnabledProvider(provider: (() => boolean) | null): void {
  enabledProvider = provider
}

/**
 * Liga a retenção vinda da preferência `usageLog.retentionDays`.
 * Também chamado uma vez pelo `index.ts`; null = padrão de 30 dias.
 */
export function setUsageRetentionProvider(provider: (() => number) | null): void {
  retentionProvider = provider
}

/** `true` quando o nome é um arquivo diário do registro de uso. */
export function isUsageFileName(name: unknown): boolean {
  return typeof name === 'string' && USAGE_FILE_RE.test(name)
}

/**
 * Chave `YYYY-MM-DD` da data LOCAL (não UTC).
 *
 * Mesma regra de `localDateKey` em `games/playtime.ts`, reimplementada aqui de
 * propósito: o registro de uso não deve depender do módulo de jogos.
 */
export function usageDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Resolve `%APPDATA%\kolnd-hub\logs` preguiçosamente (seguro antes do app pronto). */
function resolveUsageDir(): string | null {
  if (testUsageDir) return testUsageDir
  try {
    return join(app.getPath('userData'), 'logs')
  } catch {
    return null // ex.: fora do Electron (testes) — sem diretório, não grava
  }
}

function usageFilePath(dir: string, dayKey: string): string {
  return join(dir, `usage-${dayKey}.jsonl`)
}

/** Texto limpo de ids/nomes: sem controles, sem quebras de linha, tamanho limitado. */
function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  let text = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    // Controles (incluindo \n, \t e DEL) viram espaço para não colar palavras.
    text += code < 32 || code === 127 ? ' ' : char
  }
  text = text.trim().slice(0, maxLength)
  return text || undefined
}

function isUsageEventType(value: unknown): value is UsageEventType {
  return typeof value === 'string' && USAGE_EVENT_TYPES.includes(value as UsageEventType)
}

function isUsagePage(value: unknown): value is UsagePage {
  return typeof value === 'string' && USAGE_PAGES.includes(value as UsagePage)
}

function isUsageAction(value: unknown): value is UsageAction {
  return typeof value === 'string' && USAGE_ACTIONS.includes(value as UsageAction)
}

/** Normaliza um evento lido/construído; devolve null para linha inválida. */
export function normalizeUsageEvent(input: unknown): UsageEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  if (!isUsageEventType(raw.type)) return null
  if (typeof raw.ts !== 'string' || raw.ts.length > 40) return null
  const ms = Date.parse(raw.ts)
  if (!Number.isFinite(ms)) return null

  const event: UsageEvent = { ts: new Date(ms).toISOString(), type: raw.type }
  const sessionId = cleanText(raw.sessionId, MAX_ID_LENGTH)
  if (sessionId) event.sessionId = sessionId
  if (isUsagePage(raw.page)) event.page = raw.page
  const appId = cleanText(raw.appId, MAX_ID_LENGTH)
  if (appId) event.appId = appId
  const name = cleanText(raw.name, MAX_NAME_LENGTH)
  if (name) event.name = name
  const gameId = cleanText(raw.gameId, MAX_ID_LENGTH)
  if (gameId) event.gameId = gameId
  const version = cleanText(raw.version, MAX_VERSION_LENGTH)
  if (version) event.version = version
  if (isUsageAction(raw.action)) event.action = raw.action
  if (typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds)) {
    const seconds = Math.max(0, Math.floor(raw.durationSeconds))
    event.durationSeconds = Math.min(seconds, MAX_DURATION_SECONDS)
  }
  return event
}

/** Campos aceitos ao construir um evento (tudo validado/limitado). */
export interface UsageEventInput {
  sessionId?: string
  page?: UsagePage
  appId?: string
  name?: string
  gameId?: string
  version?: string
  action?: UsageAction
  durationSeconds?: number
}

/** Constrói o evento com `ts` = agora (injetável nos testes). */
export function buildUsageEvent(
  type: UsageEventType,
  input: UsageEventInput = {},
  now: Date = deps.now()
): UsageEvent {
  const base: UsageEvent = { ts: now.toISOString(), type }
  const sessionId = cleanText(input.sessionId, MAX_ID_LENGTH)
  if (sessionId) base.sessionId = sessionId
  if (input.page && isUsagePage(input.page)) base.page = input.page
  const appId = cleanText(input.appId, MAX_ID_LENGTH)
  if (appId) base.appId = appId
  const name = cleanText(input.name, MAX_NAME_LENGTH)
  if (name) base.name = name
  const gameId = cleanText(input.gameId, MAX_ID_LENGTH)
  if (gameId) base.gameId = gameId
  const version = cleanText(input.version, MAX_VERSION_LENGTH)
  if (version) base.version = version
  if (input.action && isUsageAction(input.action)) base.action = input.action
  if (typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)) {
    const seconds = Math.max(0, Math.floor(input.durationSeconds))
    base.durationSeconds = Math.min(seconds, MAX_DURATION_SECONDS)
  }
  return base
}

function normalizeRetention(input: unknown): number {
  return typeof input === 'number' && USAGE_RETENTION_OPTIONS.includes(input as never)
    ? input
    : USAGE_RETENTION_DEFAULT
}

/** Chave de corte: mantém os últimos `retentionDays` dias, hoje incluso. */
function retentionCutoffKey(reference: Date, retentionDays: number): string {
  const cutoff = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() - (retentionDays - 1),
    12,
    0,
    0,
    0
  )
  return usageDateKey(cutoff)
}

/**
 * Poda arquivos do registro mais antigos que a retenção.
 * Só apaga nomes que casam `usage-YYYY-MM-DD.jsonl` — nunca `kolnd-hub.log`.
 */
function pruneUsageFiles(dir: string, reference: Date, retentionDays: number): void {
  const cutoff = retentionCutoffKey(reference, retentionDays)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return // sem diretório ainda: nada a podar
  }
  for (const name of names) {
    if (!isUsageFileName(name)) continue
    const dayKey = name.slice('usage-'.length, 'usage-'.length + 10)
    if (!DATE_KEY_RE.test(dayKey) || dayKey >= cutoff) continue
    try {
      unlinkSync(join(dir, name))
    } catch {
      // best-effort: um arquivo travado pode ser removido na próxima poda
    }
  }
}

export interface AppendUsageOptions {
  /** Dias de retenção (7/30/90); inválido cai no padrão 30. */
  retentionDays?: number
}

/**
 * Anexa um evento ao arquivo do dia local. Best-effort: nunca lança.
 * Devolve `true` quando a linha foi gravada (ou quando a gravação está
 * desligada por preferência? não — desligado devolve `false`).
 */
export function appendUsageEvent(event: UsageEvent, options: AppendUsageOptions = {}): boolean {
  if (enabledProvider && !enabledProvider()) return false
  const normalized = normalizeUsageEvent(event)
  if (!normalized) return false
  const dir = resolveUsageDir()
  if (!dir) return false

  const now = deps.now()
  const todayKey = usageDateKey(now)
  const retentionDays = normalizeRetention(
    options.retentionDays ?? retentionProvider?.() ?? undefined
  )
  const eventDayKey = usageDateKey(new Date(normalized.ts))

  try {
    mkdirSync(dir, { recursive: true })

    // A poda roda na troca de dia (ou na primeira gravação da sessão).
    if (lastPrunedDayKey !== todayKey) {
      pruneUsageFiles(dir, now, retentionDays)
      lastPrunedDayKey = todayKey
    }

    const file = usageFilePath(dir, eventDayKey)
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      size = 0 // arquivo ainda não existe
    }
    if (size >= USAGE_MAX_FILE_BYTES) {
      // Guarda de tamanho: para de anexar até o dia seguinte, com 1 aviso.
      if (sizeGuardWarnedDayKey !== eventDayKey) {
        sizeGuardWarnedDayKey = eventDayKey
        deps.logger.warn(
          'usageLog',
          `arquivo do dia atingiu ${USAGE_MAX_FILE_BYTES} bytes; registro pausado até amanhã`
        )
      }
      return false
    }

    appendFileSync(file, `${JSON.stringify(normalized)}\n`, 'utf8')
    return true
  } catch (err) {
    // Falha de disco NUNCA derruba o app: registra e segue sem o evento.
    deps.logger.error('usageLog', 'Falha ao gravar o registro de uso:', err)
    return false
  }
}

export type { ClearUsageResult, UsageReadOptions } from '../shared/usage'

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_KEY_RE.test(value)
}

function normalizedLimit(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return USAGE_READ_DEFAULT_LIMIT
  return Math.min(USAGE_READ_MAX_LIMIT, Math.max(1, Math.floor(input)))
}

/**
 * Lê os eventos do período (mais recente primeiro). Linhas malformadas são
 * ignoradas individualmente — uma linha corrompida não invalida o arquivo.
 * Nunca lança: diretório ausente/ilegível devolve lista vazia.
 */
export function readUsageEvents(options: UsageReadOptions = {}): UsageEvent[] {
  const dir = resolveUsageDir()
  if (!dir) return []

  const from = isDateKey(options.from) ? options.from : null
  const to = isDateKey(options.to) ? options.to : null
  const type = isUsageEventType(options.type) ? options.type : null
  const page = isUsagePage(options.page) ? options.page : null
  const limit = normalizedLimit(options.limit)

  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return [] // diretório ainda não existe
  }

  const events: UsageEvent[] = []
  for (const name of names) {
    if (!isUsageFileName(name)) continue
    const dayKey = name.slice('usage-'.length, 'usage-'.length + 10)
    if (from && dayKey < from) continue
    if (to && dayKey > to) continue

    let text: string
    try {
      text = readFileSync(join(dir, name), 'utf8')
    } catch {
      continue // arquivo ilegível — segue para o próximo
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch {
        continue // linha corrompida — ignorada isoladamente
      }
      const event = normalizeUsageEvent(raw)
      if (!event) continue
      if (type && event.type !== type) continue
      if (page && event.page !== page) continue
      events.push(event)
    }
  }

  // Ordena por `ts` decrescente; empate mantém a ordem de leitura.
  events.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
  return events.slice(0, limit)
}

/** Resumo agregado dos eventos recebidos. Função pura. */
export function summarizeUsage(events: UsageEvent[]): UsageSummary {
  const byDay = new Map<string, { events: number; seconds: number }>()
  const apps = new Map<string, { id: string; name: string; launches: number }>()
  const games = new Map<string, { id: string; name: string; launches: number }>()
  const pageViews = Object.fromEntries(USAGE_PAGES.map((page) => [page, 0])) as Record<
    UsagePage,
    number
  >

  let totalSessions = 0
  let totalSeconds = 0

  for (const event of events) {
    const parsed = Date.parse(event.ts)
    if (!Number.isFinite(parsed)) continue
    const dayKey = usageDateKey(new Date(parsed))
    const day = byDay.get(dayKey) ?? { events: 0, seconds: 0 }
    day.events += 1

    if (event.type === 'session-start') totalSessions += 1
    if (event.type === 'session-end' && typeof event.durationSeconds === 'number') {
      const seconds = Math.max(0, Math.floor(event.durationSeconds))
      totalSeconds += seconds
      day.seconds += seconds
    }
    if (event.type === 'page-view' && event.page) pageViews[event.page] += 1

    if (event.type === 'app-launch' && event.appId) {
      const key = event.appId
      const entry = apps.get(key) ?? { id: key, name: event.name ?? key, launches: 0 }
      entry.launches += 1
      if (event.name) entry.name = event.name
      apps.set(key, entry)
    }
    if (event.type === 'game-launch' && event.gameId) {
      const key = event.gameId
      const entry = games.get(key) ?? { id: key, name: event.name ?? key, launches: 0 }
      entry.launches += 1
      if (event.name) entry.name = event.name
      games.set(key, entry)
    }

    byDay.set(dayKey, day)
  }

  const sortTop = (
    input: Map<string, { id: string; name: string; launches: number }>
  ): Array<{ id: string; name: string; launches: number }> =>
    [...input.values()].sort((a, b) => b.launches - a.launches || a.name.localeCompare(b.name))

  return {
    totalSessions,
    totalSeconds,
    byDay: [...byDay.entries()]
      .map(([date, value]) => ({ date, events: value.events, seconds: value.seconds }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    topApps: sortTop(apps),
    topGames: sortTop(games),
    pageViews
  }
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
  // Escapa aspas, vírgulas e quebras de linha (padrão CSV com aspas duplas).
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

const USAGE_CSV_HEADER = [
  'data_hora',
  'tipo',
  'sessao',
  'pagina',
  'app_id',
  'nome',
  'jogo_id',
  'versao',
  'acao',
  'duracao_segundos'
]

/** Converte eventos em CSV (cabeçalho pt-BR, escape de `"`, `,` e quebras). */
export function usageToCsv(events: UsageEvent[]): string {
  const lines = [USAGE_CSV_HEADER.join(',')]
  for (const event of events) {
    lines.push(
      [
        csvCell(event.ts),
        csvCell(event.type),
        csvCell(event.sessionId),
        csvCell(event.page),
        csvCell(event.appId),
        csvCell(event.name),
        csvCell(event.gameId),
        csvCell(event.version),
        csvCell(event.action),
        csvCell(event.durationSeconds)
      ].join(',')
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

/** Apaga todos os arquivos do registro de uso (só `usage-*.jsonl`). */
export function clearUsageFiles(): ClearUsageResult {
  const dir = resolveUsageDir()
  if (!dir) return { success: true, removed: 0 }

  let removed = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!isUsageFileName(name)) continue
      try {
        unlinkSync(join(dir, name))
        removed += 1
      } catch {
        // best-effort: um arquivo travado fica para a próxima limpeza
      }
    }
    resetUsageState()
    return { success: true, removed }
  } catch (err) {
    // Diretório inexistente = nada a limpar; qualquer outro erro é reportado.
    if (!existsSync(dir)) return { success: true, removed: 0 }
    const message = err instanceof Error ? err.message : String(err)
    deps.logger.error('usageLog', 'Falha ao limpar o registro de uso:', err)
    return { success: false, removed, error: message }
  }
}
