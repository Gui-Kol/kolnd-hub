// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { GUIDE_POLL_MS, useGuideButtonShortcut } from './useGuideButtonShortcut'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalGetGamepads = Object.getOwnPropertyDescriptor(Navigator.prototype, 'getGamepads')

interface FakeButton {
  pressed: boolean
  value: number
}

function pad(id = 'pad-1'): Gamepad {
  return {
    id,
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  } as unknown as Gamepad
}

function setButton(current: Gamepad, index: number, pressed: boolean): void {
  ;(current.buttons[index] as FakeButton) = { pressed, value: pressed ? 1 : 0 }
}

let pads: (Gamepad | null)[]
let focused: boolean
let getGamepads: ReturnType<typeof vi.fn>
let onTrigger: ReturnType<typeof vi.fn>
let container: HTMLDivElement
let root: Root
let mounted: boolean

function Harness({ enabled }: { enabled: boolean }): JSX.Element {
  useGuideButtonShortcut({ enabled, onTrigger })
  return <output data-testid="hook" />
}

function render(enabled: boolean): void {
  act(() => root.render(<Harness enabled={enabled} />))
}

function tick(times = 1): void {
  act(() => {
    vi.advanceTimersByTime(GUIDE_POLL_MS * times)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  pads = []
  focused = true
  getGamepads = vi.fn(() => pads)
  Object.defineProperty(Navigator.prototype, 'getGamepads', {
    configurable: true,
    value: getGamepads
  })
  // `document.hasFocus()` é determinístico no jsdom via propriedade própria
  // (removida no afterEach) — o teste não depende do foco real da janela.
  Object.defineProperty(document, 'hasFocus', {
    configurable: true,
    value: () => focused
  })
  onTrigger = vi.fn()

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (document as { hasFocus?: unknown }).hasFocus
  if (originalGetGamepads) {
    Object.defineProperty(Navigator.prototype, 'getGamepads', originalGetGamepads)
  }
})

describe('useGuideButtonShortcut', () => {
  it('enabled=false nunca dispara nem consulta a API', () => {
    const current = pad()
    pads = [current]
    render(false)

    setButton(current, 16, true)
    tick(10)
    expect(onTrigger).not.toHaveBeenCalled()
    expect(getGamepads).not.toHaveBeenCalled()
  })

  it('sem foco nunca dispara e rearma em silêncio', () => {
    const current = pad()
    pads = [current]
    focused = false
    render(true)

    tick() // prime
    setButton(current, 16, true)
    tick(10)
    expect(onTrigger).not.toHaveBeenCalled()

    // Focar com o PS ainda pressionado não dispara (reset silencioso).
    focused = true
    tick(3)
    expect(onTrigger).not.toHaveBeenCalled()

    // Soltar e apertar de novo, com foco, dispara.
    setButton(current, 16, false)
    tick()
    setButton(current, 16, true)
    tick()
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('com foco dispara exatamente 1× por borda (segurar não repete)', () => {
    const current = pad()
    pads = [current]
    render(true)

    tick() // prime silencioso
    setButton(current, 16, true)
    tick(5)
    expect(onTrigger).toHaveBeenCalledTimes(1)

    setButton(current, 16, false)
    tick(2)
    setButton(current, 16, true)
    tick()
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })

  it('prime silencioso: botão já pressionado na montagem não dispara', () => {
    const current = pad()
    setButton(current, 16, true)
    pads = [current]
    render(true)

    tick(5)
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('reiniciar enabled rearma em silêncio (não reabre com o PS segurado)', () => {
    const current = pad()
    pads = [current]
    render(true)

    tick()
    setButton(current, 16, true)
    tick()
    expect(onTrigger).toHaveBeenCalledTimes(1)

    // Simula sair do Big Picture (enabled=false) e voltar (enabled=true)
    // ainda segurando o botão.
    render(false)
    render(true)
    tick(5)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('erro da Gamepad API não dispara', () => {
    getGamepads.mockImplementation(() => {
      throw new Error('API indisponível')
    })
    render(true)
    tick(3)
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('desmontar limpa o intervalo', () => {
    pads = [pad()]
    render(true)
    tick()
    expect(vi.getTimerCount()).toBe(1)

    act(() => root.unmount())
    mounted = false
    expect(vi.getTimerCount()).toBe(0)

    const calls = getGamepads.mock.calls.length
    tick(5)
    expect(getGamepads).toHaveBeenCalledTimes(calls)
  })
})
