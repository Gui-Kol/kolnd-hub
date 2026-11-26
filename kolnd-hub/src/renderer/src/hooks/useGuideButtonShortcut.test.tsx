// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import {
  GUIDE_POLL_MS,
  GUIDE_PRESENCE_POLL_MS,
  useGuideButtonShortcut
} from './useGuideButtonShortcut'

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
let visible: boolean
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

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function tick(times = 1): void {
  advance(GUIDE_POLL_MS * times)
}

/** Evento de gamepad: o hook ignora o payload (nem todo ambiente tem GamepadEvent). */
function dispatchGamepadEvent(type: 'gamepadconnected' | 'gamepaddisconnected'): void {
  act(() => {
    window.dispatchEvent(new Event(type))
  })
}

function setVisibility(state: 'visible' | 'hidden'): void {
  visible = state === 'visible'
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  pads = []
  focused = true
  visible = true
  getGamepads = vi.fn(() => pads)
  Object.defineProperty(Navigator.prototype, 'getGamepads', {
    configurable: true,
    value: getGamepads
  })
  // `document.hasFocus()`/`visibilityState` são determinísticos no jsdom via
  // propriedades próprias (removidas no afterEach) — o teste não depende do
  // foco/visibilidade reais da janela.
  Object.defineProperty(document, 'hasFocus', {
    configurable: true,
    value: () => focused
  })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden')
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
  delete (document as { visibilityState?: unknown }).visibilityState
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

  it('sem controle: nenhum tick do detector, só a checagem de presença a cada 2 s', () => {
    render(true)

    // Montagem: 1 leitura de presença. Nada de getGamepads a cada 150 ms.
    expect(getGamepads).toHaveBeenCalledTimes(1)
    advance(GUIDE_POLL_MS * 10) // 1,5 s
    expect(getGamepads).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    // A checagem de presença é o único wake periódico (1 a cada 2 s).
    advance(GUIDE_PRESENCE_POLL_MS)
    expect(getGamepads).toHaveBeenCalledTimes(2)
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('conecta (evento + pad no mock): poll de 150 ms e dispara na borda', () => {
    render(true)
    const current = pad()

    // Sem pad: 10 intervalos de 150 ms não consultam a API.
    tick(10)
    expect(getGamepads).toHaveBeenCalledTimes(1)

    pads = [current]
    dispatchGamepadEvent('gamepadconnected')
    // Presença reavaliada no evento e poll armado.
    expect(getGamepads).toHaveBeenCalledTimes(2)
    tick() // prime silencioso
    expect(getGamepads).toHaveBeenCalledTimes(3)

    setButton(current, 16, true)
    tick()
    expect(onTrigger).toHaveBeenCalledTimes(1)

    // Tick seguinte não repete (segurar não dispara em loop).
    tick(3)
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('a checagem de presença liga o poll quando o evento não dispara', () => {
    render(true)
    const current = pad()
    pads = [current]

    advance(GUIDE_PRESENCE_POLL_MS)
    expect(vi.getTimerCount()).toBe(1)

    tick() // prime
    setButton(current, 16, true)
    tick()
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('desconecta: para o poll de 150 ms e volta ao modo de presença', () => {
    const current = pad()
    pads = [current]
    render(true)
    tick() // prime

    pads = []
    dispatchGamepadEvent('gamepaddisconnected')
    const calls = getGamepads.mock.calls.length

    // Menos de 2 s: só a checagem de presença pode acordar.
    tick(10)
    expect(getGamepads).toHaveBeenCalledTimes(calls)
    expect(onTrigger).not.toHaveBeenCalled()

    advance(GUIDE_PRESENCE_POLL_MS)
    expect(getGamepads).toHaveBeenCalledTimes(calls + 1)
  })

  it('desconexão sem evento é detectada no tick e derruba o poll', () => {
    const current = pad()
    pads = [current]
    render(true)
    tick() // prime

    pads = []
    tick() // snapshot vazio → volta ao modo de presença
    const calls = getGamepads.mock.calls.length

    tick(10)
    expect(getGamepads).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('janela oculta: nenhum timer roda até voltar a ficar visível', () => {
    const current = pad()
    pads = [current]
    render(true)
    tick() // prime

    setVisibility('hidden')
    const calls = getGamepads.mock.calls.length
    tick(10) // 1,5 s oculto
    advance(GUIDE_PRESENCE_POLL_MS)
    expect(getGamepads).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)

    // Voltar a ficar visível reavalia a presença na hora e rearma o poll.
    setVisibility('visible')
    expect(getGamepads).toHaveBeenCalledTimes(calls + 1)
    expect(vi.getTimerCount()).toBe(1)

    // Prime silencioso após o rearme: o PS segurado durante o oculto não abre.
    setButton(current, 16, true)
    tick()
    expect(onTrigger).not.toHaveBeenCalled()
    setButton(current, 16, false)
    tick()
    setButton(current, 16, true)
    tick()
    expect(onTrigger).toHaveBeenCalledTimes(1)
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
    advance(GUIDE_PRESENCE_POLL_MS)
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('desmontar limpa os timers e remove os listeners', () => {
    pads = [pad()]
    render(true)
    tick()
    expect(vi.getTimerCount()).toBe(1)

    act(() => root.unmount())
    mounted = false
    expect(vi.getTimerCount()).toBe(0)

    const calls = getGamepads.mock.calls.length
    dispatchGamepadEvent('gamepadconnected')
    dispatchGamepadEvent('gamepaddisconnected')
    setVisibility('hidden')
    tick(5)
    expect(getGamepads).toHaveBeenCalledTimes(calls)
  })
})
