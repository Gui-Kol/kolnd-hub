// Janela de renderização da grade do Big Picture (virtualização por LINHAS).
//
// Por que por linhas: os cards são altos e a grade é uniforme (N colunas com
// altura/gap constantes). Calcular a janela em coordenadas de linha evita
// medir cada card, mantém o alinhamento do grid e faz `startIndex`/`endIndex`
// caírem sempre em fronteiras de linha — a grade virtualizada continua idêntica
// visualmente à grade completa.
//
// Puro e sem React/DOM: o hook (hooks/useWindowedGrid) mede os números reais e
// chama estas funções na pressão de scroll/resize.

export interface WindowedGridInput {
  /** Scroll vertical atual do container (px). */
  scrollTop: number
  /** Altura visível do container (px). 0 = ainda não medido. */
  viewportHeight: number
  /** Altura de uma linha/card (px). 0 = ainda não medido. */
  rowHeight: number
  /** Espaço vertical entre linhas (`row-gap` computado). */
  rowGap: number
  /** Colunas da grade (breakpoint atual). */
  columns: number
  itemCount: number
  /** Linhas extras montadas acima/abaixo da área visível. */
  overscanRows: number
  /**
   * Índice do item focado. A linha dele é SEMPRE incluída na janela — com o
   * foco fora da área visível o card continua montado para receber o reveal.
   */
  anchorIndex?: number | null
}

export interface WindowedRange {
  /** Primeiro índice de item renderizado (inclusivo). */
  startIndex: number
  /** Último índice de item renderizado (exclusivo). */
  endIndex: number
  /** Espaçador antes da primeira linha renderizada (px). */
  topSpacerPx: number
  /** Espaçador depois da última linha renderizada (px). */
  bottomSpacerPx: number
  /** Primeira linha renderizada (inclusiva). */
  startRow: number
  /** Última linha renderizada (exclusiva). */
  endRow: number
}

const EMPTY_RANGE: WindowedRange = {
  startIndex: 0,
  endIndex: 0,
  topSpacerPx: 0,
  bottomSpacerPx: 0,
  startRow: 0,
  endRow: 0
}

/** Número de linhas da grade (0 sem itens). */
export function gridRowCount(itemCount: number, columns: number): number {
  const safeColumns = Math.max(1, Math.floor(columns))
  if (!Number.isFinite(itemCount) || itemCount <= 0) return 0
  return Math.ceil(itemCount / safeColumns)
}

/**
 * Calcula as linhas a renderizar para o scroll/medição atuais.
 *
 * Sem medição (altura do card ou do viewport = 0, típico do primeiro render) a
 * função devolve TUDO — a grade precisa estar montada para o hook medir a
 * altura real de um card.
 */
export function computeWindowedRange(input: WindowedGridInput): WindowedRange {
  const { itemCount, overscanRows } = input
  const columns = Math.max(1, Math.floor(input.columns))
  const rowCount = gridRowCount(itemCount, columns)
  if (rowCount === 0) return EMPTY_RANGE

  const allRows = (): WindowedRange => ({
    startIndex: 0,
    endIndex: itemCount,
    topSpacerPx: 0,
    bottomSpacerPx: 0,
    startRow: 0,
    endRow: rowCount
  })

  const rowHeight = input.rowHeight
  const viewportHeight = input.viewportHeight
  if (!(rowHeight > 0) || !(viewportHeight > 0)) return allRows()

  const rowGap = Number.isFinite(input.rowGap) && input.rowGap > 0 ? input.rowGap : 0
  // Passo de uma linha: altura do card + gap. O gap não existe depois da
  // última linha — por isso os espaçadores usam `pitch` por linha inteira
  // (o total fecha com `rows*rowHeight + (rows-1)*rowGap`).
  const pitch = rowHeight + rowGap
  const rawScrollTop = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0
  // Scroll além do fim (ex.: lista encurtou) é clampado — sem isso a janela
  // poderia ficar invertida (startRow > endRow) e renderizar nada.
  const contentHeight = rowCount * rowHeight + (rowCount - 1) * rowGap
  const maxScroll = Math.max(0, contentHeight - viewportHeight)
  const scrollTop = Math.min(rawScrollTop, maxScroll)
  const overscan = Number.isFinite(overscanRows) ? Math.max(0, Math.floor(overscanRows)) : 0

  // Linhas visíveis: a que contém o topo do viewport até a que contém a base.
  const firstVisibleRow = Math.floor(scrollTop / pitch)
  const lastVisibleRow = Math.max(
    firstVisibleRow,
    Math.ceil((scrollTop + viewportHeight) / pitch) - 1
  )

  let startRow = Math.max(0, firstVisibleRow - overscan)
  let endRow = Math.min(rowCount, lastVisibleRow + 1 + overscan)

  // Âncora (item focado) sempre na janela — mesmo fora do overscan.
  const anchor = input.anchorIndex
  if (typeof anchor === 'number' && Number.isInteger(anchor) && anchor >= 0 && anchor < itemCount) {
    const anchorRow = Math.floor(anchor / columns)
    startRow = Math.min(startRow, anchorRow)
    endRow = Math.max(endRow, anchorRow + 1)
  }

  return {
    startIndex: Math.min(itemCount, startRow * columns),
    endIndex: Math.min(itemCount, endRow * columns),
    topSpacerPx: startRow * pitch,
    bottomSpacerPx: (rowCount - endRow) * pitch,
    startRow,
    endRow
  }
}

export interface ScrollTopToRevealInput {
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  rowGap: number
  /** Linha (0-based) que precisa ficar visível. */
  row: number
  /** Total de linhas da grade (para limitar o scroll ao fim do conteúdo). */
  totalRows: number
}

/**
 * Novo `scrollTop` para deixar `row` inteiramente visível.
 *
 * - Já visível: devolve o scroll atual (não mexe — evita "pular" a cada foco).
 * - Acima: alinha o topo da linha ao topo do viewport.
 * - Abaixo: alinha a base da linha à base do viewport.
 * Sem medição (alturas 0) devolve o scroll atual: nada é ajustado.
 */
export function scrollTopToReveal(input: ScrollTopToRevealInput): number {
  const { scrollTop, viewportHeight, rowHeight, rowGap, row, totalRows } = input
  if (!(rowHeight > 0) || !(viewportHeight > 0) || !Number.isFinite(scrollTop)) return scrollTop

  const gap = Number.isFinite(rowGap) && rowGap > 0 ? rowGap : 0
  const pitch = rowHeight + gap
  const safeRow = Number.isFinite(row) ? Math.max(0, Math.floor(row)) : 0
  const rowTop = safeRow * pitch
  const rowBottom = rowTop + rowHeight

  const rows = Number.isFinite(totalRows) && totalRows > 0 ? Math.floor(totalRows) : 1
  const contentHeight = rows * rowHeight + (rows - 1) * gap
  const maxScroll = Math.max(0, contentHeight - viewportHeight)

  let next = scrollTop
  if (rowTop < scrollTop) {
    next = rowTop
  } else if (rowBottom > scrollTop + viewportHeight) {
    next = rowBottom - viewportHeight
  }

  return Math.min(Math.max(0, next), maxScroll)
}
