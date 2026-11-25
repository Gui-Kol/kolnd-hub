import { describe, expect, it, vi } from 'vitest'
import {
  ICON_RETRY_DELAYS_MS,
  ICON_RETRY_MAX,
  isGeneratedIconDataUrl,
  nextIconRetryIds,
  pruneIconsForReload,
  requestIconsForIds,
  retryDelayForAttempt
} from './libraryIcons'

const games = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('retryDelayForAttempt', () => {
  it('usa 1 s, 2 s e 4 s e para depois de 3 tentativas', () => {
    expect(ICON_RETRY_DELAYS_MS).toEqual([1000, 2000, 4000])
    expect(ICON_RETRY_MAX).toBe(3)
    expect(retryDelayForAttempt(1)).toBe(1000)
    expect(retryDelayForAttempt(2)).toBe(2000)
    expect(retryDelayForAttempt(3)).toBe(4000)
    expect(retryDelayForAttempt(4)).toBeNull()
    expect(retryDelayForAttempt(0)).toBeNull()
    expect(retryDelayForAttempt(1.5)).toBeNull()
  })
})

describe('pruneIconsForReload', () => {
  it('descarta null e SVG gerado, preservando imagens reais', () => {
    const png = 'data:image/png;base64,AA=='
    const svg = 'data:image/svg+xml;base64,PHN2Zy8+'
    expect(pruneIconsForReload({ a: png, b: null, c: svg })).toEqual({ a: png })
  })

  it('devolve o mesmo objeto quando nada precisa ser re-pedido', () => {
    const icons = { a: 'data:image/jpeg;base64,AA==' }
    expect(pruneIconsForReload(icons)).toBe(icons)
    expect(pruneIconsForReload({})).toEqual({})
  })

  it('reconhece o prefixo do SVG gerado', () => {
    expect(isGeneratedIconDataUrl('data:image/svg+xml;base64,AA==')).toBe(true)
    expect(isGeneratedIconDataUrl('data:image/png;base64,AA==')).toBe(false)
    expect(isGeneratedIconDataUrl(null)).toBe(false)
  })
})

describe('requestIconsForIds', () => {
  it('aplica as 10 respostas mesmo quando a primeira resolve antes das outras', async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `g${index}`)
    const resolvers = new Map<string, (value: string | null) => void>()
    const applied: string[] = []
    const mounted = true

    const pending = requestIconsForIds(ids, {
      fetchIcon: (id) =>
        new Promise<string | null>((resolve) => {
          resolvers.set(id, resolve)
        }),
      apply: (id) => applied.push(id),
      isMounted: () => mounted
    })

    // Primeira resposta chega e "muda o estado" (re-render), mas o componente
    // continua montado — as outras 9 respostas não podem ser descartadas.
    resolvers.get('g0')?.('data:g0')
    await Promise.resolve()
    await Promise.resolve()
    expect(applied).toEqual(['g0'])

    for (const id of ids.slice(1)) resolvers.get(id)?.(`data:${id}`)
    await pending
    expect(applied).toHaveLength(10)
    expect(new Set(applied).size).toBe(10)
  })

  it('sinaliza falha em onSettled para liberar nova tentativa', async () => {
    const settled: Array<[string, string | null]> = []
    await requestIconsForIds(['a', 'b'], {
      fetchIcon: async (id) => {
        if (id === 'a') throw new Error('falhou')
        return 'data:b'
      },
      apply: () => undefined,
      onSettled: (id, value) => settled.push([id, value]),
      isMounted: () => true
    })
    expect(settled).toContainEqual(['a', null])
    expect(settled).toContainEqual(['b', 'data:b'])
  })

  it('não aplica nada quando desmontado, mas sinaliza o término', async () => {
    const apply = vi.fn()
    const onSettled = vi.fn()
    await requestIconsForIds(['a'], {
      fetchIcon: async () => 'data:a',
      apply,
      onSettled,
      isMounted: () => false
    })
    expect(apply).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledWith('a', 'data:a')
  })
})

describe('nextIconRetryIds', () => {
  it('devolve só ids com null e tentativas disponíveis', () => {
    const attempts = new Map([
      ['b', 1],
      ['c', 3]
    ])
    expect(nextIconRetryIds(games, { a: 'data:', b: null, c: null }, attempts)).toEqual(['b'])
  })

  it('respeita timers já agendados', () => {
    expect(nextIconRetryIds(games, { b: null }, new Map(), new Set(['b']))).toEqual([])
  })

  it('não duplica ids e preserva a ordem dos jogos', () => {
    expect(
      nextIconRetryIds([{ id: 'z' }, { id: 'x' }, { id: 'z' }], { z: null, x: null }, new Map())
    ).toEqual(['z', 'x'])
  })

  it('para em 3 tentativas por id', () => {
    const attempts = new Map([['a', 3]])
    expect(nextIconRetryIds([{ id: 'a' }], { a: null }, attempts)).toEqual([])
    expect(nextIconRetryIds([{ id: 'a' }], { a: null }, new Map([['a', 2]]))).toEqual(['a'])
  })
})
