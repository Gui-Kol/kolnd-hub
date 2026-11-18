import { describe, expect, it } from 'vitest'
import { computeWindowedRange, gridRowCount, scrollTopToReveal } from './windowedGrid'
import type { WindowedGridInput } from './windowedGrid'

// Grade de referência: cards de 100 px com 20 px de gap entre linhas (pitch 120).
function input(overrides: Partial<WindowedGridInput> = {}): WindowedGridInput {
  return {
    scrollTop: 0,
    viewportHeight: 240,
    rowHeight: 100,
    rowGap: 20,
    columns: 4,
    itemCount: 100,
    overscanRows: 1,
    ...overrides
  }
}

describe('gridRowCount', () => {
  it('arredonda para cima e trata lista vazia/colunas inválidas', () => {
    expect(gridRowCount(0, 4)).toBe(0)
    expect(gridRowCount(1, 4)).toBe(1)
    expect(gridRowCount(4, 4)).toBe(1)
    expect(gridRowCount(5, 4)).toBe(2)
    expect(gridRowCount(8, 0)).toBe(8)
    expect(gridRowCount(8, 2.9)).toBe(4)
  })
})

describe('computeWindowedRange', () => {
  it('grade vazia: janela vazia e sem espaçadores', () => {
    expect(computeWindowedRange(input({ itemCount: 0 }))).toEqual({
      startIndex: 0,
      endIndex: 0,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      startRow: 0,
      endRow: 0
    })
  })

  it('menos itens que uma tela: renderiza tudo sem espaçadores', () => {
    const range = computeWindowedRange(input({ itemCount: 6, viewportHeight: 1000 }))
    expect(range).toEqual({
      startIndex: 0,
      endIndex: 6,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
      startRow: 0,
      endRow: 2
    })
  })

  it('sem medição (card ou viewport = 0) renderiza tudo — a grade precisa medir', () => {
    expect(computeWindowedRange(input({ rowHeight: 0 }))).toMatchObject({
      startIndex: 0,
      endIndex: 100,
      startRow: 0,
      endRow: 25
    })
    expect(computeWindowedRange(input({ viewportHeight: 0 }))).toMatchObject({
      startIndex: 0,
      endIndex: 100
    })
  })

  it('alinhamento de linha: a janela começa na linha que contém o topo do viewport', () => {
    // Sem overscan, viewport de 2 linhas (240 px): 119 px ainda é a linha 0;
    // 120 px é a fronteira da linha 1; 240 px é a fronteira da linha 2.
    expect(computeWindowedRange(input({ scrollTop: 119, overscanRows: 0 }))).toMatchObject({
      startRow: 0,
      endRow: 3
    })
    expect(computeWindowedRange(input({ scrollTop: 120, overscanRows: 0 }))).toMatchObject({
      startRow: 1,
      endRow: 3
    })
    expect(computeWindowedRange(input({ scrollTop: 240, overscanRows: 0 }))).toMatchObject({
      startRow: 2,
      endRow: 4
    })
    // Com overscan de 1 linha, a linha 0 entra na janela a partir do scroll 240.
    expect(computeWindowedRange(input({ scrollTop: 240 }))).toMatchObject({
      startRow: 1,
      endRow: 5,
      startIndex: 4,
      endIndex: 20,
      topSpacerPx: 120,
      bottomSpacerPx: 20 * 120
    })
  })

  it('scroll além do fim é clampado ao fim do conteúdo', () => {
    expect(computeWindowedRange(input({ scrollTop: 999_999, overscanRows: 1 }))).toMatchObject({
      endRow: 25,
      endIndex: 100,
      bottomSpacerPx: 0
    })
  })

  it('overscan é clampado no topo e no fim da lista', () => {
    expect(computeWindowedRange(input({ scrollTop: 0, overscanRows: 3 }))).toMatchObject({
      startRow: 0,
      endRow: 5,
      startIndex: 0,
      endIndex: 20
    })
    // Fim da lista: conteúdo = 25×100 + 24×20 = 2980; maxScroll = 2980 − 240 = 2740.
    expect(computeWindowedRange(input({ scrollTop: 2740, overscanRows: 3 }))).toMatchObject({
      startRow: 19,
      endRow: 25,
      startIndex: 76,
      endIndex: 100,
      topSpacerPx: 19 * 120,
      bottomSpacerPx: 0
    })
    // Overscan negativo/fracionário não gera índice negativo.
    expect(computeWindowedRange(input({ scrollTop: 0, overscanRows: -2 })).startRow).toBe(0)
    expect(computeWindowedRange(input({ scrollTop: 240, overscanRows: 0.9 }))).toMatchObject({
      startRow: 2,
      endRow: 4
    })
  })

  it('item âncora sempre entra na janela — inclusive fora do overscan', () => {
    const last = computeWindowedRange(input({ itemCount: 400, scrollTop: 0, anchorIndex: 399 }))
    expect(last.startRow).toBe(0)
    expect(last.endRow).toBe(100)
    expect(last.endIndex).toBe(400)
    expect(last.bottomSpacerPx).toBe(0)

    const first = computeWindowedRange(
      input({ itemCount: 400, scrollTop: 400 * 120, anchorIndex: 0 })
    )
    expect(first.startRow).toBe(0)
    expect(first.endRow).toBe(100)
    expect(first.startIndex).toBe(0)
    expect(first.endIndex).toBe(400)
    expect(first.topSpacerPx).toBe(0)
  })

  it('âncora fora dos limites é ignorada', () => {
    expect(computeWindowedRange(input({ anchorIndex: 100 }))).toMatchObject({
      startRow: 0,
      endRow: 3
    })
    expect(computeWindowedRange(input({ anchorIndex: -1 }))).toMatchObject({ endRow: 3 })
    expect(computeWindowedRange(input({ anchorIndex: null }))).toMatchObject({ endRow: 3 })
  })
})

describe('scrollTopToReveal', () => {
  // 10 linhas de 100 px + 20 px de gap = 1180 px de conteúdo; viewport 500.
  const base = { scrollTop: 0, viewportHeight: 500, rowHeight: 100, rowGap: 20, totalRows: 10 }

  it('linha já visível não muda o scroll', () => {
    expect(scrollTopToReveal({ ...base, scrollTop: 120, row: 2 })).toBe(120)
  })

  it('linha acima: alinha o topo da linha ao topo do viewport', () => {
    expect(scrollTopToReveal({ ...base, scrollTop: 400, row: 2 })).toBe(240)
  })

  it('linha abaixo: alinha a base da linha à base do viewport', () => {
    expect(scrollTopToReveal({ ...base, scrollTop: 0, row: 4 })).toBe(80)
  })

  it('nunca rola além do fim do conteúdo (última linha)', () => {
    expect(scrollTopToReveal({ ...base, scrollTop: 0, row: 9 })).toBe(680)
    expect(scrollTopToReveal({ ...base, scrollTop: 680, row: 9 })).toBe(680)
  })

  it('viewport maior que o conteúdo: nunca rola', () => {
    expect(scrollTopToReveal({ ...base, viewportHeight: 2000, row: 9 })).toBe(0)
  })

  it('primeira linha no topo não gera scroll negativo', () => {
    expect(scrollTopToReveal({ ...base, scrollTop: 0, row: 0 })).toBe(0)
  })

  it('sem medição devolve o scroll atual', () => {
    expect(scrollTopToReveal({ ...base, scrollTop: 300, rowHeight: 0, row: 9 })).toBe(300)
    expect(scrollTopToReveal({ ...base, scrollTop: 300, viewportHeight: 0, row: 9 })).toBe(300)
  })
})
