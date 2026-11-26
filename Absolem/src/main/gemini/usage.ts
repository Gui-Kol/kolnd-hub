import { GeminiError } from './errors'
import type { GeminiUsageMetadata } from './transport'
import type { UsageConfig, UsageDay } from '../../shared/config'
import { USAGE_WARNING_PERCENT } from '../../shared/gemini'

export { USAGE_WARNING_PERCENT }

/**
 * Medidor de custo em tokens (não em dinheiro, que muda de preço).
 *
 * - Soma por dia (`YYYY-MM-DD`, UTC) e por mês (`YYYY-MM`);
 * - retenção de 62 dias, podada na escrita;
 * - teto mensal em tokens (`gemini.monthlyTokenCap`, default 2.000.000);
 * - aviso em 80% uma única vez por mês;
 * - bloqueio em 100% antes de chamar o transporte, com `kind: 'quota'`;
 * - `usageMetadata` quando existir; senão estimativa por caracteres/4 marcada
 *   com `estimated: true`.
 */

export const USAGE_STORE_KEY = 'usage'
export const USAGE_RETENTION_DAYS = 62
export const DEFAULT_MONTHLY_TOKEN_CAP = 2_000_000
export const CHARS_PER_TOKEN = 4

export type UsageState = UsageConfig
export type { UsageDay }

export interface UsageSnapshot {
  today: number
  month: number
  cap: number
  percent: number
}

export interface UsageWarning {
  percent: number
  cap: number
  used: number
  month: string
}

export interface UsageStoreLike {
  get<T>(key: string, defaultValue: T): T
  set(key: string, value: unknown): void
}

export interface UsageMeterOptions {
  store: UsageStoreLike
  cap: () => number
  now?: () => Date
  onWarning?: (warning: UsageWarning) => void
  retentionDays?: number
}

export interface TokenAmounts {
  input: number
  output: number
}

export interface UsageRecordOptions {
  /**
   * Identificador idempotente do turno/chamada. O mesmo `requestId` nunca soma
   * duas vezes na mesma execução (retry ou evento duplicado); o conjunto é
   * limitado em memória e não vai para o disco.
   */
  requestId?: string
}

const MAX_TRACKED_REQUESTS = 200

export const EMPTY_USAGE_STATE: UsageState = { days: {}, warnedMonths: [] }

export function defaultUsageState(): UsageState {
  return { days: {}, warnedMonths: [] }
}

function nonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

/** Normaliza o valor vindo do store/IPC; nunca lança. */
export function normalizeUsageState(input: unknown): UsageState {
  const raw =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const days: Record<string, UsageDay> = {}
  const rawDays =
    raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days)
      ? (raw.days as Record<string, unknown>)
      : {}
  for (const [date, value] of Object.entries(rawDays)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const day = value as Record<string, unknown>
    days[date] = {
      input: nonNegativeInt(day.input),
      output: nonNegativeInt(day.output),
      calls: nonNegativeInt(day.calls)
    }
  }
  const warnedMonths = Array.isArray(raw.warnedMonths)
    ? raw.warnedMonths.filter(
        (month): month is string => typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)
      )
    : []
  return { days, warnedMonths: [...new Set(warnedMonths)] }
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function dayStartUtc(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Remove dias mais antigos que `retentionDays` (comparação em UTC). */
export function pruneUsageState(
  state: UsageState,
  now: Date,
  retentionDays: number = USAGE_RETENTION_DAYS
): UsageState {
  const cutoff = dayStartUtc(now) - (retentionDays - 1) * 24 * 60 * 60 * 1000
  const days: Record<string, UsageDay> = {}
  for (const [date, day] of Object.entries(state.days)) {
    const parsed = Date.parse(`${date}T00:00:00.000Z`)
    if (!Number.isFinite(parsed) || parsed < cutoff) continue
    days[date] = day
  }
  return { days, warnedMonths: [...state.warnedMonths] }
}

export function sumDay(state: UsageState, date: string): number {
  const day = state.days[date]
  return day ? day.input + day.output : 0
}

/** Soma do mês (`YYYY-MM`) em tokens de entrada e saída. */
export function sumMonth(state: UsageState, month: string): number {
  let total = 0
  for (const [date, day] of Object.entries(state.days)) {
    if (date.startsWith(`${month}-`)) total += day.input + day.output
  }
  return total
}

/**
 * Usa os tokens informados pelo provedor quando existirem; senão estima por
 * caracteres/4 e marca `estimated: true`.
 */
export function resolveUsage(
  inputText: string,
  outputText: string,
  metadata?: GeminiUsageMetadata
): TokenAmounts & { total: number; estimated: boolean } {
  const hasInput = typeof metadata?.input === 'number'
  const hasOutput = typeof metadata?.output === 'number'
  const hasTotal = typeof metadata?.total === 'number'
  if (hasInput || hasOutput) {
    const input = hasInput ? nonNegativeInt(metadata?.input) : 0
    const output = hasOutput ? nonNegativeInt(metadata?.output) : 0
    return {
      input,
      output,
      total: hasTotal ? nonNegativeInt(metadata?.total) : input + output,
      estimated: false
    }
  }
  if (hasTotal) {
    const total = nonNegativeInt(metadata?.total)
    return { input: total, output: 0, total, estimated: false }
  }
  const input = Math.ceil(inputText.length / CHARS_PER_TOKEN)
  const output = Math.ceil(outputText.length / CHARS_PER_TOKEN)
  return { input, output, total: input + output, estimated: true }
}

export function clampCap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MONTHLY_TOKEN_CAP
  }
  return Math.floor(value)
}

