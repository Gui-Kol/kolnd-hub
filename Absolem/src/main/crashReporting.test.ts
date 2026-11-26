import { beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  start: vi.fn(),
  exit: vi.fn(),
  on: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    on: state.on,
    exit: state.exit,
    getPath: () => 'C:/tmp/absolem'
  },
  crashReporter: { start: state.start }
}))

vi.mock('./logger', () => ({
  logger: { info: state.logInfo, error: state.logError, warn: vi.fn(), debug: vi.fn() }
}))

type CrashModule = typeof import('./crashReporting')

let crashMod: CrashModule

beforeAll(async () => {
  crashMod = await import('./crashReporting')
})

describe('crash reporting local', () => {
  it('start usa uploadToServer false', () => {
    expect(state.start).toHaveBeenCalledTimes(1)
    expect(state.start).toHaveBeenCalledWith(
      expect.objectContaining({ uploadToServer: false, submitURL: '' })
    )
    expect(state.on).toHaveBeenCalledWith('render-process-gone', expect.any(Function))
    expect(state.on).toHaveBeenCalledWith('child-process-gone', expect.any(Function))
  })

  it('uncaught loga e chama app.exit(1)', () => {
    const error = new Error('falha fatal')

    crashMod.handleUncaughtException(error)

    expect(state.logError).toHaveBeenCalledWith('crash', expect.stringContaining('[CRASH]'), error)
    expect(state.exit).toHaveBeenCalledWith(1)
  })
})
