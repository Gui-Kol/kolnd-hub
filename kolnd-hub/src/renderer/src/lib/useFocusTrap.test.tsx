// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useFocusTrap } from './useFocusTrap'
import type { UseFocusTrapOptions } from './useFocusTrap'

// React 18 só executa efeitos de renderização em `act` com esta flag.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({
  options,
  children
}: {
  options?: UseFocusTrapOptions
  children?: ReactNode
}): ReactNode {
  const ref = useFocusTrap<HTMLDivElement>(options)
  return (
    <div ref={ref} data-testid="panel">
      {children}
    </div>
  )
}

let container: HTMLDivElement
let root: Root
let mounted: boolean

function render(node: ReactNode): void {
  act(() => {
    root.render(node)
  })
}

function panel(): HTMLElement {
  return container.querySelector<HTMLElement>('[data-testid="panel"]') as HTMLElement
}

function pressTab(shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true
  })
  act(() => {
    document.activeElement?.dispatchEvent(event)
  })
  return event
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('useFocusTrap — foco inicial', () => {
  it('prioriza [data-autofocus] dentro do painel', () => {
    render(
      <Harness>
        <button type="button">Primeiro</button>
        <button type="button" data-autofocus>
          Cancelar
        </button>
      </Harness>
    )
    expect(document.activeElement?.textContent).toBe('Cancelar')
  })

  it('sem data-autofocus foca o primeiro elemento focável', () => {
    render(
      <Harness>
        <button type="button">Salvar</button>
        <button type="button">Cancelar</button>
      </Harness>
    )
    expect(document.activeElement?.textContent).toBe('Salvar')
  })

  it('painel sem focáveis vira focável (tabindex=-1) para o foco não se perder', () => {
    render(
      <Harness>
        <span>Só texto</span>
      </Harness>
    )
    expect(panel().getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(panel())
  })

  it('não rouba o foco se ele já está dentro do painel', () => {
    render(
      <Harness>
        <button type="button" data-autofocus>
          A
        </button>
        <button type="button">B</button>
      </Harness>
    )
    const b = container.querySelectorAll('button')[1]
    act(() => b.focus())
    // Re-render com `watch` novo reexecuta o efeito de foco inicial.
    render(
      <Harness options={{ watch: 'confirm' }}>
        <button type="button" data-autofocus>
          A
        </button>
        <button type="button">B</button>
      </Harness>
    )
    expect(document.activeElement).toBe(b)
  })

  it('active=false não move o foco para dentro do painel', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()

    render(
      <Harness options={{ active: false }}>
        <button type="button">Salvar</button>
      </Harness>
    )
    expect(document.activeElement).toBe(outside)
  })
})

describe('useFocusTrap — ciclo de Tab', () => {
  it('Tab no último elemento volta ao primeiro (preventDefault)', () => {
    render(
      <Harness>
        <input aria-label="A" />
        <input aria-label="B" />
      </Harness>
    )
    const [a, b] = Array.from(container.querySelectorAll('input'))
    act(() => b.focus())

    const event = pressTab(false)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(a)
  })

  it('Shift+Tab no primeiro elemento vai ao último (preventDefault)', () => {
    render(
      <Harness>
        <input aria-label="A" />
        <input aria-label="B" />
      </Harness>
    )
    const [a, b] = Array.from(container.querySelectorAll('input'))
    act(() => a.focus())

    const event = pressTab(true)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(b)
  })

  it('Tab no meio do painel não interfere', () => {
    render(
      <Harness>
        <input aria-label="A" />
        <input aria-label="B" />
        <input aria-label="C" />
      </Harness>
    )
    const b = container.querySelectorAll('input')[1]
    act(() => b.focus())

    const event = pressTab(false)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(b)
  })

  it('painel sem focáveis consome o Tab', () => {
    render(
      <Harness>
        <span>Só texto</span>
      </Harness>
    )
    const event = pressTab(false)
    expect(event.defaultPrevented).toBe(true)
  })

  it('active=false não prende o Tab', () => {
    render(
      <Harness options={{ active: false }}>
        <input aria-label="A" />
        <input aria-label="B" />
      </Harness>
    )
    const b = container.querySelectorAll('input')[1]
    act(() => b.focus())

    const event = pressTab(false)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('useFocusTrap — Esc e restauração do foco', () => {
  it('chama onEscape ao pressionar Esc', () => {
    const onEscape = vi.fn()
    render(
      <Harness options={{ onEscape }}>
        <button type="button">Fechar</button>
      </Harness>
    )
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('não chama onEscape com active=false ou com outra tecla', () => {
    const onEscape = vi.fn()
    render(
      <Harness options={{ onEscape }}>
        <button type="button">Fechar</button>
      </Harness>
    )
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(onEscape).not.toHaveBeenCalled()

    render(
      <Harness options={{ onEscape, active: false }}>
        <button type="button">Fechar</button>
      </Harness>
    )
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('devolve o foco a quem abriu o modal ao desmontar', () => {
    const outside = document.createElement('button')
    outside.textContent = 'Abrir'
    document.body.appendChild(outside)
    outside.focus()

    render(
      <Harness>
        <button type="button">Fechar</button>
      </Harness>
    )
    expect(document.activeElement?.textContent).toBe('Fechar')

    act(() => root.render(<Harness options={{ active: false }} />))
    // Painel removido do DOM → cleanup restaura o foco no botão de origem.
    act(() => root.unmount())
    mounted = false
    expect(document.activeElement).toBe(outside)
  })
})