export function quotaMessage(month: number, cap: number): string {
  return (
    `Limite mensal de tokens atingido (${month} de ${cap}). ` +
    'Aumente "gemini.monthlyTokenCap" nas configurações ou aguarde o próximo mês.'
  )
}

export class UsageMeter {
  private state: UsageState
  private readonly store: UsageStoreLike
  private readonly cap: () => number
  private readonly now: () => Date
  private readonly onWarning?: (warning: UsageWarning) => void
  private readonly retentionDays: number
  private readonly seenRequests = new Set<string>()

  constructor(options: UsageMeterOptions) {
    this.store = options.store
    this.cap = options.cap
    this.now = options.now ?? (() => new Date())
    this.onWarning = options.onWarning
    this.retentionDays = options.retentionDays ?? USAGE_RETENTION_DAYS
    this.state = normalizeUsageState(
      this.store.get<UsageState>(USAGE_STORE_KEY, defaultUsageState())
    )
  }

  /** Teto vigente (lido a cada consulta para refletir mudança nas configurações). */
  getCap(): number {
    return clampCap(this.cap())
  }

  todayTokens(): number {
    return sumDay(this.state, dayKey(this.now()))
  }

  monthTokens(): number {
    return sumMonth(this.state, monthKey(this.now()))
  }

  percent(): number {
    const cap = this.getCap()
    return Math.round((this.monthTokens() / cap) * 100)
  }

  snapshot(): UsageSnapshot {
    const cap = this.getCap()
    return {
      today: this.todayTokens(),
      month: this.monthTokens(),
      cap,
      percent: Math.round((this.monthTokens() / cap) * 100)
    }
  }

  /** Bloqueia antes de chamar o transporte quando o teto do mês já foi atingido. */
  checkBudget(): void {
    const cap = this.getCap()
    const used = this.monthTokens()
    if (used >= cap) {
      throw new GeminiError('quota', quotaMessage(used, cap), { retryable: false })
    }
  }

  /** Soma tokens do turno, persiste podado e emite o aviso de 80% uma vez por mês. */
  record(amounts: TokenAmounts, options: UsageRecordOptions = {}): UsageSnapshot {
    const requestId =
      typeof options.requestId === 'string' ? options.requestId.trim().slice(0, 128) : ''
    if (requestId) {
      if (this.seenRequests.has(requestId)) return this.snapshot()
      this.seenRequests.add(requestId)
      if (this.seenRequests.size > MAX_TRACKED_REQUESTS) {
        const oldest = this.seenRequests.values().next().value
        if (typeof oldest === 'string') this.seenRequests.delete(oldest)
      }
    }
    const now = this.now()
    const date = dayKey(now)
    const month = monthKey(now)
    const current = this.state.days[date] ?? { input: 0, output: 0, calls: 0 }
    this.state.days[date] = {
      input: current.input + nonNegativeInt(amounts.input),
      output: current.output + nonNegativeInt(amounts.output),
      calls: current.calls + 1
    }
    this.state = pruneUsageState(this.state, now, this.retentionDays)
    this.store.set(USAGE_STORE_KEY, this.state)

    const cap = this.getCap()
    const used = this.monthTokens()
    const percent = Math.round((used / cap) * 100)
    if (percent >= USAGE_WARNING_PERCENT && !this.state.warnedMonths.includes(month)) {
      this.state.warnedMonths = [...this.state.warnedMonths, month]
      this.store.set(USAGE_STORE_KEY, this.state)
      this.onWarning?.({ percent, cap, used, month })
    }
    return this.snapshot()
  }
}

export function createUsageMeter(options: UsageMeterOptions): UsageMeter {
  return new UsageMeter(options)
}
