/**
 * Catálogo de modelos Gemini oferecidos pela configuração do Absolem.
 *
 * O catálogo é mantido por compatibilidade com configurações antigas, mas o
 * runtime atual aceita exclusivamente o modelo Live único.
 */

export interface GeminiModelOption {
  readonly id: string
  readonly label: string
}

export const GEMINI_TEXT_MODEL_OPTIONS = [
  { id: 'gemini-3.8-live', label: 'Gemini 3.8 Live' }
] as const satisfies readonly GeminiModelOption[]

export const GEMINI_LIVE_MODEL_OPTIONS = [
  { id: 'gemini-3.8-live', label: 'Gemini 3.8 Live' }
] as const satisfies readonly GeminiModelOption[]

export type GeminiTextModelId = (typeof GEMINI_TEXT_MODEL_OPTIONS)[number]['id']
export type GeminiLiveModelId = (typeof GEMINI_LIVE_MODEL_OPTIONS)[number]['id']

const textModelIds: ReadonlySet<string> = new Set(
  GEMINI_TEXT_MODEL_OPTIONS.map((option) => option.id)
)
const liveModelIds: ReadonlySet<string> = new Set(
  GEMINI_LIVE_MODEL_OPTIONS.map((option) => option.id)
)

export function isGeminiTextModel(value: unknown): value is GeminiTextModelId {
  return typeof value === 'string' && textModelIds.has(value)
}

export function isGeminiLiveModel(value: unknown): value is GeminiLiveModelId {
  return typeof value === 'string' && liveModelIds.has(value)
}
