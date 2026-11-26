import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  instances: [] as Array<Record<string, unknown>>,
  display: {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1
  },
  logInfo: vi.fn(),
  logWarn: vi.fn()
}))

interface FakeWindow {
  options: Record<string, unknown>
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
  destroyed: boolean
  handlers: Map<string, () => void>
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  setIgnoreMouseEvents: ReturnType<typeof vi.fn>
  setSkipTaskbar: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  getBounds: () => { x: number; y: number; width: number; height: number }
  isVisible: () => boolean
  show: ReturnType<typeof vi.fn>
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
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn()
    },
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setBounds: vi.fn((next: FakeWindow['bounds']) => {
      window.bounds = next
    }),
    getBounds: () => window.bounds,
    isVisible: () => window.visible,
    show: vi.fn(() => {
      window.visible = true
    }),
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
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve())
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
    getAllDisplays: () => [state.display],
    getPrimaryDisplay: () => state.display,
    getDisplayMatching: () => state.display,
    on: vi.fn(),
    removeListener: vi.fn()
  }
}))

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: state.logInfo, warn: state.logWarn, error: vi.fn() }
}))

type Module = typeof import('./overlayWindow')

let mod: Module

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.instances = []
  delete process.env['ELECTRON_RENDERER_URL']
  mod = await import('./overlayWindow')
  mod.resetOverlayWindowForTests()
})

describe('overlayWindow', () => {
  it('cria com frame false, transparent, alwaysOnTop, skipTaskbar e focusable false', () => {
    const window = mod.createOverlayWindow() as unknown as FakeWindow

    expect(window.options).toMatchObject({
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      show: false,
      resizable: false
    })
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
    expect(window.loadFile).toHaveBeenCalledWith(expect.any(String), { hash: 'overlay' })
    expect(window.webContents.setWindowOpenHandler).toHaveBeenCalled()
  })

  it('é idempotente', () => {
    const first = mod.createOverlayWindow()
    const second = mod.createOverlayWindow()

    expect(second).toBe(first)
    expect(state.instances).toHaveLength(1)
  })

  it('show usa showInactive e não show', () => {
    const window = mod.showOverlayWindow() as unknown as FakeWindow

    expect(window.showInactive).toHaveBeenCalledTimes(1)
    expect(window.show).not.toHaveBeenCalled()
    expect(mod.isOverlayVisible()).toBe(true)
  })

  it('hide sem janela não lança', () => {
    expect(() => mod.hideOverlayWindow()).not.toThrow()
  })

  it('closed esquece a janela', () => {
    const window = mod.createOverlayWindow() as unknown as FakeWindow
    window.handlers.get('closed')?.()

    expect(mod.getOverlayWindow()).toBeNull()
    expect(mod.createOverlayWindow()).not.toBe(window)
  })

  it('destroy tolera erro', () => {
    const window = mod.createOverlayWindow() as unknown as FakeWindow
    window.destroy = () => {
      throw new Error('já fechando')
    }

    expect(() => mod.destroyOverlayWindow()).not.toThrow()
    expect(mod.getOverlayWindow()).toBeNull()
  })
})
