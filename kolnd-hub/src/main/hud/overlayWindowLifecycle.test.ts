import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  instances: [] as Array<Record<string, unknown>>,
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
  dev: false,
  logWarn: vi.fn(),
  loadFailure: false
}))

interface FakeWindow {
  options: Record<string, unknown>
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  destroyed: boolean
  handlers: Map<string, (...args: unknown[]) => void>
  navigations: Array<(event: { preventDefault: () => void }, url: string) => void>
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    on: (event: string, handler: (event: unknown, url: string) => void) => void
  }
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>
  setSkipTaskbar: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  getBounds: () => { x: number; y: number; width: number; height: number }
  isVisible: () => boolean
  showInactive: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn> | (() => void)
  on: (event: string, handler: () => void) => void
  isDestroyed: () => boolean
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
}

function makeWindow(options: Record<string, unknown>): FakeWindow {
  const window: FakeWindow = {
    options,
    bounds: {
      x: Number(options.x),
      y: Number(options.y),
      width: Number(options.width),
      height: Number(options.height)
    },
    visible: false,
    destroyed: false,
    handlers: new Map(),
    navigations: [],
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: (_event, handler) => window.navigations.push(handler)
    },
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setBounds: vi.fn((next: FakeWindow['bounds']) => {
      window.bounds = next
    }),
    getBounds: () => window.bounds,
    isVisible: () => window.visible,
    showInactive: vi.fn(() => {
      window.visible = true
    }),
    hide: vi.fn(() => {
      window.visible = false
    }),
    destroy: vi.fn(() => {
      window.destroyed = true
    }),
    on: (event, handler) => window.handlers.set(event, handler),
    isDestroyed: () => window.destroyed,
    loadURL: vi.fn(() =>
      state.loadFailure ? Promise.reject(new Error('load falhou')) : Promise.resolve()
    ),
    loadFile: vi.fn(() =>
      state.loadFailure ? Promise.reject(new Error('load falhou')) : Promise.resolve()
    )
  }
  state.instances.push(window as unknown as Record<string, unknown>)
  return window
}

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: Record<string, unknown>) {
      return makeWindow(options) as unknown as object
    }
  },
  screen: {
    getPrimaryDisplay: () => ({ workArea: state.workArea })
  }
}))
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return state.dev
    }
  }
}))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: state.logWarn, error: vi.fn(), debug: vi.fn() }
}))

type Module = typeof import('./overlayWindow')

let mod: Module

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.instances = []
  state.dev = false
  state.loadFailure = false
  state.workArea = { x: 0, y: 0, width: 1920, height: 1080 }
  delete process.env['ELECTRON_RENDERER_URL']
  mod = await import('./overlayWindow')
})

function lastWindow(): FakeWindow {
  return state.instances.at(-1) as unknown as FakeWindow
}

describe('computeHudBounds / tamanhos', () => {
  it('aplica margem, normaliza largura e limita a altura à área de trabalho', () => {
    expect(mod.computeHudBounds({ x: 100, y: 50, width: 1920, height: 1080 }, 400, 300)).toEqual({
      x: 112,
      y: 62,
      width: 400,
      height: 300
    })
  })

  it('setHudWidth normaliza e atualiza a janela existente', () => {
    mod.createHudWindow()
    const window = lastWindow()
    expect(mod.setHudWidth(9999)).toBeGreaterThan(0)
    expect(mod.setHudWidth('abc')).toBeGreaterThan(0)
    expect(window.setBounds).toHaveBeenCalled()
    expect(mod.setHudWidth(480)).toBe(480)
    expect(mod.getHudWindowSize().width).toBe(480)
  })

  it('setHudHeight ignora diferença de 1 px e aplica mudanças reais', () => {
    const window = mod.createHudWindow()
    const initial = mod.getHudWindowSize().height
    expect(mod.setHudHeight(initial + 1)).toBe(initial)
    expect(mod.setHudHeight(initial + 100)).toBe(initial + 100)
    expect(window.setBounds).toHaveBeenCalled()
  })
})

describe('createHudWindow', () => {
  it('cria com as travas de sobreposição e carrega #hud', () => {
    const window = mod.createHudWindow() as unknown as FakeWindow
    expect(window.options).toMatchObject({
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      show: false,
      resizable: false
    })
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(window.loadFile).toHaveBeenCalledWith(expect.any(String), { hash: 'hud' })
    expect(window.webContents.setWindowOpenHandler).toHaveBeenCalled()
  })

  it('é idempotente enquanto a janela está viva', () => {
    const first = mod.createHudWindow()
    const second = mod.createHudWindow()
    expect(second).toBe(first)
    expect(state.instances).toHaveLength(1)
  })

  it('em dev carrega a URL do renderer com #hud', () => {
    state.dev = true
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const window = mod.createHudWindow()
    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:5173#hud')
  })

  it('bloqueia navegação externa e permite a mesma origem em dev', () => {
    state.dev = true
    process.env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    const window = mod.createHudWindow() as unknown as FakeWindow
    const handler = window.navigations[0]

    const allowed = { preventDefault: vi.fn() }
    handler(allowed, 'http://localhost:5173/outra')
    expect(allowed.preventDefault).not.toHaveBeenCalled()

    const blocked = { preventDefault: vi.fn() }
    handler(blocked, 'https://exemplo.com')
    expect(blocked.preventDefault).toHaveBeenCalled()
    expect(state.logWarn).toHaveBeenCalled()

    const invalid = { preventDefault: vi.fn() }
    handler(invalid, 'não-é-url')
    expect(invalid.preventDefault).toHaveBeenCalled()
  })

  it('falha ao carregar é apenas logada', async () => {
    state.loadFailure = true
    mod.createHudWindow()
    await Promise.resolve()
    await Promise.resolve()
    expect(state.logWarn).toHaveBeenCalledWith(
      'hud',
      expect.stringContaining('falha ao carregar a sobreposição')
    )
  })

  it('evento closed esquece a janela', () => {
    const window = mod.createHudWindow() as unknown as FakeWindow
    window.handlers.get('closed')?.()
    expect(mod.getHudWindow()).toBeNull()
    expect(mod.createHudWindow()).not.toBe(window)
  })
})

describe('show / hide / destroy', () => {
  it('show usa showInactive na primeira vez e reposiciona', () => {
    const window = mod.showHudWindow()
    expect(window.showInactive).toHaveBeenCalledTimes(1)
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(window.setBounds).toHaveBeenCalled()
  })

  it('show não chama showInactive se já está visível', () => {
    const window = mod.showHudWindow() as unknown as FakeWindow
    window.showInactive.mockClear()
    mod.showHudWindow()
    expect(window.showInactive).not.toHaveBeenCalled()
  })

  it('isHudWindowVisible reflete o estado real', () => {
    expect(mod.isHudWindowVisible()).toBe(false)
    mod.showHudWindow()
    expect(mod.isHudWindowVisible()).toBe(true)
    mod.hideHudWindow()
    expect(mod.isHudWindowVisible()).toBe(false)
  })

  it('hide sem janela não lança', () => {
    expect(() => mod.hideHudWindow()).not.toThrow()
  })

  it('destroy descarta a janela e tolera erro do destroy', () => {
    const window = mod.createHudWindow()
    window.destroy = () => {
      throw new Error('já fechando')
    }
    expect(() => mod.destroyHudWindow()).not.toThrow()
    expect(mod.getHudWindow()).toBeNull()

    const next = mod.createHudWindow()
    mod.destroyHudWindow()
    expect(next.destroy).toHaveBeenCalled()
  })
})
