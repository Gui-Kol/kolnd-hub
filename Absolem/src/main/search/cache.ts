import { SEARCH_CACHE_MAX_ENTRIES, SEARCH_CACHE_TTL_MS } from '../../shared/search'

/**
 * Cache curto e LRU em memória (task 10, T6).
 *
 * - chave = URL normalizada, SEM fragmento e COM query;
 * - máximo de 50 entradas, TTL de 10 min;
 * - `get` renova a posição (LRU de verdade);
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

export interface SearchCacheSnapshot {
  entries: number
  maxEntries: number
  ttlSeconds: number
}

export class SearchCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly now: () => number
  private readonly maxEntries: number
  private readonly ttlMs: number

  constructor(options: SearchCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? SEARCH_CACHE_MAX_ENTRIES))
    this.ttlMs = Math.max(1, Math.floor(options.ttlMs ?? SEARCH_CACHE_TTL_MS))
  }

  get(key: string): T | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (this.now() - entry.storedAt >= this.ttlMs) {
      this.entries.delete(key)
      return null
    }
    // Renova a posição: o Map preserva ordem de inserção e o mais antigo é o
    // primeiro candidato a sair.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: T): void {
    if (!key) return
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, { value, storedAt: this.now() })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }

  size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  snapshot(): SearchCacheSnapshot {
    return {
      entries: this.entries.size,
      maxEntries: this.maxEntries,
      ttlSeconds: Math.round(this.ttlMs / 1000)
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
