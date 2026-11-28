/**
 * Resolução de vídeos do YouTube (task 31).
 *
 * O pedido "abre o episódio 400 de casa automática" precisa abrir o vídeo
 * direto (`watch?v=...`), nunca a página de resultados. Este módulo pesquisa a
 * página de resultados do YouTube, extrai `ytInitialData` do HTML e escolhe o
 * vídeo mais compatível com a query — sem dependências novas e com `fetch`
 * injetável para os testes.
 */

export const YOUTUBE_SEARCH_TIMEOUT_MS = 12_000
export const YOUTUBE_MAX_BYTES = 4 * 1024 * 1024
/** Navegador pt-BR: a página de resultados entrega `ytInitialData` completo. */
export const YOUTUBE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36'

export const YOUTUBE_SEARCH_HEADERS: Readonly<Record<string, string>> = {
  'user-agent': YOUTUBE_USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8'
}

export type YoutubeSearchFailureCode =
  'invalid-query' | 'timeout' | 'network' | 'http' | 'too-large' | 'parse' | 'empty'

export class YoutubeSearchError extends Error {
  readonly code: YoutubeSearchFailureCode
  readonly status?: number

  constructor(code: YoutubeSearchFailureCode, message: string, status?: number) {
    super(message)
    this.name = 'YoutubeSearchError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

export interface YoutubeVideoResult {
  videoId: string
  title: string
  channel: string
  length: string
}

export interface ResolvedYoutubeVideo extends YoutubeVideoResult {
  url: string
}

export interface ResolveYoutubeDeps {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  timeoutMs?: number
  maxBytes?: number
  /** Espera entre tentativas; injetável para o teste não dormir de verdade. */
  sleep?: (ms: number) => Promise<void>
  retryDelayMs?: number
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,32}$/

export function buildYoutubeSearchUrl(query: string): string {
  const url = new URL('https://www.youtube.com/results')
  url.searchParams.set('search_query', query.trim())
  url.searchParams.set('hl', 'pt-BR')
  url.searchParams.set('gl', 'BR')
  return url.toString()
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])

/**
 * Reconhece a página de resultados do YouTube e devolve a busca em texto.
 * Usado pelo `open_url` para nunca abrir a página de resultados ao usuário.
 */
export function youtubeSearchQueryFromUrl(raw: string): string | null {
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
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null
  if (url.pathname.replace(/\/+$/, '') !== '/results') return null
  const query = url.searchParams.get('search_query')?.trim() ?? ''
  return query || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fim do objeto JSON que começa em `start`, respeitando strings e escapes. */
function scanJsonObject(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

/**
 * Extrai e interpreta o JSON de `ytInitialData` embutido no HTML.
 * Ignora ocorrências que não sejam `ytInitialData = {`.
 */
export function extractInitialData(html: string): unknown {
  const marker = 'ytInitialData'
  let searchFrom = 0
  let sawCandidate = false
  for (;;) {
    const markerIndex = html.indexOf(marker, searchFrom)
    if (markerIndex < 0) break
    searchFrom = markerIndex + marker.length
    const equals = html.indexOf('=', searchFrom)
    if (equals < 0) break
    if (html.slice(searchFrom, equals).trim() !== '') continue
    let start = equals + 1
    while (start < html.length && /\s/.test(html[start] ?? '')) start += 1
    if (html[start] !== '{') continue
    const end = scanJsonObject(html, start)
    if (end < 0) continue
    sawCandidate = true
    try {
      return JSON.parse(html.slice(start, end)) as unknown
    } catch {
      // Ocorrência em texto/script não relacionado: tenta a próxima.
      continue
    }
  }
  throw new YoutubeSearchError(
    'parse',
    sawCandidate
      ? 'Os dados da pesquisa do YouTube estão corrompidos.'
      : 'A página do YouTube não trouxe os dados da pesquisa (ytInitialData).'
  )
}

function textFromRuns(value: unknown): string {
  if (!isRecord(value)) return ''
  if (typeof value.simpleText === 'string') return value.simpleText
  if (typeof value.text === 'string') return value.text
  const runs = value.runs
  if (!Array.isArray(runs)) return ''
  return runs
    .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim()
}

function parseRenderer(renderer: Record<string, unknown>): YoutubeVideoResult | null {
  const videoId = typeof renderer.videoId === 'string' ? renderer.videoId : ''
  if (!VIDEO_ID_PATTERN.test(videoId)) return null
  const title = textFromRuns(renderer.title)
  if (!title) return null
  return {
    videoId,
    title,
    channel: textFromRuns(renderer.ownerText) || textFromRuns(renderer.longBylineText),
    length: textFromRuns(renderer.lengthText)
  }
}

/** Percorre o JSON e devolve os `videoRenderer` na ordem da página, sem repetir. */
export function parseYoutubeSearch(html: string): YoutubeVideoResult[] {
  const data = extractInitialData(html)
  const results: YoutubeVideoResult[] = []
  const seen = new Set<string>()

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!isRecord(node)) return
    if ('videoRenderer' in node) {
      const renderer = node.videoRenderer
      if (isRecord(renderer)) {
        const video = parseRenderer(renderer)
        if (video && !seen.has(video.videoId)) {
          seen.add(video.videoId)
          results.push(video)
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'videoRenderer') visit(value)
    }
  }

  visit(data)
  return results
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

const STOPWORDS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'em',
  'no',
  'na',
  'nos',
  'nas',
  'para',
  'por',
  'que',
  'um',
  'uma',
  'the',
  'of',
  // Palavras do pedido, não do título: não desempatam entre vídeos da série.
  'episodio',
  'video',
  'assistir',
  'abrir',
  'abre',
  'ver'
])

function queryTokens(query: string): string[] {
  return normalize(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
}

/**
 * Escolhe o resultado mais compatível: termos da query no título (números
 * valem mais, para casar o episódio exato) e, no empate, o primeiro.
 */
export function pickYoutubeVideo(
  results: readonly YoutubeVideoResult[],
  query: string
): YoutubeVideoResult | null {
  if (results.length === 0) return null
  const tokens = queryTokens(query)
  if (tokens.length === 0) return results[0] ?? null

  let best: YoutubeVideoResult | null = null
  let bestScore = -1
  for (const result of results) {
    const title = normalize(result.title)
    let score = 0
    for (const token of tokens) {
      if (!title.includes(token)) continue
      score += /^\d+$/.test(token) ? 4 : 1
    }
    if (score > bestScore) {
      bestScore = score
      best = result
    }
  }
  return best ?? results[0] ?? null
}

function failureMessage(query: string): string {
  return `Nenhum vídeo encontrado no YouTube para "${query}".`
}

function timeoutError(timeoutMs: number): YoutubeSearchError {
  return new YoutubeSearchError(
    'timeout',
    `O YouTube demorou mais de ${Math.round(timeoutMs / 1000)} s para responder.`
  )
}

/** Uma tentativa de busca: baixa o HTML com o tempo restante do orçamento. */
async function fetchSearchHtml(
  query: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  timeoutMs: number,
  maxBytes: number
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let html: string
  try {
    let response: Response
    try {
      response = await fetchImpl(buildYoutubeSearchUrl(query), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { ...YOUTUBE_SEARCH_HEADERS }
      })
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError(timeoutMs)
      throw new YoutubeSearchError(
        'network',
        error instanceof Error
          ? `Falha de rede ao pesquisar no YouTube: ${error.message.slice(0, 200)}`
          : 'Falha de rede ao pesquisar no YouTube.'
      )
    }

    if (response.status < 200 || response.status >= 300) {
      throw new YoutubeSearchError(
        'http',
        `O YouTube respondeu com status ${response.status}.`,
        response.status
      )
    }

    try {
      html = await response.text()
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError(timeoutMs)
      throw new YoutubeSearchError(
        'network',
        error instanceof Error
          ? `Falha ao ler a resposta do YouTube: ${error.message.slice(0, 200)}`
          : 'Falha ao ler a resposta do YouTube.'
      )
    }
  } finally {
    clearTimeout(timer)
  }

  if (html.length > maxBytes) {
    throw new YoutubeSearchError('too-large', 'A página de resultados do YouTube é grande demais.')
  }
  return html
}

/**
 * Pesquisa, extrai e resolve o vídeo. Sem fallback para a página de busca:
 * qualquer falha vira `YoutubeSearchError` com mensagem em português.
 *
 * O YouTube às vezes devolve 200 sem nenhum `videoRenderer` (página vazia
 * transitória). Só nesse caso há uma segunda tentativa, dentro do mesmo
 * orçamento de tempo; erro de rede/HTTP/HTML inválido não é repetido.
 */
export async function resolveYoutubeVideo(
  query: string,
  deps: ResolveYoutubeDeps = {}
): Promise<ResolvedYoutubeVideo> {
  const trimmed = typeof query === 'string' ? query.trim() : ''
  if (!trimmed || trimmed.length > 200) {
    throw new YoutubeSearchError('invalid-query', 'A busca deve ter de 1 a 200 caracteres.')
  }

  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init))
  const timeoutMs = deps.timeoutMs ?? YOUTUBE_SEARCH_TIMEOUT_MS
  const maxBytes = deps.maxBytes ?? YOUTUBE_MAX_BYTES
  const retryDelayMs = deps.retryDelayMs ?? 250
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const deadline = Date.now() + timeoutMs

  const attempt = (): Promise<string> => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw timeoutError(timeoutMs)
    return fetchSearchHtml(trimmed, fetchImpl, remaining, maxBytes)
  }

  const select = (html: string): ResolvedYoutubeVideo => {
    const selected = pickYoutubeVideo(parseYoutubeSearch(html), trimmed)
    if (!selected) throw new YoutubeSearchError('empty', failureMessage(trimmed))
    return { ...selected, url: watchUrl(selected.videoId) }
  }

  try {
    return select(await attempt())
  } catch (error) {
    if (!(error instanceof YoutubeSearchError) || error.code !== 'empty') throw error
    await sleep(retryDelayMs)
    return select(await attempt())
  }
}
