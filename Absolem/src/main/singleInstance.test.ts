import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  windowsCreated: 0,
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor() {
      state.windowsCreated += 1
    }
  }
}))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: state.logInfo, warn: vi.fn(), error: vi.fn() }
}))

type SingleInstanceModule = typeof import('./singleInstance')
type LifecycleModule = typeof import('./lifecycle')

let singleInstance: SingleInstanceModule
let lifecycle: LifecycleModule

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.windowsCreated = 0
  singleInstance = await import('./singleInstance')
  lifecycle = await import('./lifecycle')
})

describe('handleSecondInstance', () => {
  it('segunda instância chama showOverlay uma vez', () => {
    const showOverlay = vi.fn()
    const notify = vi.fn()

    singleInstance.handleSecondInstance({ showOverlay, notify })

    expect(showOverlay).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(state.logInfo).toHaveBeenCalledWith('singleInstance', 'segunda instância recebida')
  })

  it('não cria janela nova', () => {
    singleInstance.handleSecondInstance({ showOverlay: vi.fn() })

    expect(state.windowsCreated).toBe(0)
    expect(lifecycle.getMainWindow()).toBeNull()
  })
})
