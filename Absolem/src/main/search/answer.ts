import { MAX_GROUNDED_SOURCES, isAllowedExternalUrl, type WebSource } from '../../shared/search'

/**
 * Montagem da resposta com fontes (task 10, T5).
 *
 * Regras:
 * - a resposta continua sendo escrita pelo modelo; o bloco `Fontes:` entra no
 *   FIM, numerado `[1] título - url`;
 * - citação `[n]` sem fonte correspondente é removida (nunca renumeramos para
 *   uma fonte diferente da que o modelo viu);
 * - fonte com esquema diferente de http/https é descartada;
 * - sem metadata de grounding, a resposta leva o aviso "sem fontes
 *   verificáveis" em vez de inventar uma fonte.
 */

export const SOURCES_HEADER = 'Fontes:'
export const NO_SOURCES_WARNING = 'Aviso: sem fontes verificáveis nesta resposta.'

const CITATION_PATTERN = /\[(\d+(?:\s*,\s*\d+)*)\]/g

export function sanitizeCitationIndices(text: string, sourceCount: number): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  return text
    .replace(CITATION_PATTERN, (_match, group: string) => {
      const indices = group
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= sourceCount)
      if (indices.length === 0) return ''
      return `[${[...new Set(indices)].join(',')}]`
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
}

/** Só fontes http/https, deduplicadas por URL, no máximo 8. */
export function sanitizeSources(sources: readonly WebSource[]): WebSource[] {
  const seen = new Set<string>()
  const result: WebSource[] = []
  for (const source of sources) {
    if (!source || typeof source.url !== 'string' || !isAllowedExternalUrl(source.url)) continue
    const url = new URL(source.url)
    url.hash = ''
    const key = url.toString()
    if (seen.has(key)) continue
    seen.add(key)
    const title =
      typeof source.title === 'string' && source.title.trim()
        ? source.title.trim().slice(0, 200)
        : url.hostname
    result.push({ title, url: key })
    if (result.length >= MAX_GROUNDED_SOURCES) break
  }
  return result
}

export function mergeSources(
  current: readonly WebSource[],
  incoming: readonly WebSource[]
): WebSource[] {
  return sanitizeSources([...current, ...incoming])
}

export function buildSourcesBlock(sources: readonly WebSource[]): string {
  const valid = sanitizeSources(sources)
  if (valid.length === 0) return ''
  const lines = valid.map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`)
  return [SOURCES_HEADER, ...lines].join('\n')
}

export interface ComposeWebAnswerOptions {
  sources?: readonly WebSource[]
  /** `true` quando a busca não devolveu metadata de grounding. */
  noSources?: boolean
  /** Avisos fixos (injection, página dinâmica) prefixados na resposta. */
  warnings?: readonly string[]
}

export interface ComposedWebAnswer {
  text: string
  sources: WebSource[]
}

/**
 * Fecha o turno: prefixa avisos, corrige citações e acrescenta o bloco de
 * fontes (ou o aviso de ausência) no fim.
 */
export function composeWebAnswer(
  text: string,
  options: ComposeWebAnswerOptions = {}
): ComposedWebAnswer {
  const sources = sanitizeSources(options.sources ?? [])
  const body = sanitizeCitationIndices(text, sources.length).trim()
  const warnings = (options.warnings ?? [])
    .map((warning) => (typeof warning === 'string' ? warning.trim() : ''))
    .filter((warning) => warning.length > 0)

  const parts: string[] = []
  if (warnings.length > 0) parts.push([...new Set(warnings)].join('\n'))
  if (body) parts.push(body)

  const sourcesBlock = buildSourcesBlock(sources)
  if (sourcesBlock) parts.push(sourcesBlock)
  else if (options.noSources === true || sources.length === 0) {
    parts.push(NO_SOURCES_WARNING)
  }

  return { text: parts.join('\n\n'), sources }
}
