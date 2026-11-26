import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbsolemConfig } from '../../shared/config'
import { IPC } from '../../shared/ipc'
import type { IpcContext } from './lifecycle'

type Handler = (event: unknown, payload: unknown) => unknown

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  quit: vi.fn(),
  quittingAtQuit: [] as boolean[]
}))

vi.mock('electron', () => ({
  app: {
    getName: () => 'Absolem',
    getVersion: () => '0.1.0',
    quit: state.quit
  },
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      state.handlers.set(channel, handler)
    }
  }
}))

type AppModule = typeof import('./app')
type QuitStateModule = typeof import('../quitState')

let appMod: AppModule
let quitState: QuitStateModule

const defaultConfig: AbsolemConfig = {
  overlay: {
    visible: false,
    position: 'bottom-left',
    offsetX: 0,
    offsetY: 0,
    width: 320,
    height: 360,
    shortcut: 'Control+Alt+A',
    hideOnFullscreen: true
  },
  theme: { mode: 'dark', accent: '#3b82f6' },
  voice: { enabled: false, inputDeviceId: null, outputVolume: 1 },
  gemini: { model: 'gemini-2.0-flash', temperature: 0.7 },
  privacy: { telemetry: false, screenCapture: false },
  permissions: {
    microphone: false,
    screenVision: false,
    computerControl: false,
    fileAccess: false
  },
  ui: { language: 'pt-BR', reducedMotion: false, startMinimized: false }
}

function makeContext(): IpcContext {
  return {
    getMainWindow: () => null,
    getOverlayWindow: () => null,
    getStoreSnapshot: () => defaultConfig,
    isQuitting: quitState.isQuitting
  }
}

function handlerFor(channel: string): Handler {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler ausente para ${channel}`)
  return handler
}

beforeEach(async () => {
  vi.resetModules()
  state.handlers.clear()
  state.quit.mockReset()
  state.quittingAtQuit = []
  quitState = await import('../quitState')
  appMod = await import('./app')
  appMod.registerAppIpc(makeContext())
  state.quit.mockImplementation(() => {
    state.quittingAtQuit.push(quitState.isQuitting())
  })
})

describe('IPC base do app', () => {
  it('app:get-info devolve nome, versão e plataforma', () => {
    const result = handlerFor(IPC.appGetInfo)(undefined, undefined)
    expect(result).toEqual({
      ok: true,
      info: { name: 'Absolem', version: '0.1.0', platform: process.platform }
    })
  })

  it('payload inválido não lança e devolve ok false', () => {
    const getInfo = handlerFor(IPC.appGetInfo)
    const invalidGetInfo = { unexpected: true }

    expect(() => getInfo(undefined, invalidGetInfo)).not.toThrow()
    expect(getInfo(undefined, invalidGetInfo)).toMatchObject({ ok: false })

    const quit = handlerFor(IPC.appQuit)
    expect(() => quit(undefined, { unexpected: true })).not.toThrow()
    expect(quit(undefined, { unexpected: true })).toMatchObject({ ok: false })
    expect(state.quit).not.toHaveBeenCalled()
  })

  it('app:quit chama markQuitting antes de app.quit', () => {
    expect(quitState.isQuitting()).toBe(false)

    const result = handlerFor(IPC.appQuit)(undefined, undefined)

    expect(result).toEqual({ ok: true })
    expect(state.quit).toHaveBeenCalledTimes(1)
    expect(state.quittingAtQuit).toEqual([true])
    expect(quitState.isQuitting()).toBe(true)
  })
})
