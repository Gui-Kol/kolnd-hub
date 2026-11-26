import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SearchCache, createSearchCache, normalizeCacheKey } from './cache'

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    }
  }
}

describe('cache curto de páginas', () => {
  it('hit dentro do TTL e chave normalizada sem fragmento', () => {
    const time = clock()
    const cache = createSearchCache<string>({ now: time.now })

    const key = normalizeCacheKey('https://example.test/artigo?q=1#secao')
    expect(key).toBe('https://example.test/artigo?q=1')
    cache.set(key as string, 'conteúdo')

    time.advance(9 * 60 * 1000)
    expect(cache.get(key as string)).toBe('conteúdo')
    expect(cache.get(normalizeCacheKey('https://example.test/artigo?q=1#outro') as string)).toBe(
      'conteúdo'
    )
  })

  it('expira depois de 10 min com relógio fake', () => {
    const time = clock()
    const cache = new SearchCache<number>({ now: time.now })
    cache.set('https://example.test/a', 1)

    time.advance(10 * 60 * 1000 - 1)
    expect(cache.get('https://example.test/a')).toBe(1)

    time.advance(1)
    expect(cache.get('https://example.test/a')).toBeNull()
    expect(cache.size()).toBe(0)
  })

  it('LRU descarta o mais antigo (e get renova a posição)', () => {
    const time = clock()
    const cache = new SearchCache<string>({ now: time.now, maxEntries: 2 })
    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.get('a')).toBe('A') // `a` volta para o topo
    cache.set('c', 'C')

    expect(cache.get('b')).toBeNull()
    expect(cache.get('a')).toBe('A')
    expect(cache.get('c')).toBe('C')
    expect(cache.snapshot()).toEqual({ entries: 2, maxEntries: 2, ttlSeconds: 600 })
  })

  it('nada é gravado em disco e instância nova nasce vazia', () => {
    const cache = createSearchCache<string>()
    cache.set('https://example.test/a', 'A')
    expect(cache.get('https://example.test/a')).toBe('A')

    // Prova por código: o módulo não importa fs nem escreve arquivo.
    const source = readFileSync(new URL('./cache.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"]node:fs/)
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/)

    const fresh = createSearchCache<string>()
    expect(fresh.size()).toBe(0)
    expect(fresh.get('https://example.test/a')).toBeNull()
  })
})
