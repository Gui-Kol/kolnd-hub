import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  isAnyUninstallInProgress: vi.fn(() => false),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../uninstaller', () => ({
  isAnyUninstallInProgress: mocks.isAnyUninstallInProgress
}))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import { registerWindowIpc } from './window'
import type { IpcContext } from './lifecycle'

type Listener = () => void

const methods = {
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  isMaximized: vi.fn(() => false),
  isFullScreen: vi.fn(() => false),
  setFullScreen: vi.fn(),
  getBounds: vi.fn(() => ({ x: 1, y: 2, width: 800, height: 600 })),
  setBounds: vi.fn(),
  hide: vi.fn(),
  once: vi.fn((_event: string, listener: Listener) => {
    listeners.push(listener)
  })
}

const listeners: Listener[] = []
let mainWindow: typeof methods | null = methods
const ctx = { getMainWindow: () => mainWindow as never } as unknown as IpcContext

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  listeners.length = 0
  mainWindow = methods
  mocks.isAnyUninstallInProgress.mockReturnValue(false)
  methods.isMaximized.mockReturnValue(false)
  registerWindowIpc(ctx)
})

describe('window:minimize / window:maximize', () => {
  it('minimiza a janela principal', () => {
    call('window:minimize')
    expect(methods.minimize).toHaveBeenCalledTimes(1)
  })

  it('sem janela não lança', () => {
    mainWindow = null
    expect(() => call('window:minimize')).not.toThrow()
    expect(() => call('window:maximize')).not.toThrow()
  })

  it('maximize alterna entre maximizar e restaurar', () => {
    call('window:maximize')
    expect(methods.maximize).toHaveBeenCalledTimes(1)

    methods.isMaximized.mockReturnValue(true)
    call('window:maximize')
    expect(methods.unmaximize).toHaveBeenCalledTimes(1)
  })
})

describe('window:set-fullscreen', () => {
  it('flag inválida é ignorada com warning', () => {
    call('window:set-fullscreen', 'sim')
    expect(methods.setFullScreen).not.toHaveBeenCalled()
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('sem janela não lança', () => {
    mainWindow = null
    expect(() => call('window:set-fullscreen', true)).not.toThrow()
  })

  it('entrar em tela cheia guarda os bounds quando não está maximizada', () => {
    call('window:set-fullscreen', true)
    expect(methods.getBounds).toHaveBeenCalledTimes(1)
    expect(methods.setFullScreen).toHaveBeenCalledWith(true)
  })

  it('entrar maximizado não guarda bounds (maximized já restaura sozinho)', () => {
    methods.isMaximized.mockReturnValue(true)
    call('window:set-fullscreen', true)
    expect(methods.getBounds).not.toHaveBeenCalled()
    expect(methods.setFullScreen).toHaveBeenCalledWith(true)
  })

  it('sair restaura os bounds salvos no evento leave-full-screen', () => {
    call('window:set-fullscreen', true)
    call('window:set-fullscreen', false)

    expect(methods.setFullScreen).toHaveBeenLastCalledWith(false)
    expect(methods.once).toHaveBeenCalledWith('leave-full-screen', expect.any(Function))
    listeners[0]()
    expect(methods.setBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 800, height: 600 })
  })

  it('sair sem bounds salvos não registra restauração', () => {
    call('window:set-fullscreen', false)
    expect(methods.once).not.toHaveBeenCalled()
  })

  it('sair depois de entrar maximizado não restaura bounds', () => {
    methods.isMaximized.mockReturnValue(true)
    call('window:set-fullscreen', true)
    call('window:set-fullscreen', false)
    expect(methods.once).not.toHaveBeenCalled()
  })
})

describe('window:close', () => {
  it('durante desinstalação é inerte', () => {
    mocks.isAnyUninstallInProgress.mockReturnValue(true)
    call('window:close')
    expect(methods.hide).not.toHaveBeenCalled()
  })

  it('sem janela não lança', () => {
    mainWindow = null
    expect(() => call('window:close')).not.toThrow()
  })

  it('oculta para a bandeja no fluxo normal', () => {
    call('window:close')
    expect(methods.hide).toHaveBeenCalledTimes(1)
  })
})
