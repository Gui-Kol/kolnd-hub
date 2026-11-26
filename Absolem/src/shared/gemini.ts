/**
 * Formas do motor Gemini compartilhadas entre main, preload e renderer.
 *
 * Só tipos e constantes: nenhuma lógica e nenhum acesso a segredo. O renderer
 * conhece `GeminiStatusInfo`, os pushes de chat e o payload de diagnóstico sem
 * importar nada de `src/main`.
 */

export const GEMINI_ERROR_KINDS = [
  'auth',
  'quota',
  'network',
  'timeout',
  'invalid',
  'blocked',
  'cancelled',
  'server',
  'unknown'
] as const

export type GeminiErrorKind = (typeof GEMINI_ERROR_KINDS)[number]

/** Tokens por dia/mês e teto vigente (sem preço, que muda). */
export interface GeminiUsageSnapshot {
  today: number
  month: number
  cap: number
  percent: number
}

export interface GeminiErrorSummary {
  kind: GeminiErrorKind
  message: string
}

export interface GeminiStatusInfo {
  configured: boolean
  model: string
  lastError: GeminiErrorSummary | null
  /** Motivo de bloqueio vigente (sem chave, teto atingido) ou `null`. */
  disabledReason: string | null
  usage: GeminiUsageSnapshot
}

export interface ChatUsagePayload {
  input: number
  output: number
  total: number
  estimated: boolean
}

export interface ChatDeltaPush {
  requestId: string
  text: string
}

export interface ChatDonePush {
  requestId: string
  usage: ChatUsagePayload
}

export interface ChatErrorPush {
  requestId: string
  kind: GeminiErrorKind
  message: string
}

export interface GeminiUsageWarningPush {
  percent: number
  cap: number
  used: number
}

/** Resultado de `gemini:test-key` (o envelope IPC fica em `ipc.ts`). */
export interface GeminiTestKeyOutcome {
  ok: boolean
  model?: string
  error?: GeminiErrorSummary
  usage?: ChatUsagePayload
  durationMs?: number
}

/** `diagnostics:gemini`: metadados do motor; nunca a chave. */
export interface GeminiDiagnostics {
  sdkPackage: string
  sdkVersion: string
  model: string
  promptVersion: string
  configured: boolean
  lastError: GeminiErrorSummary | null
  usage: GeminiUsageSnapshot
}
