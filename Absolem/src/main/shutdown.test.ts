import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  quit: vi.fn(),
  quittingAtQuit: [] as boolean[],
  warn: vi.fn(),
  info: vi.fn()
}))

vi.mock('electron', () => ({
  app: { quit: state.quit }
}))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: state.info, warn: state.warn, error: vi.fn() }
}))

type ShutdownModule = typeof import('./shutdown')
type QuitStateModule = typeof import('./quitState')

let shutdown: ShutdownModule
let quitState: QuitStateModule

function makeContext() {
  return {
    getMainWindow: () => null,
    getOverlayWindow: () => null
  }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  state.quittingAtQuit = []
  quitState = await import('./quitState')
  shutdown = await import('./shutdown')
  state.quit.mockImplementation(() => {
    state.quittingAtQuit.push(quitState.isQuitting())
  })
})

describe('shutdownApp', () => {
  it('marca quit antes de app.quit', () => {
    expect(quitState.isQuitting()).toBe(false)

    shutdown.shutdownApp(makeContext())

    expect(state.quit).toHaveBeenCalledTimes(1)
    expect(state.quittingAtQuit).toEqual([true])
  })

  it('erro de um gancho não impede os demais', () => {
    const second = vi.fn()
    shutdown.registerShutdownHook('primeiro', () => {
      throw new Error('falhou de propósito')
    })
    shutdown.registerShutdownHook('segundo', second)

    shutdown.shutdownApp(makeContext())

    expect(state.warn).toHaveBeenCalledWith(
      'lifecycle',
      expect.stringContaining('gancho de encerramento falhou'),
      expect.any(Error)
    )
    expect(second).toHaveBeenCalledTimes(1)
    expect(state.quit).toHaveBeenCalledTimes(1)
  })

  it('não chama process.kill', () => {
    const kill = vi.spyOn(process, 'kill')

    shutdown.shutdownApp(makeContext())

    expect(kill).not.toHaveBeenCalled()
    kill.mockRestore()
  })
})
