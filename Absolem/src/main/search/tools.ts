import type { ToolDefinition } from '../../shared/tools'
import {
  MAX_FETCH_URL_CHARS,
  MAX_PAGE_CHARS,
  MAX_SEARCH_QUERY_CHARS,
  parseAllowedExternalUrl,
  type SearchKind,
  type WebSource
} from '../../shared/search'
import type { ToolEntry } from '../gemini/tools/internal'
import type { ToolRegistry } from '../gemini/tools/registry'
import { extractReadable, type ExtractedPage } from './extract'
import type { FetchedPage } from './fetchPage'
import { buildInjectionWarning, buildUntrustedWebContent, detectInjection } from './injection'
import { SearchLimitError, SearchQuotaError, type SearchTurnLimits } from './limits'

/**
 * Ferramentas de pesquisa (task 10, T4/T9).
 *
 * `fetch_url` abre APENAS a URL que o usuário forneceu (ou uma fonte citada),
 * com `fetchPage` + `extractReadable`. Não existe busca por scraping de página
 * de resultado: a descoberta é o grounding (`web_search`).
 */

export const FETCH_URL_TOOL_NAME = 'fetch_url'
export const WEB_SEARCH_TOOL_NAME = 'web_search'
export const WEB_TOOL_CATEGORY = 'web.search'
export const FETCH_URL_TOOL_TIMEOUT_MS = 20_000
export const WEB_SEARCH_TOOL_TIMEOUT_MS = 90_000

export const DYNAMIC_PAGE_WARNING =
  'A página parece depender de JavaScript; a extração é limitada e pode faltar conteúdo.'

/** Auditoria sem conteúdo: só tipo, host, bytes e sucesso. */
export interface SearchAuditEvent {
  at: string
  kind: SearchKind
  host: string
  bytes: number
  ok: boolean
}

export interface FetchUrlToolDeps {
  /** `web.enabled` lido a cada chamada; desligado recusa sem rede. */
  isEnabled: () => boolean
  fetchPage: (url: string) => Promise<FetchedPage>
  extract?: (html: string, url: string) => ExtractedPage
  /** Contadores do turno; ausente apenas em teste unitário do extrator. */
  limits?: SearchTurnLimits
  /** Indicador do overlay (`search:indicator`). */
  onActivity?: (active: boolean, kind: SearchKind) => void
  audit?: (event: SearchAuditEvent) => void
}

export interface FetchUrlToolResult {
  finalUrl: string
  status: number
  contentType: string
  bytes: number
  title: string
  content: string
  truncated: boolean
  warnings: string[]
  sources: WebSource[]
}

export function createFetchUrlDefinition(): ToolDefinition {
  return {
    name: FETCH_URL_TOOL_NAME,
    description:
      'Abre uma URL http/https fornecida pelo usuário e devolve o conteúdo legível da página ' +
      'para você resumir. Use somente com um link que o usuário colou ou que veio de uma fonte citada.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL completa http ou https.',
          minLength: 1,
          maxLength: MAX_FETCH_URL_CHARS
        }
      },
      required: ['url'],
      additionalProperties: false
    },
    sensitive: false,
    category: WEB_TOOL_CATEGORY,
    timeoutMs: FETCH_URL_TOOL_TIMEOUT_MS
  }
}

/**
 * Heurística conservadora de página dinâmica: muito HTML e pouco texto, ou
 * raiz de SPA sem conteúdo extraível. Não tenta executar JavaScript.
 */
