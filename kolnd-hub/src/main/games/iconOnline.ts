import type { StoredGame } from '../store'

/**
 * Fontes **online** de arte de jogo, com allowlist de hosts e validação rígida.
 *
 * O usuário autorizou explicitamente o uso da internet apenas para buscar a
 * arte do jogo pelo nome/appid. Nada além disso sai da máquina: as funções
 * abaixo só enviam o nome do jogo (query string) ou o appid num caminho.
 *
 * O `fetch` é injetável (`OnlineRequestOptions.fetchImpl`) para os testes
 * rodarem sem rede. Todo resultado é limitado a 4 MB, com timeout de 6 s e
 * cache em memória por sessão (inclusive negativo).
 */

/** Resposta mínima que o módulo precisa de um `fetch` (evita depender de DOM lib). */
export interface OnlineFetchResponse {
  ok: boolean
  status: number
  url?: string
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

/** Assinatura de `fetch` aceita/injetável. */
export type OnlineFetch = (
  url: string,
  init?: {
    signal?: AbortSignal
    headers?: Record<string, string>
    redirect?: 'follow'
  }
) => Promise<OnlineFetchResponse>

export interface OnlineRequestOptions {
  /** `fetch` alternativo (testes). Default: `globalThis.fetch`. */
  fetchImpl?: OnlineFetch
  /** User-Agent enviado às fontes (default `KolndHub/1.2.1`). */
  userAgent?: string
  /** Timeout por requisição (default 6 s). */
  timeoutMs?: number
  /** Pausa entre buscas por nome (default 250 ms; injetável nos testes). */
  sleep?: (ms: number) => Promise<void>
}

/** Arte encontrada numa fonte online, pronta para o cofre. */
export interface OnlineArt {
  buffer: Buffer
  ext: '.png' | '.jpg' | '.webp'
  source: 'steam-cdn' | 'steam-search' | 'wikipedia'
  /** URL final de onde os bytes vieram. */
  url: string
}

/** Informações do jogo usadas para escolher a fonte online. */
export interface OnlineGameInfo {
  name: string
  steamAppId?: number
  origin?: StoredGame['origin']
}

/** Timeout padrão por requisição. */
export const ONLINE_TIMEOUT_MS = 6000
/** Teto de bytes de uma imagem remota. */
export const ONLINE_MAX_BYTES = 4 * 1024 * 1024
/** Pausa entre buscas por nome (sequenciais). */
export const ONLINE_SEARCH_GAP_MS = 250

const DEFAULT_USER_AGENT = 'KolndHub/1.2.1'

/** Hosts permitidos — qualquer outro é recusado antes do `fetch`. */
const ALLOWED_HOSTS = new Set([
  'cdn.cloudflare.steamstatic.com',
  'store.steampowered.com',
  'en.wikipedia.org',
  'upload.wikimedia.org'
])

const IMAGE_EXT_BY_TYPE: Record<string, OnlineArt['ext']> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
}

/** Substrings de add-ons que não devem casar com o jogo base. */
const ADDON_MARKERS = ['dlc', 'soundtrack', 'artbook', 'season pass', 'expansion', 'upgrade pack']

/** Palavras extras aceitáveis em edições do mesmo jogo. */
const ALLOWED_EXTRA_WORDS = new Set([
  'edition',
  'deluxe',
  'definitive',
  'complete',
  'ultimate',
  'enhanced',
  'remastered',
  'goty',
  'game',
  'of',
  'the',
  'year',
  'collection',
  'classic'
])

