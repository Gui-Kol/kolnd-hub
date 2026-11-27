/**
 * Catálogo de modelos Gemini oferecidos pela configuração do Absolem.
 *
 * Os catálogos são separados por endpoint: modelos Live não são opções de
 * texto/visão/pesquisa e não devem ser enviados a `generateContent`.
 */

export interface GeminiModelOption {
  readonly id: string
  readonly label: string
}

export const GEMINI_TEXT_MODEL_OPTIONS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' }
] as const satisfies readonly GeminiModelOption[]

export const GEMINI_LIVE_MODEL_OPTIONS = [
  { id: 'gemini-3.8-live', label: 'Gemini 3.8 Live' },
  { id: 'gemini-3-flash-live', label: 'Gemini 3 Flash Live' },
  {
    id: 'gemini-2.5-flash-native-audio-dialog',
    label: 'Gemini 2.5 Flash Native Audio Dialog'
  },
  {
    id: 'gemini-3.8-live-extended-thinking',
    label: 'Gemini 3.8 Live (raciocínio estendido)'
  }
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
