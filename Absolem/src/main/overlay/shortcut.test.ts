import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShortcutApi } from './shortcut'

const state = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
  appHandlers: new Map<string, () => void>(),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    once: (event: string, handler: () => void) => {
      state.appHandlers.set(event, handler)
    }
  },
  globalShortcut: {
    register: state.register,
    unregister: state.unregister,
    unregisterAll: state.unregisterAll
  }
}))

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: state.logInfo, warn: state.logWarn, error: vi.fn() }
}))

type Module = typeof import('./shortcut')

let mod: Module

function fakeApi(registerImpl: (accelerator: string) => boolean): ShortcutApi {
  return {
    register: (accelerator, callback) => {
      state.register(accelerator, callback)
      return registerImpl(accelerator)
    },
    unregister: state.unregister,
    unregisterAll: state.unregisterAll
  }
}

beforeEach(async () => {
  vi.resetModules()
  state.register.mockReset()
  state.unregister.mockReset()
  state.unregisterAll.mockReset()
  state.appHandlers.clear()
  state.logWarn.mockClear()
  state.logInfo.mockClear()
  mod = await import('./shortcut')
  mod.resetShortcutForTests()
})

describe('atalho global do overlay', () => {
  it('atalho inválido não é registrado', () => {
    mod.setShortcutApiForTests(fakeApi(() => true))

    const status = mod.registerOverlayShortcut('sem-modificador', vi.fn())

    expect(state.register).not.toHaveBeenCalled()
    expect(status).toEqual({ registered: false, accelerator: 'Control+Alt+A' })
    expect(state.logWarn).toHaveBeenCalled()
  })

  it('conflito preserva o atalho anterior', () => {
    mod.setShortcutApiForTests(fakeApi((accelerator) => accelerator !== 'Control+Shift+B'))

    expect(mod.registerOverlayShortcut('Control+Alt+A', vi.fn())).toEqual({
      registered: true,
      accelerator: 'Control+Alt+A'
    })

    const status = mod.registerOverlayShortcut('Control+Shift+B', vi.fn())

    expect(status).toEqual({ registered: true, accelerator: 'Control+Alt+A' })
    expect(state.register).toHaveBeenCalledWith('Control+Shift+B', expect.any(Function))
    expect(state.register).toHaveBeenLastCalledWith('Control+Alt+A', expect.any(Function))
    expect(state.logWarn).toHaveBeenCalledWith('shortcut', expect.stringContaining('conflito'))
  })

  it('will-quit desregistra', () => {
    mod.setShortcutApiForTests(fakeApi(() => true))
    mod.registerOverlayShortcut('Control+Alt+A', vi.fn())

    const handler = state.appHandlers.get('will-quit')
    expect(handler).toBeDefined()
    handler?.()

    expect(state.unregister).toHaveBeenCalledWith('Control+Alt+A')
    expect(mod.getShortcutStatus().registered).toBe(false)
  })
})
