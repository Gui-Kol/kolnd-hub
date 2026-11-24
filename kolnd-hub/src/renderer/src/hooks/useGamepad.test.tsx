// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { useGamepad } from './useGamepad'
import type { UseGamepadResult } from './useGamepad'
import { GAMEPAD_ACTIONS } from '../lib/gamepad'
import type { GamepadAction, GamepadConfig } from '../lib/gamepad'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const originalGetGamepads = Object.getOwnPropertyDescriptor(Navigator.prototype, 'getGamepads')

function config(overrides: Partial<GamepadConfig> = {}): GamepadConfig {
  const mapping = Object.fromEntries(GAMEPAD_ACTIONS.map((action) => [action, null])) as Record<
    GamepadAction,
    number | null
  >
  mapping.confirm = 0
  mapping.up = 12
  mapping.down = 13
  return {
    profile: { id: 'generic', name: 'Genérico', mapping } as never,
    controllerId: 'pad-1',
    controllerName: 'Controle Teste',
    mapping,
    autoMapped: false,
    configuredAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as GamepadConfig
}

interface FakePad {
  id: string
  axes: number[]
  buttons: Array<{ pressed: boolean; value: number }>
}

function pad(id = 'pad-1'): FakePad {
  return {
    id,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }))
  }
}

let pads: FakePad[]
let getGamepads: ReturnType<typeof vi.fn>
let frameCb: FrameRequestCallback | null
let now: number
let actions: GamepadAction[]
let latest: UseGamepadResult
let container: HTMLDivElement
let root: Root
let mounted: boolean

function Harness({
  cfg,
  onResult
}: {
  cfg: GamepadConfig | null
  onResult: (r: UseGamepadResult) => void
}): React.ReactNode {
  const result = useGamepad({ config: cfg, onAction: (action) => actions.push(action) })
  onResult(result)
  return (
    <output data-testid="state">
      {JSON.stringify({
        connected: latest.connected,
        name: latest.controllerName,
        padId: latest.padId
      })}
    </output>
  )
}

function render(cfg: GamepadConfig | null): void {
  act(() =>
    root.render(
      <Harness
        cfg={cfg}
        onResult={(result) => {
          latest = result
        }}
      />
    )
  )
}

function tick(): void {
  act(() => {
    const cb = frameCb
    frameCb = null
    cb?.(now)
  })
}

function state(): { connected: boolean; name: string | null; padId: string | null } {
  return JSON.parse(
    container.querySelector('[data-testid="state"]')?.textContent ?? '{"connected":false}'
  )
}

beforeEach(() => {
  pads = []
  actions = []
  frameCb = null
  now = 0
  getGamepads = vi.fn(() => pads)
  Object.defineProperty(Navigator.prototype, 'getGamepads', {
    configurable: true,
    value: getGamepads
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frameCb = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(performance, 'now').mockImplementation(() => now)

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalGetGamepads) {
    Object.defineProperty(Navigator.prototype, 'getGamepads', originalGetGamepads)
  }
})

describe('useGamepad — conexão', () => {
  it('sem config não consulta a API e fica desconectado', () => {
    render(null)
    tick()
    expect(getGamepads).not.toHaveBeenCalled()
    expect(state()).toEqual({ connected: false, name: null, padId: null })
  })

  it('usa o nome da config quando o id bate e fallback quando não bate', () => {
    pads = [pad('pad-1')]
    render(config())
    tick()
    expect(state()).toEqual({
      connected: true,
      name: 'Controle Teste',
      padId: 'pad-1'
    })

    pads = [pad('outro')]
    tick()
    expect(state()).toMatchObject({ connected: true, name: 'Controle conectado' })
  })

  it('sem pad conectado limpa o estado', () => {
    pads = [pad()]
    render(config())
    tick()
    expect(state().connected).toBe(true)

    pads = []
    tick()
    expect(state()).toEqual({ connected: false, name: null, padId: null })
  })

  it('erro da Gamepad API vira desconectado', () => {
    getGamepads.mockImplementation(() => {
      throw new Error('API indisponível')
    })
    render(config())
    tick()
    expect(state().connected).toBe(false)
  })
})

describe('useGamepad — ações por botão', () => {
  it('dispara na borda e não repete enquanto segura (ação não-direcional)', () => {
    const current = pad()
    pads = [current]
    render(config())

    current.buttons[0] = { pressed: true, value: 1 }
    tick()
    expect(actions).toEqual(['confirm'])

    now = 500
    tick()
    expect(actions).toEqual(['confirm'])
  })

  it('solta e pressiona de novo dispara outra vez', () => {
    const current = pad()
    pads = [current]
    render(config())

    current.buttons[0] = { pressed: true, value: 1 }
    tick()
    current.buttons[0] = { pressed: false, value: 0 }
    tick()
    current.buttons[0] = { pressed: true, value: 1 }
    tick()
    expect(actions).toEqual(['confirm', 'confirm'])
  })

  it('repetição de direção após 380 ms e a cada 110 ms', () => {
    const current = pad()
    pads = [current]
    render(config())

    current.buttons[12] = { pressed: true, value: 1 }
    tick() // 0 ms: borda
    now = 400
    tick() // held 400 → repete
    now = 500
    tick() // sinceLast 100 → ainda não
    now = 520
    tick() // sinceLast 120 → repete
    expect(actions).toEqual(['up', 'up', 'up'])
  })

  it('botão com value acima do limiar conta como pressionado', () => {
    const current = pad()
    pads = [current]
    render(config())
    current.buttons[0] = { pressed: false, value: 0.7 }
    tick()
    expect(actions).toEqual(['confirm'])
  })
})

describe('useGamepad — stick e troca de controle', () => {
  it('stick esquerdo navega nas quatro direções', () => {
    const current = pad()
    pads = [current]
    render(config())

    current.axes[1] = -1
    tick()
    current.axes[1] = 1
    tick()
    current.axes[0] = -1
    tick()
    current.axes[0] = 1
    tick()
    expect(actions).toEqual(['up', 'down', 'left', 'right'])
  })

  it('trocar de controle zera o estado pressionado', () => {
    const first = pad('pad-1')
    pads = [first]
    render(config())
    first.buttons[0] = { pressed: true, value: 1 }
    tick()
    expect(actions).toEqual(['confirm'])

    const second = pad('pad-2')
    second.buttons[0] = { pressed: true, value: 1 }
    pads = [second]
    tick()
    expect(actions).toEqual(['confirm', 'confirm'])
  })

  it('eventos de conexão adiantam o poll sem esperar o frame', () => {
    pads = [pad()]
    render(config())
    tick()
    expect(state().connected).toBe(true)

    pads = []
    act(() => {
      window.dispatchEvent(new Event('gamepaddisconnected'))
    })
    expect(state().connected).toBe(false)
  })
})

describe('useGamepad — ciclo de vida', () => {
  it('desmontar cancela o rAF e remove os listeners', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    render(config())
    const raf = globalThis.cancelAnimationFrame as unknown as ReturnType<typeof vi.fn>
    act(() => root.unmount())
    mounted = false
    expect(raf).toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('gamepadconnected', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('gamepaddisconnected', expect.any(Function))
  })

  it('ambiente sem Gamepad API não quebra', () => {
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: undefined
    })
    render(config())
    expect(state().connected).toBe(false)
  })
})
