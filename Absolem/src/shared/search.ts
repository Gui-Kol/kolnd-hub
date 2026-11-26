/**
 * Contrato de pesquisa na internet (task 10), compartilhado entre main,
 * preload e renderer.
 *
 * Só tipos, constantes e funções puras. A allowlist de `openExternal` vive aqui
 * para que o main e o renderer usem exatamente a mesma regra: apenas `http:` e
 * `https:` podem sair do app.
 */

export const SEARCH_KINDS = ['search', 'fetch'] as const

export type SearchKind = (typeof SEARCH_KINDS)[number]

/** Fonte citada; sempre `http`/`https` depois da normalização do main. */
export interface WebSource {
  title: string
  url: string
}

/** Push do indicador discreto exibido perto do avatar. */
export interface SearchIndicatorPush {
  active: boolean
  kind?: SearchKind
}

/** Contadores do turno atual expostos para a task 11. */
export interface SearchTurnStatus {
  requestId: string | null
  searches: number
  searchesLimit: number
  fetches: number
  fetchesLimit: number
  budgetRemainingMs: number
}

export interface SearchCacheStatus {
  entries: number
  maxEntries: number
  ttlSeconds: number
}

export interface SearchStatus {
  enabled: boolean
  active: boolean
  kind?: SearchKind
  /** Ferramentas web registradas neste momento (vazio com `web.enabled=false`). */
  tools: string[]
  turn: SearchTurnStatus
  cache: SearchCacheStatus
}

/** Máximo de fontes no bloco final (T5). */
export const MAX_GROUNDED_SOURCES = 8

/** Limites por turno (T7). */
export const MAX_SEARCHES_PER_TURN = 3
export const MAX_FETCHES_PER_TURN = 5
export const SEARCH_TURN_BUDGET_MS = 30_000
export const MAX_PAGE_CHARS = 8_000

/** Cache curto em memória (T6). */
export const SEARCH_CACHE_MAX_ENTRIES = 50
export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000

/** Schemas estritos das ferramentas (T9). */
export const MAX_SEARCH_QUERY_CHARS = 300
export const MAX_FETCH_URL_CHARS = 2_048

export function isSearchKind(value: unknown): value is SearchKind {
  return typeof value === 'string' && (SEARCH_KINDS as readonly string[]).includes(value)
}

/**
 * Allowlist única para abrir link citado. Devolve a URL normalizada quando é
 * `http`/`https`; `null` para todo o resto (javascript:, file:, data:, ...).
 */
export function parseAllowedExternalUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url.toString()
}

export function isAllowedExternalUrl(raw: string): boolean {
  return parseAllowedExternalUrl(raw) !== null
}

/** Remove credenciais e normaliza uma fonte vinda de metadata de grounding. */
export function normalizeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return parseAllowedExternalUrl(raw)
}
