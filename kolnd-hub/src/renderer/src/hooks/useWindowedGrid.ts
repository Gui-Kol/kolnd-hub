// useWindowedGrid — janela de renderização da grade do Big Picture.
//
// Mede o layout real (altura de um card renderizado, `row-gap` computado,
// colunas do grid e altura do viewport), escuta scroll/resize e devolve a
// janela de linhas a montar. A matemática vive em lib/windowedGrid (puro e
// testado); aqui só há DOM.
//
// Detalhes que importam:
// - A âncora é o índice do item focado; a linha dele é sempre incluída, então
//   o card focado nunca é desmontado no meio da navegação espacial.
// - O reveal ajusta o `scrollTop` do PRÓPRIO container (nunca `scrollIntoView`,
//   que rolaria o <main> do shell e arrastaria rail/relógio).
// - Scroll é coalescido por rAF: N eventos de wheel/teclado → 1 re-render.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { computeWindowedRange, gridRowCount, scrollTopToReveal } from '../lib/windowedGrid'
import type { WindowedRange } from '../lib/windowedGrid'

/** Linhas extras acima/abaixo da área visível (navegação por 1 linha é instantânea). */
export const WINDOWED_GRID_OVERSCAN_ROWS = 2

export interface UseWindowedGridOptions {
  itemCount: number
  /** Índice do item focado (âncora) — `null` quando o foco não está na grade. */
  anchorIndex: number | null
  overscanRows?: number
}

export interface UseWindowedGridResult {
  /** Ref do container com `overflow-y: auto` (o scroller da seção). */
  scrollRef: RefObject<HTMLDivElement>
  /** Ref da grade (`role="listbox"`). */
  gridRef: RefObject<HTMLDivElement>
  /** Handler de `onScroll` do container. */
  onScroll: () => void
  range: WindowedRange
}

interface GridMetrics {
  viewportHeight: number
  rowHeight: number
  rowGap: number
  columns: number
}

const UNMEASURED: GridMetrics = { viewportHeight: 0, rowHeight: 0, rowGap: 0, columns: 1 }

export function useWindowedGrid({
  itemCount,
  anchorIndex,
  overscanRows = WINDOWED_GRID_OVERSCAN_ROWS
}: UseWindowedGridOptions): UseWindowedGridResult {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<GridMetrics>(UNMEASURED)
  const [scrollTop, setScrollTop] = useState(0)
  const frameRef = useRef<number | null>(null)

  // Lê o layout real da grade. `offsetHeight` (e não getBoundingClientRect)
  // porque o card focado/hover tem `scale` — o transform não deve inflar a
  // altura da linha usada no cálculo.
  const measure = useCallback((): void => {
    const scroller = scrollRef.current
    const grid = gridRef.current
    if (!scroller || !grid) return

    const styles = window.getComputedStyle(grid)
    // Colunas vêm do grid computado (`grid-cols-2 xl:grid-cols-3 …`) — o hook
    // não duplica os breakpoints do Tailwind.
    const columns = Math.max(1, styles.gridTemplateColumns.split(' ').filter(Boolean).length)
    const parsedGap = Number.parseFloat(styles.rowGap)
    const rowGap = Number.isFinite(parsedGap) ? parsedGap : 0
    const firstItem = grid.querySelector<HTMLElement>('[data-windowed-item]')
    const rowHeight = firstItem?.offsetHeight ?? 0
    const viewportHeight = scroller.clientHeight

    setMetrics((prev) =>
      prev.viewportHeight === viewportHeight &&
      prev.rowHeight === rowHeight &&
      prev.rowGap === rowGap &&
      prev.columns === columns
        ? prev
        : { viewportHeight, rowHeight, rowGap, columns }
    )
    setScrollTop((prev) => (prev === scroller.scrollTop ? prev : scroller.scrollTop))
  }, [])

  // Medição pós-commit (layout effect: antes do paint, com os cards no DOM).
  // `itemCount` entra nas deps para medir quando a lista sai do "carregando".
  useLayoutEffect(() => {
    measure()
  }, [measure, itemCount])

  // Re-mede em mudanças de tamanho: fullscreen, janela e troca de breakpoint
  // (colunas). O observer não causa loop: metrics iguais não re-renderizam.
  useEffect(() => {
    const scroller = scrollRef.current
    const grid = gridRef.current
    if (!scroller || !grid) return undefined
    const observer = new ResizeObserver(() => measure())
    observer.observe(scroller)
    observer.observe(grid)
    return (): void => observer.disconnect()
  }, [measure, itemCount])

  // Scroll coalescido por frame: só o último valor do frame vira estado.
  const onScroll = useCallback((): void => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const scroller = scrollRef.current
      if (!scroller) return
      setScrollTop((prev) => (prev === scroller.scrollTop ? prev : scroller.scrollTop))
    })
  }, [])

  useEffect(
    () => (): void => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    },
    []
  )

  const totalRows = gridRowCount(itemCount, metrics.columns)

  // Mantém o card focado visível mexendo apenas no scroll do container.
  useLayoutEffect(() => {
    if (anchorIndex === null) return
    const scroller = scrollRef.current
    if (!scroller || metrics.rowHeight <= 0 || metrics.viewportHeight <= 0) return
    const next = scrollTopToReveal({
      scrollTop: scroller.scrollTop,
      viewportHeight: metrics.viewportHeight,
      rowHeight: metrics.rowHeight,
      rowGap: metrics.rowGap,
      row: Math.floor(anchorIndex / metrics.columns),
      totalRows
    })
    if (next === scroller.scrollTop) return
    scroller.scrollTop = next
  }, [anchorIndex, metrics, totalRows])

  const range = useMemo(
    () =>
      computeWindowedRange({
        scrollTop,
        viewportHeight: metrics.viewportHeight,
        rowHeight: metrics.rowHeight,
        rowGap: metrics.rowGap,
        columns: metrics.columns,
        itemCount,
        overscanRows,
        anchorIndex
      }),
    [scrollTop, metrics, itemCount, overscanRows, anchorIndex]
  )

  return { scrollRef, gridRef, onScroll, range }
}
