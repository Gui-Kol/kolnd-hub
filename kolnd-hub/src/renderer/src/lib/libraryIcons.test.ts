import { describe, expect, it } from 'vitest'
import {
  ICON_RETRY_DELAYS_MS,
  ICON_RETRY_MAX,
  isGeneratedIconDataUrl,
  nextIconRetryIds,
  pruneIconsForReload,
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