/** `true` quando a URL aponta para um host da allowlist. */
export function isAllowedOnlineHost(url: string): boolean {
  try {
    return ALLOWED_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * A API da Wikipédia atualmente entrega thumbnails em `thumb.wikimedia.org`;
 * o mesmo caminho é servido por `upload.wikimedia.org` (que está na allowlist).
 * Normaliza o host para manter a allowlist fechada.
 */
export function normalizeWikipediaThumbUrl(source: string): string | null {
  try {
    const url = new URL(source)
    if (url.hostname.toLowerCase() === 'thumb.wikimedia.org') {
      url.hostname = 'upload.wikimedia.org'
    }
    return isAllowedOnlineHost(url.href) ? url.href : null
  } catch {
    return null
  }
}

/** Normaliza nome para comparação: sem acento, ®™/pontuação, caixa e espaços extras. */
export function normalizeGameName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[®™©]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Trigrams (com bordas) de um texto já normalizado. */
function trigrams(value: string): Set<string> {
  const padded = ` ${value} `
  const grams = new Set<string>()
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    grams.add(padded.slice(index, index + 3))
  }
  return grams
}

/** Coeficiente de Dice por trigramas (0–1). */
export function diceCoefficient(a: string, b: string): number {
  const left = normalizeGameName(a)
  const right = normalizeGameName(b)
  if (!left && !right) return 1
  if (!left || !right) return 0
  if (left === right) return 1
  const gramsA = trigrams(left)
  const gramsB = trigrams(right)
  let intersection = 0
  for (const gram of gramsA) if (gramsB.has(gram)) intersection += 1
  return (2 * intersection) / (gramsA.size + gramsB.size)
}

function hasExtraAddon(query: string, candidate: string): boolean {
  return ADDON_MARKERS.some((marker) => candidate.includes(marker) && !query.includes(marker))
}

function hasExtraNumber(queryTokens: string[], candidateTokens: string[]): boolean {
  const queryNumbers = new Set(queryTokens.filter((token) => /^\d+$/.test(token)))
  return candidateTokens.some((token) => /^\d+$/.test(token) && !queryNumbers.has(token))
}

/**
 * Aceita o candidato só quando a similaridade é alta. Rejeita add-ons (DLC,
 * soundtrack…) e sequências com número que o nome buscado não tem.
 */
export function isHighConfidenceNameMatch(queryTitle: string, candidateTitle: string): boolean {
  const query = normalizeGameName(queryTitle)
  const candidate = normalizeGameName(candidateTitle)
  if (!query || !candidate) return false
  if (query === candidate) return true
  if (hasExtraAddon(query, candidate)) return false

  const queryTokens = query.split(' ')
  const candidateTokens = candidate.split(' ')
  if (hasExtraNumber(queryTokens, candidateTokens)) return false

  // Palavra extra que não é de edição (ex.: "Sideswipe", "Below Zero") indica
  // outro jogo/sequência — recusa antes de olhar similaridade.
  const extraTokens = candidateTokens.filter((token) => !queryTokens.includes(token))
  if (extraTokens.some((token) => !ALLOWED_EXTRA_WORDS.has(token))) return false

  const tokensContained = queryTokens.every((token) => candidateTokens.includes(token))
  return tokensContained || diceCoefficient(query, candidate) >= 0.8
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const steamArtCache = new Map<string, OnlineArt | null>()
const steamArtInflight = new Map<string, Promise<OnlineArt | null>>()
const wikipediaCache = new Map<string, OnlineArt | null>()
const wikipediaInflight = new Map<string, Promise<OnlineArt | null>>()
const searchCache = new Map<string, number | null>()
const searchInflight = new Map<string, Promise<number | null>>()

let searchQueue: Promise<unknown> = Promise.resolve()
let lastSearchFinishedAt = 0

/** Limpa todos os caches da sessão (testes/diagnóstico). */
export function clearIconOnlineCache(): void {
  steamArtCache.clear()
  steamArtInflight.clear()
  wikipediaCache.clear()
  wikipediaInflight.clear()
  searchCache.clear()
  searchInflight.clear()
  searchQueue = Promise.resolve()
  lastSearchFinishedAt = 0
}

function resolveFetch(options: OnlineRequestOptions): OnlineFetch | null {
  if (options.fetchImpl) return options.fetchImpl
  const globalFetch = (globalThis as { fetch?: OnlineFetch }).fetch
  return typeof globalFetch === 'function' ? globalFetch : null
}

/** Faz a requisição validando allowlist e aplicando timeout. Nunca lança. */
async function request(
  url: string,
  options: OnlineRequestOptions,
  accept: string
): Promise<OnlineFetchResponse | null> {
  if (!isAllowedOnlineHost(url)) return null
  const fetchImpl = resolveFetch(options)
  if (!fetchImpl) return null
  const timeoutMs = options.timeoutMs ?? ONLINE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
        accept
      },
      redirect: 'follow'
    })
    if (!response || !response.ok) return null
    // Redirect para fora da allowlist também é recusado.
    if (response.url && !isAllowedOnlineHost(response.url)) return null
    return response
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isValidImageSize(length: number): boolean {
  return length > 0 && length <= ONLINE_MAX_BYTES
}

