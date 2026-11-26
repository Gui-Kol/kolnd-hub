import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  instances: [] as Array<Record<string, unknown>>,
  display: {
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1
  }
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
  destroy: ReturnType<typeof vi.fn>
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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

type WindowModule = typeof import('./overlayWindow')
type InteractiveModule = typeof import('./interactive')

let overlay: WindowModule
let interactive: InteractiveModule

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.instances = []
  delete process.env['ELECTRON_RENDERER_URL']
  overlay = await import('./overlayWindow')
  interactive = await import('./interactive')
  overlay.resetOverlayWindowForTests()
})

describe('interactive', () => {
  it('entrar no avatar habilita cliques', () => {
    const window = overlay.showOverlayWindow() as unknown as FakeWindow
    window.setIgnoreMouseEvents.mockClear()

    expect(interactive.setInteractive(true)).toBe(true)
    expect(interactive.isInteractive()).toBe(true)
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false)
  })

  it('sair desabilita', () => {
    const window = overlay.showOverlayWindow() as unknown as FakeWindow
    interactive.setInteractive(true)
    window.setIgnoreMouseEvents.mockClear()

    expect(interactive.setInteractive(false)).toBe(false)
    expect(interactive.isInteractive()).toBe(false)
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })

  it('hide reseta para não interativo', () => {
    const window = overlay.showOverlayWindow() as unknown as FakeWindow
    interactive.setInteractive(true)
    window.setIgnoreMouseEvents.mockClear()

    overlay.hideOverlayWindow()

    expect(interactive.isInteractive()).toBe(false)
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })
})
