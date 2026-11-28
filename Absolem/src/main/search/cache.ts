import { SEARCH_CACHE_MAX_ENTRIES, SEARCH_CACHE_TTL_MS } from '../../shared/search'

/**
 * Cache curto e LRU em memória (task 10, T6) com coalescência de requisições
 * idênticas (task 07, T2).
 *
 * - chave = URL normalizada, SEM fragmento e COM query;
 * - máximo de 50 entradas, TTL de 10 min;
 * - `get` renova a posição (LRU de verdade);
 * - `set` descarta entradas vencidas antes de evictar, para não gastar a vaga
 *   com página que já expirou;
 * - `getOrLoad` compartilha UMA requisição em voo por chave, mas cada chamador
 *   tem seu próprio sinal: cancelar um não derruba os demais; quando o último
 *   desiste, a requisição de rede é abortada;
 * - contadores locais são só números (hit/miss/evicção/expiração/coalescência/
 *   cancelamento), nunca URL ou conteúdo;
 * - nada é gravado em disco e o estado morre com o processo; o main também
 *   limpa no `will-quit`;
 * - busca grounded NÃO é cacheada por query (resultado muda e envolve custo);
 *   apenas a abertura de página (`fetch_url`) usa este cache.
 */

export interface SearchCacheOptions {
  now?: () => number
  maxEntries?: number
  ttlMs?: number
}

interface CacheEntry<T> {
  value: T
  storedAt: number
}

interface Inflight<T> {
  promise: Promise<T>
  controller: AbortController
  waiters: number
  settled: boolean
}

export interface SearchCacheSnapshot {
  entries: number
  maxEntries: number
  ttlSeconds: number
  hits: number
  misses: number
  evictions: number
  expirations: number
  coalesced: number
  cancelled: number
}

/** Cancelamento de um chamador; não é falha de SSRF, rede ou limite. */
export class SearchRequestCancelledError extends Error {
  readonly kind = 'cancelled'

  constructor(message = 'Requisição de pesquisa cancelada.') {
    super(message)
    this.name = 'SearchRequestCancelledError'
  }
}

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new SearchRequestCancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new SearchRequestCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

export class SearchCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly inflight = new Map<string, Inflight<T>>()
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly ttlMs: number

  private hits = 0
  private misses = 0
  private evictions = 0
  private expirations = 0
  private coalesced = 0
  private cancelled = 0
  private loads = 0

  constructor(options: SearchCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? SEARCH_CACHE_MAX_ENTRIES))
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? SEARCH_CACHE_TTL_MS))
  }

  private isExpired(entry: CacheEntry<T>, now: number): boolean {
    return now - entry.storedAt >= this.ttlMs
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (!this.isExpired(entry, now)) continue
      this.entries.delete(key)
      this.expirations += 1
    }
  }

  get(key: string): T | null {
    const entry = this.entries.get(key)
    if (!entry) {
      this.misses += 1
      return null
    }
    const now = this.now()
    if (this.isExpired(entry, now)) {
      this.entries.delete(key)
      this.expirations += 1
      this.misses += 1
      return null
    }
    this.hits += 1
    // Renova a posição: o Map preserva ordem de inserção e o mais antigo é o
    // primeiro candidato a sair.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    if (!key) return
    const now = this.now()
    // Só vale varrer entradas vencidas quando a vaga está disputada; abaixo do
    // teto, a expiração é preguiçosa (get/snapshot).
    if (this.entries.size >= this.maxEntries) this.pruneExpired(now)
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, { value, storedAt: now })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
      this.evictions += 1
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  size(): number {
    return this.entries.size
  }

  /**
   * Devolve o valor em cache ou executa `loader` uma única vez por chave.
   *
   * - `signal` cancela APENAS este chamador; a requisição compartilhada só é
   *   abortada quando não sobra nenhum interessado;
   * - resultado de requisição abandonada não entra no cache;
   * - falha do loader é propagada a todos os chamadores e não é cacheada.
   */
  async getOrLoad(
    key: string,
    loader: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (!key) return loader(signal ?? new AbortController().signal)
    if (signal?.aborted) {
      this.cancelled += 1
      throw new SearchRequestCancelledError()
    }

    const cached = this.get(key)
    if (cached !== null) return cached

    let entry = this.inflight.get(key)
    if (entry) {
      this.coalesced += 1
    } else {
      this.loads += 1
      const controller = new AbortController()
      const promise = Promise.resolve()
        .then(() => loader(controller.signal))
        .then(
          (value) => {
            if (!controller.signal.aborted) this.set(key, value)
            const current = this.inflight.get(key)
            if (current?.controller === controller) {
              current.settled = true
              this.inflight.delete(key)
            }
            return value
          },
          (error: unknown) => {
            const current = this.inflight.get(key)
            if (current?.controller === controller) {
              current.settled = true
              this.inflight.delete(key)
            }
            throw error
          }
        )
      const created: Inflight<T> = { promise, controller, waiters: 0, settled: false }
      // Se todos os chamadores desistirem antes de a rede responder, a rejeição
      // do abort não pode virar "unhandled rejection".
      promise.catch(() => undefined)
      this.inflight.set(key, created)
      entry = created
    }

    entry.waiters += 1
    try {
      return await waitFor(entry.promise, signal)
    } catch (error) {
      if (error instanceof SearchRequestCancelledError) this.cancelled += 1
      throw error
    } finally {
      entry.waiters -= 1
      if (entry.waiters <= 0 && !entry.settled) {
        if (this.inflight.get(key) === entry) this.inflight.delete(key)
        entry.controller.abort()
      }
    }
  }

  clear(): void {
    this.entries.clear()
    for (const entry of this.inflight.values()) entry.controller.abort()
    this.inflight.clear()
  }

  snapshot(): SearchCacheSnapshot {
    this.pruneExpired(this.now())
    return {
      entries: this.entries.size,
      maxEntries: this.maxEntries,
      ttlSeconds: Math.round(this.ttlMs / 1000),
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expirations: this.expirations,
      coalesced: this.coalesced,
      cancelled: this.cancelled
    }
  }

  /** Só para teste/diagnóstico; não expõe chave nem valor. */
  stats(): {
    hits: number
    misses: number
    evictions: number
    expirations: number
    coalesced: number
    cancelled: number
    loads: number
    inflight: number
  } {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expirations: this.expirations,
      coalesced: this.coalesced,
      cancelled: this.cancelled,
      loads: this.loads,
      inflight: this.inflight.size
    }
  }
}

/** URL sem fragmento (query preservada); `null` para URL inválida. */
export function normalizeCacheKey(raw: string): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  try {
    const url = new URL(raw.trim())
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function createSearchCache<T>(options: SearchCacheOptions = {}): SearchCache<T> {
  return new SearchCache<T>(options)
}
