// @vitest-environment jsdom
/* eslint-disable react-hooks/refs -- o teste acessa os refs do próprio hook sob teste */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useWindowedGrid } from './useWindowedGrid'
import type { UseWindowedGridResult } from './useWindowedGrid'
import { computeWindowedRange, scrollTopToReveal } from '../lib/windowedGrid'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')

let frameCallbacks: FrameRequestCallback[]
let resizeInstances: Array<{ cb: ResizeObserverCallback; targets: Element[] }>
const originalResizeObserver = globalThis.ResizeObserver

function Harness({
  itemCount,
  anchorIndex,
  onResult
}: {
  itemCount: number
  anchorIndex: number | null
  onResult: (result: UseWindowedGridResult) => void
}): React.ReactNode {
  const result = useWindowedGrid({ itemCount, anchorIndex })
  onResult(result)
  return (
    <div ref={result.scrollRef} data-testid="scroll" onScroll={result.onScroll}>
      <div ref={result.gridRef} data-testid="grid">
        {Array.from({ length: itemCount }, (_, index) => (
          <div key={index} data-windowed-item />
        ))}
      </div>
    </div>
  )
}

let container: HTMLDivElement
let root: Root
let latest: UseWindowedGridResult
let mounted: boolean

function render(itemCount = 20, anchorIndex: number | null = null): void {
  act(() => {
    root.render(
      <Harness
        itemCount={itemCount}
        anchorIndex={anchorIndex}
        onResult={(result) => {
          latest = result
        }}
      />
    )
  })
}

function scrollElement(): HTMLDivElement {
  return container.querySelector('[data-testid="scroll"]') as HTMLDivElement
}

function expected(
  scrollTop: number,
  columns = 3,
  itemCount = 20,
  anchorIndex: number | null = null
) {
  return computeWindowedRange({
    scrollTop,
    viewportHeight: 240,
    rowHeight: 100,
    rowGap: 20,
    columns,
    itemCount,
    overscanRows: 2,
    anchorIndex
  })
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 100
  })
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get: () => 240
  })
})

afterAll(() => {
  if (originalOffsetHeight) {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight)
  }
  if (originalClientHeight) {
    Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight)
  }
  globalThis.ResizeObserver = originalResizeObserver
})

beforeEach(() => {
  frameCallbacks = []
  resizeInstances = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCallbacks.push(cb)
    return frameCallbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  class FakeResizeObserver {
    cb: ResizeObserverCallback
    targets: Element[] = []
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
      resizeInstances.push(this)
    }
    observe(target: Element): void {
      this.targets.push(target)
    }
    disconnect(): void {}
  }
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    gridTemplateColumns: '100px 100px 100px',
    rowGap: '20px'
  } as CSSStyleDeclaration)

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useWindowedGrid — medição', () => {
  it('mede o layout e devolve a janela inicial', () => {
    render(20)
    expect(latest.range).toEqual(expected(0))
    // Observa o scroller e a grade.
    expect(resizeInstances[0].targets).toHaveLength(2)
  })

  it('lista vazia devolve janela vazia', () => {
    render(0)
    expect(latest.range).toMatchObject({ startIndex: 0, endIndex: 0 })
  })

  it('row-gap inválido não quebra a medição', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      gridTemplateColumns: '100px',
      rowGap: 'normal'
    } as CSSStyleDeclaration)
    render(20)
    expect(latest.range.startRow).toBe(0)
  })

  it('re-mede quando o ResizeObserver dispara (troca de colunas)', () => {
    render(20)
    expect(latest.range).toEqual(expected(0, 3))

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      gridTemplateColumns: '100px',
      rowGap: '20px'
    } as CSSStyleDeclaration)
    act(() => resizeInstances[0].cb([], resizeInstances[0] as never))
    expect(latest.range).toEqual(expected(0, 1))
  })
})

describe('useWindowedGrid — scroll', () => {
  it('coalesce eventos de scroll em um único frame', () => {
    render(20)
    const scroll = scrollElement()
    scroll.scrollTop = 240

    act(() => {
      latest.onScroll()
      latest.onScroll()
      latest.onScroll()
    })
    expect(frameCallbacks).toHaveLength(1)

    act(() => frameCallbacks.shift()?.(0))
    expect(latest.range).toEqual(expected(240))
  })

  it('ignora scroll adicional enquanto um frame está pendente', () => {
    render(20)
    act(() => {
      latest.onScroll()
      latest.onScroll()
    })
    expect(frameCallbacks).toHaveLength(1)
    act(() => frameCallbacks.shift()?.(0))
    expect(frameCallbacks).toHaveLength(0)
  })

  it('cancelar o frame pendente no unmount', () => {
    render(20)
    act(() => latest.onScroll())
    const cancel = globalThis.cancelAnimationFrame as unknown as ReturnType<typeof vi.fn>
    act(() => root.unmount())
    mounted = false
    expect(cancel).toHaveBeenCalled()
  })
})

describe('useWindowedGrid — âncora', () => {
  it('revela a linha do item focado ajustando o scrollTop do container', () => {
    render(20, 12)
    const scroll = scrollElement()
    const expectedTop = scrollTopToReveal({
      scrollTop: 0,
      viewportHeight: 240,
      rowHeight: 100,
      rowGap: 20,
      row: 4,
      totalRows: 7
    })
    expect(scroll.scrollTop).toBe(expectedTop)
  })

  it('âncora na primeira linha não rola', () => {
    render(20, 0)
    const scroll = scrollElement()
    expect(scroll.scrollTop).toBe(0)
  })
})