export function looksLikeDynamicPage(html: string, extracted: ExtractedPage): boolean {
  const visible = extracted.text.trim()
  if (visible.length >= 500) return false
  const spaRoot = /<(div|main|section)[^>]+id=["'](root|app)["']/i.test(html)
  if (spaRoot && visible.length < 500) return true
  if (visible.length >= 200) return false
  return html.length > 500 && visible.length < 500
}

function titleFor(page: FetchedPage, extracted: ExtractedPage): string {
  if (extracted.title.trim()) return extracted.title.trim()
  try {
    return new URL(page.finalUrl).hostname
  } catch {
    return page.finalUrl
  }
}

export function createFetchUrlHandler(deps: FetchUrlToolDeps) {
  const extract = deps.extract ?? extractReadable
  return async (args: Record<string, unknown>): Promise<FetchUrlToolResult> => {
    if (!deps.isEnabled()) {
      throw new Error('Pesquisa na internet desligada (web.enabled = false).')
    }
    const raw = typeof args.url === 'string' ? args.url.trim() : ''
    if (!raw || raw.length > MAX_FETCH_URL_CHARS) {
      throw new Error(`URL inválida (máximo ${MAX_FETCH_URL_CHARS} caracteres).`)
    }
    const allowed = parseAllowedExternalUrl(raw)
    if (!allowed) throw new Error('Apenas URLs http ou https podem ser abertas.')

    if (deps.limits) {
      const decision = deps.limits.check('fetch')
      if (!decision.ok) {
        if (decision.reason === 'monthly') throw new SearchQuotaError(decision.message)
        throw new SearchLimitError(decision.message)
      }
      deps.limits.consume('fetch')
    }

    const host = (() => {
      try {
        return new URL(allowed).hostname
      } catch {
        return ''
      }
    })()
    let bytes = 0
    let ok = false
    deps.onActivity?.(true, 'fetch')
    try {
      const page = await deps.fetchPage(allowed)
      bytes = page.bytes
      const extracted = extract(page.body, page.finalUrl)
      const warnings: string[] = []
      if (looksLikeDynamicPage(page.body, extracted)) warnings.push(DYNAMIC_PAGE_WARNING)
      const injectionWarning = buildInjectionWarning(detectInjection(extracted.text))
      if (injectionWarning) warnings.push(injectionWarning)
      const title = titleFor(page, extracted)
      const content =
        extracted.text.length > MAX_PAGE_CHARS
          ? extracted.text.slice(0, MAX_PAGE_CHARS)
          : extracted.text

      ok = true
      return {
        finalUrl: page.finalUrl,
        status: page.status,
        contentType: page.contentType,
        bytes: page.bytes,
        title,
        content: buildUntrustedWebContent(page.finalUrl, content),
        truncated: extracted.truncated || content.length < extracted.text.length,
        warnings,
        sources: [{ title, url: page.finalUrl }]
      }
    } finally {
      deps.onActivity?.(false, 'fetch')
      deps.audit?.({
        at: new Date().toISOString(),
        kind: 'fetch',
        host,
        bytes,
        ok
      })
    }
  }
}

/** Entradas de ferramenta disponíveis com `web.enabled`; vazio quando off. */
export function createWebToolEntries(options: {
  enabled: boolean
  fetchUrl: FetchUrlToolDeps
  webSearch?: WebSearchToolDeps
}): ToolEntry[] {
  if (!options.enabled) return []
  const entries: ToolEntry[] = []
  if (options.webSearch) {
    entries.push({
      definition: createWebSearchDefinition(),
      handler: createWebSearchHandler(options.webSearch) as unknown as ToolEntry['handler']
    })
  }
  entries.push({
    definition: createFetchUrlDefinition(),
    handler: createFetchUrlHandler(options.fetchUrl) as unknown as ToolEntry['handler']
  })
  return entries
}

export interface WebSearchResultLike {
  ok: boolean
  text?: string
  sources?: WebSource[]
  error?: { kind: string; message: string }
}

export interface WebSearchToolDeps {
  isEnabled: () => boolean
  /** Busca grounded (engine da task 05); erros vêm estruturados. */
  search: (query: string) => Promise<WebSearchResultLike>
  limits?: SearchTurnLimits
  onActivity?: (active: boolean, kind: SearchKind) => void
  audit?: (event: SearchAuditEvent) => void
}

export interface WebSearchToolResult {
  answer: string
  sources: WebSource[]
  noSources: boolean
  warnings: string[]
}

export function createWebSearchDefinition(): ToolDefinition {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      'Pesquisa na internet com grounding do Google e devolve uma resposta curta com fontes. ' +
      'Use quando o usuário pedir informação atual ou que exija verificação.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Consulta de busca, objetiva e sem dados pessoais.',
          minLength: 1,
          maxLength: MAX_SEARCH_QUERY_CHARS
        }
      },
      required: ['query'],
      additionalProperties: false
    },
    sensitive: false,
    category: WEB_TOOL_CATEGORY,
    timeoutMs: WEB_SEARCH_TOOL_TIMEOUT_MS
  }
}

export function createWebSearchHandler(deps: WebSearchToolDeps) {
  return async (args: Record<string, unknown>): Promise<WebSearchToolResult> => {
    if (!deps.isEnabled()) {
      throw new Error('Pesquisa na internet desligada (web.enabled = false).')
    }
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query || query.length > MAX_SEARCH_QUERY_CHARS) {
      throw new Error(`Consulta inválida (1 a ${MAX_SEARCH_QUERY_CHARS} caracteres).`)
    }

    if (deps.limits) {
      const decision = deps.limits.check('search')
      if (!decision.ok) {
        if (decision.reason === 'monthly') throw new SearchQuotaError(decision.message)
        throw new SearchLimitError(decision.message)
      }
      deps.limits.consume('search')
    }

    let ok = false
    let sources: WebSource[] = []
    deps.onActivity?.(true, 'search')
    try {
      const result = await deps.search(query)
      if (!result.ok) {
        if (result.error?.kind === 'quota') {
          throw new SearchQuotaError(result.error.message)
        }
        throw new Error(result.error?.message ?? 'A busca falhou.')
      }
      sources = Array.isArray(result.sources) ? result.sources : []
      ok = true
      return {
        answer: typeof result.text === 'string' ? result.text : '',
        sources,
        noSources: sources.length === 0,
        warnings: []
      }
    } finally {
      deps.onActivity?.(false, 'search')
      deps.audit?.({
        at: new Date().toISOString(),
        kind: 'search',
        host: sources.length > 0 ? hostOf(sources[0]?.url ?? '') : 'google',
        bytes: 0,
        ok
      })
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export interface WebToolRegistration {
  ok: boolean
  errors: string[]
  registered: string[]
}

/**
 * Registra as ferramentas no registro composto. Com `enabled:false` NADA é
 * registrado: o modelo nem sabe que as ferramentas existem.
 */
export function registerWebTools(
  registry: ToolRegistry,
  handlers: Map<string, ToolEntry['handler']>,
  options: {
    enabled: boolean
    fetchUrl: FetchUrlToolDeps
    webSearch?: WebSearchToolDeps
  }
): WebToolRegistration {
  const entries = createWebToolEntries(options)
  const errors: string[] = []
  const registered: string[] = []
  for (const entry of entries) {
    const result = registry.registerTool(entry.definition)
    if (!result.ok) {
      errors.push(result.error ?? `falha ao registrar ${entry.definition.name}`)
      continue
    }
    handlers.set(entry.definition.name, entry.handler)
    registered.push(entry.definition.name)
  }
  return { ok: errors.length === 0, errors, registered }
}
