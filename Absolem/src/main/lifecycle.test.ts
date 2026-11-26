import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => void

interface FakeWindow {
  handlers: Map<string, Handler>
  on: (event: string, handler: Handler) => void
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  isMinimized: () => boolean
  isDestroyed: () => boolean
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  webContents: {
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
}

const state = vi.hoisted(() => ({
  windows: [] as FakeWindow[]
}))

function makeWindow(): FakeWindow {
  const window: FakeWindow = {
    handlers: new Map(),
    on: (event, handler) => {
      window.handlers.set(event, handler)
    },
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    destroy: vi.fn(),
    isMinimized: () => false,
    isDestroyed: () => false,
    loadFile: vi.fn(() => Promise.resolve()),
    loadURL: vi.fn(() => Promise.resolve()),
    webContents: {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }
  }
  state.windows.push(window)
  return window
}

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor() {
      return makeWindow() as unknown as object
    }
  }
}))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

type LifecycleModule = typeof import('./lifecycle')
type QuitStateModule = typeof import('./quitState')

let lifecycle: LifecycleModule
let quitState: QuitStateModule

function lastWindow(): FakeWindow {
  return state.windows.at(-1) as FakeWindow
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.windows = []
  quitState = await import('./quitState')
  lifecycle = await import('./lifecycle')
})

describe('ciclo de vida da janela', () => {
  it('close sem quit previne e oculta', () => {
    lifecycle.createMainWindow()
    const window = lastWindow()
    const event = { preventDefault: vi.fn() }

    window.handlers.get('close')?.(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(window.hide).toHaveBeenCalledTimes(1)
  })

  it('close com quit não previne', () => {
    lifecycle.createMainWindow()
    const window = lastWindow()
    quitState.markQuitting()
    const event = { preventDefault: vi.fn() }

    window.handlers.get('close')?.(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.hide).not.toHaveBeenCalled()
  })

  it('session-end marca quit', () => {
    lifecycle.createMainWindow()
    const window = lastWindow()

    expect(quitState.isQuitting()).toBe(false)
    window.handlers.get('session-end')?.()
    expect(quitState.isQuitting()).toBe(true)
  })
})
