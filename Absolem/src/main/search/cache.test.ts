import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  SearchCache,
  SearchRequestCancelledError,
  createSearchCache,
  normalizeCacheKey
} from './cache'

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
    expect(cache.snapshot()).toMatchObject({
      entries: 2,
      maxEntries: 2,
      ttlSeconds: 600,
      evictions: 1,
      hits: 3
    })
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

  it('vencido é descartado antes de evictar e não ocupa vaga', () => {
    const time = clock()
    const cache = new SearchCache<number>({ now: time.now, maxEntries: 2 })
    cache.set('a', 1)
    time.advance(10 * 60 * 1000) // 'a' expira

    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.stats()).toMatchObject({ expirations: 1, evictions: 0 })
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size()).toBe(2)
  })

  it('snapshot não expõe chave nem conteúdo', () => {
    const cache = createSearchCache<string>()
    cache.set('https://example.test/segredo?token=ABC', 'CONTEUDO_SENSIVEL')
    cache.get('https://example.test/segredo?token=ABC')
    cache.get('https://example.test/ausente')

    const snapshot = JSON.stringify(cache.snapshot())
    expect(snapshot).not.toContain('example.test')
    expect(snapshot).not.toContain('ABC')
    expect(snapshot).not.toContain('CONTEUDO_SENSIVEL')
    expect(cache.snapshot()).toMatchObject({ hits: 1, misses: 1 })
  })
})

describe('coalescência e cancelamento de requisições idênticas', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('5 chamadas concorrentes usam um único loader e todas recebem o valor', async () => {
    const cache = createSearchCache<string>()
    const gate = deferred<string>()
    const loader = vi.fn(async () => gate.promise)

    const calls = Array.from({ length: 5 }, () => cache.getOrLoad('https://example.test/a', loader))
    await Promise.resolve()
    expect(loader).toHaveBeenCalledTimes(1)

    gate.resolve('página')
    const values = await Promise.all(calls)

    expect(values).toEqual(Array(5).fill('página'))
    expect(cache.get('https://example.test/a')).toBe('página')
    expect(cache.stats()).toMatchObject({ loads: 1, coalesced: 4, inflight: 0 })
  })

  it('chaves diferentes não compartilham a requisição', async () => {
    const cache = createSearchCache<string>()
    const loader = vi.fn(async (signal: AbortSignal) => {
      expect(signal.aborted).toBe(false)
      return 'ok'
    })

    await Promise.all([
      cache.getOrLoad('https://example.test/a', loader),
      cache.getOrLoad('https://example.test/b', loader)
    ])

    expect(loader).toHaveBeenCalledTimes(2)
    expect(cache.stats().coalesced).toBe(0)
  })

  it('cancelar um chamador não derruba os outros e não aborta a rede', async () => {
    const cache = createSearchCache<string>()
    const gate = deferred<string>()
    const controllerA = new AbortController()
    const controllerB = new AbortController()
    let loaderSignal: AbortSignal | undefined
    const loader = vi.fn(async (signal: AbortSignal) => {
      loaderSignal = signal
      return gate.promise
    })

    const a = cache.getOrLoad('k', loader, controllerA.signal)
    const b = cache.getOrLoad('k', loader, controllerB.signal)
    await Promise.resolve()

    controllerA.abort()
    await expect(a).rejects.toBeInstanceOf(SearchRequestCancelledError)
    expect(loaderSignal?.aborted).toBe(false)

    gate.resolve('valor')
    await expect(b).resolves.toBe('valor')
    expect(loader).toHaveBeenCalledTimes(1)
    expect(cache.get('k')).toBe('valor')
    expect(cache.stats()).toMatchObject({ cancelled: 1, coalesced: 1 })
  })

  it('quando o último chamador cancela, a requisição é abortada e não entra no cache', async () => {
    const cache = createSearchCache<string>()
    const gate = deferred<string>()
    const controller = new AbortController()
    let loaderSignal: AbortSignal | undefined
    const loader = vi.fn(async (signal: AbortSignal) => {
      loaderSignal = signal
      return gate.promise
    })

    const call = cache.getOrLoad('k', loader, controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(SearchRequestCancelledError)

    expect(loaderSignal?.aborted).toBe(true)
    expect(cache.stats().inflight).toBe(0)

    // Se o loader ignorar o abort e resolver depois, nada é cacheado.
    gate.resolve('tarde')
    await Promise.resolve()
    await Promise.resolve()
    expect(cache.get('k')).toBeNull()
  })

  it('sinal já abortado não executa o loader', async () => {
    const cache = createSearchCache<string>()
    const controller = new AbortController()
    controller.abort()
    const loader = vi.fn()

    await expect(cache.getOrLoad('k', loader, controller.signal)).rejects.toBeInstanceOf(
      SearchRequestCancelledError
    )
    expect(loader).not.toHaveBeenCalled()
    expect(cache.stats().cancelled).toBe(1)
  })
})