/** Lê o corpo como imagem validando content-type e tamanho. */
async function readImage(
  response: OnlineFetchResponse,
  source: OnlineArt['source'],
  url: string
): Promise<OnlineArt | null> {
  try {
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    const ext = contentType ? IMAGE_EXT_BY_TYPE[contentType] : undefined
    if (!ext) return null
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > ONLINE_MAX_BYTES) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!isValidImageSize(buffer.length)) return null
    return { buffer, ext, source, url }
  } catch {
    return null
  }
}

/** Lê JSON com timeout/allowlist já aplicados; null em qualquer falha. */
async function requestJson(
  url: string,
  options: OnlineRequestOptions
): Promise<Record<string, unknown> | null> {
  const response = await request(url, options, 'application/json')
  if (!response) return null
  try {
    const parsed = JSON.parse(await response.text())
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function fetchSteamArtOnce(
  appid: number,
  options: OnlineRequestOptions
): Promise<OnlineArt | null> {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}`
  for (const [file, accept] of [
    ['logo.png', 'image/png,image/*'],
    ['header.jpg', 'image/jpeg,image/*']
  ] as const) {
    const url = `${base}/${file}`
    const response = await request(url, options, accept)
    if (!response) continue
    const art = await readImage(response, 'steam-cdn', url)
    if (art) return art
  }
  return null
}

/** Busca a arte na CDN da Steam pelo appid (`logo.png` → `header.jpg`). */
export async function fetchSteamArt(
  appid: number,
  options: OnlineRequestOptions = {}
): Promise<OnlineArt | null> {
  if (!Number.isInteger(appid) || appid <= 0) return null
  const key = String(appid)
  if (steamArtCache.has(key)) return steamArtCache.get(key) ?? null
  const inflight = steamArtInflight.get(key)
  if (inflight) return inflight

  const task = fetchSteamArtOnce(appid, options)
    .then((art) => {
      steamArtCache.set(key, art)
      return art
    })
    .catch(() => {
      steamArtCache.set(key, null)
      return null
    })
  steamArtInflight.set(key, task)
  try {
    return await task
  } finally {
    steamArtInflight.delete(key)
  }
}

interface SteamSearchItem {
  id: number
  name: string
  score: number
}

/** Extrai o melhor appid de uma resposta do `storesearch`. */
export function pickSteamSearchResult(query: string, payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const items = (payload as { items?: unknown }).items
  if (!Array.isArray(items)) return null

  const candidates: SteamSearchItem[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (typeof raw.name !== 'string') continue
    if (typeof raw.type === 'string' && raw.type !== 'app') continue
    const id = typeof raw.id === 'number' ? raw.id : Number(raw.id)
    if (!Number.isInteger(id) || id <= 0) continue
    if (!isHighConfidenceNameMatch(query, raw.name)) continue
    candidates.push({ id, name: raw.name, score: diceCoefficient(query, raw.name) })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score || a.id - b.id)
  return candidates[0].id
}

function throttleSearch<T>(options: OnlineRequestOptions, task: () => Promise<T>): Promise<T> {
  const sleep = options.sleep ?? defaultSleep
  const run = searchQueue.then(async () => {
    const wait = lastSearchFinishedAt
      ? Math.max(0, ONLINE_SEARCH_GAP_MS - (Date.now() - lastSearchFinishedAt))
      : 0
    if (wait > 0) await sleep(wait)
    try {
      return await task()
    } finally {
      lastSearchFinishedAt = Date.now()
    }
  })
  searchQueue = run.then(
    () => undefined,
    () => undefined
  )
  return run as Promise<T>
}

async function searchSteamAppIdOnce(
  name: string,
  options: OnlineRequestOptions
): Promise<number | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
    name.trim()
  )}&l=portuguese&cc=BR`
  const payload = await requestJson(url, options)
  return payload ? pickSteamSearchResult(name, payload) : null
}

/**
 * Busca o appid pelo nome na loja da Steam. Cacheia por nome (inclusive
 * negativo), deduplica chamadas concorrentes e serializa as buscas.
 */
export async function searchSteamAppId(
  name: string,
  options: OnlineRequestOptions = {}
): Promise<number | null> {
  const key = normalizeGameName(name)
  if (!key) return null
  if (searchCache.has(key)) return searchCache.get(key) ?? null
  const inflight = searchInflight.get(key)
  if (inflight) return inflight

  const task = throttleSearch(options, async () => {
    const result = await searchSteamAppIdOnce(name, options)
    searchCache.set(key, result)
    return result
  }).catch(() => {
    searchCache.set(key, null)
    return null
  })
  searchInflight.set(key, task)
  try {
    return await task
  } finally {
    searchInflight.delete(key)
  }
}

async function fetchWikipediaCoverOnce(
  name: string,
  options: OnlineRequestOptions
): Promise<OnlineArt | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&pithumbsize=256&redirects=1&titles=${encodeURIComponent(
    name.trim()
  )}`
  const payload = await requestJson(url, options)
  if (!payload) return null
  const query = payload.query
  if (!query || typeof query !== 'object') return null
  const pages = (query as { pages?: unknown }).pages
  if (!pages || typeof pages !== 'object') return null

  for (const page of Object.values(pages as Record<string, unknown>)) {
    if (!page || typeof page !== 'object') continue
    const thumbnail = (page as { thumbnail?: unknown }).thumbnail
    if (!thumbnail || typeof thumbnail !== 'object') continue
    const source = (thumbnail as { source?: unknown }).source
    if (typeof source !== 'string') continue
    const imageUrl = normalizeWikipediaThumbUrl(source)
    if (!imageUrl) continue
    const response = await request(imageUrl, options, 'image/*')
    if (!response) continue
    const art = await readImage(response, 'wikipedia', imageUrl)
    if (art) return art
  }
  return null
}

/** Busca a capa na Wikipédia (thumbnail 256) como última fonte online. */
export async function fetchWikipediaCover(
  name: string,
  options: OnlineRequestOptions = {}
): Promise<OnlineArt | null> {
  const key = normalizeGameName(name)
  if (!key) return null
  if (wikipediaCache.has(key)) return wikipediaCache.get(key) ?? null
  const inflight = wikipediaInflight.get(key)
  if (inflight) return inflight

  const task = fetchWikipediaCoverOnce(name, options)
    .then((art) => {
      wikipediaCache.set(key, art)
      return art
    })
    .catch(() => {
      wikipediaCache.set(key, null)
      return null
    })
  wikipediaInflight.set(key, task)
  try {
    return await task
  } finally {
    wikipediaInflight.delete(key)
  }
}

/**
 * Cascata online para um jogo: CDN por appid → busca por nome na Steam →
 * capa da Wikipédia. Devolve null quando nenhuma fonte entrega imagem válida.
 */
export async function fetchOnlineArtForGame(
  game: OnlineGameInfo,
  options: OnlineRequestOptions = {}
): Promise<OnlineArt | null> {
  if (typeof game.steamAppId === 'number' && Number.isInteger(game.steamAppId)) {
    const byId = await fetchSteamArt(game.steamAppId, options)
    if (byId) return byId
  }

  const searchedAppId = await searchSteamAppId(game.name, options)
  if (searchedAppId !== null && searchedAppId !== game.steamAppId) {
    const bySearch = await fetchSteamArt(searchedAppId, options)
    if (bySearch) return { ...bySearch, source: 'steam-search' }
  }

  return fetchWikipediaCover(game.name, options)
}
