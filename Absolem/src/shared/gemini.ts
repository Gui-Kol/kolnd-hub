/**
 * Formas do motor Gemini compartilhadas entre main, preload e renderer.
 *
 * Só tipos e constantes: nenhuma lógica e nenhum acesso a segredo. O renderer
 * conhece `GeminiStatusInfo`, os pushes de chat e o payload de diagnóstico sem
 * importar nada de `src/main`.
 */

/** Aviso de consumo exibido quando o mês chega a este percentual do teto. */
export const USAGE_WARNING_PERCENT = 80

/** Modelo de texto estável padrão (Gemini API, 27/11/2026). */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'

/** Modelo Live (áudio nativo) padrão da voz (Gemini API, 27/11/2026). */
export const DEFAULT_GEMINI_LIVE_MODEL = 'gemini-3.8-live'

/**
 * Modelos que a documentação oficial marcou como desligados (shut down). A
 * migração 1.12.0 troca apenas estes valores pelo default; modelos
 * customizados do usuário são preservados.
 */
export const SHUTDOWN_GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'] as const

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
  /** Tokens estimados da imagem capturada (task 07), quando houver. */
  imageTokens?: number
  /** `true` quando `imageTokens` veio da fórmula largura*altura/750. */
  imageEstimated?: boolean
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
  /**
   * Aviso em sucesso parcial: a chave foi aceita, mas o serviço respondeu 5xx.
   * A UI deve mostrar o aviso em âmbar, não como falha de chave.
   */
  warning?: string
}

/** `diagnostics:gemini`: metadados do motor; nunca a chave. */
export interface GeminiDiagnostics {
  sdkPackage: string
  sdkVersion: string
  /** Modelo de texto (`gemini.model`). */
  model: string
  /** Modelo da voz/Live (`gemini.liveModel`). */
  liveModel: string
  promptVersion: string
  configured: boolean
  lastError: GeminiErrorSummary | null
  usage: GeminiUsageSnapshot
  /** Últimos erros classificados (máximo 5), sem prompt nem resposta. */
  recentErrors?: Array<GeminiErrorSummary & { at?: number }>
}
