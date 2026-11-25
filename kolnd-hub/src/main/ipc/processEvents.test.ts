import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notifications: [] as Array<{
    options: { title?: string; body?: string }
    handlers: Map<string, () => void>
    show: ReturnType<typeof vi.fn>
  }>,
  failNextNotification: false,
  getNotifyOnCrash: vi.fn(() => true),
  getConfigSnapshot: vi.fn(() => ({ apps: [{ id: 'app1', name: 'App Um' }] })),
  isAnyUninstallInProgress: vi.fn(() => false),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  Notification: class {
    options: { title?: string; body?: string }
    handlers = new Map<string, () => void>()
    show = vi.fn()

    constructor(options: { title?: string; body?: string }) {
      if (mocks.failNextNotification) {
        mocks.failNextNotification = false
        throw new Error('sem suporte a toast')
      }
      this.options = options
      mocks.notifications.push(this)
    }

    on(event: string, handler: () => void): void {
      this.handlers.set(event, handler)
    }
  }
}))
vi.mock('../store', () => ({
  getNotifyOnCrash: mocks.getNotifyOnCrash,
  getConfigSnapshot: mocks.getConfigSnapshot
}))
vi.mock('../uninstaller', () => ({
  isAnyUninstallInProgress: mocks.isAnyUninstallInProgress
}))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import { registerProcessEvents } from './processEvents'
import type { IpcContext } from './lifecycle'

const send = vi.fn()
const show = vi.fn()
const focus = vi.fn()
const window = { webContents: { send }, show, focus }

function setup(windowValue: unknown = window): { manager: EventEmitter; ctx: IpcContext } {
  const manager = new EventEmitter()
  const ctx = {
    getMainWindow: () => windowValue as never,
    processManager: manager
  } as unknown as IpcContext
  registerProcessEvents(ctx)
  return { manager, ctx }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.notifications.length = 0
  mocks.failNextNotification = false
  mocks.getNotifyOnCrash.mockReturnValue(true)
  mocks.getConfigSnapshot.mockReturnValue({ apps: [{ id: 'app1', name: 'App Um' }] })
  mocks.isAnyUninstallInProgress.mockReturnValue(false)
})

describe('registerProcessEvents — encaminhamento', () => {
  it('status-change e output são reenviados ao renderer', () => {
    const { manager } = setup()
    manager.emit('status-change', 'app1', 'running')
    manager.emit('output', 'app1', 'linha\n')

    expect(send).toHaveBeenCalledWith('app:status-changed', 'app1', 'running')
    expect(send).toHaveBeenCalledWith('app:output', 'app1', 'linha\n')
  })

  it('sem janela não lança', () => {
    const { manager } = setup(null)
    expect(() => {
      manager.emit('status-change', 'app1', 'running')
      manager.emit('output', 'app1', 'x')
    }).not.toThrow()
  })
})

describe('registerProcessEvents — notificação de queda', () => {
  it('status error exibe toast com nome amigável', () => {
    const { manager } = setup()
    manager.emit('status-change', 'app1', 'error')

    expect(mocks.notifications).toHaveLength(1)
    const notification = mocks.notifications[0]
    expect(notification.options).toEqual({
      title: 'Kolnd Hub',
      body: 'App Um parou inesperadamente — clique para reabrir.'
    })
    expect(notification.show).toHaveBeenCalledTimes(1)
  })

  it('appId desconhecido usa o próprio id no corpo', () => {
    const { manager } = setup()
    manager.emit('status-change', 'app-x', 'error')
    expect(mocks.notifications[0].options.body).toContain('app-x')
  })

  it('clique no toast mostra e foca a janela', () => {
    const { manager } = setup()
    manager.emit('status-change', 'app-click', 'error')
    mocks.notifications[0].handlers.get('click')?.()

    expect(show).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('clique sem janela não quebra', () => {
    const { manager } = setup(null)
    manager.emit('status-change', 'app-click2', 'error')
    expect(() => mocks.notifications[0].handlers.get('click')?.()).not.toThrow()
  })

  it('não notifica parada voluntária (status != error)', () => {
    const { manager } = setup()
    manager.emit('status-change', 'app-stop', 'stopped')
    expect(mocks.notifications).toHaveLength(0)
  })

  it('não notifica erro repetido para o mesmo app', () => {
    const { manager } = setup()
    manager.emit('status-change', 'app-dup', 'error')
    manager.emit('status-change', 'app-dup', 'error')
    expect(mocks.notifications).toHaveLength(1)
  })

  it('novo erro após um status intermediário notifica de novo', () => {
    const { manager } = setup()
    manager.emit('status-change', 'app-flap', 'error')
    manager.emit('status-change', 'app-flap', 'running')
    manager.emit('status-change', 'app-flap', 'error')
    expect(mocks.notifications).toHaveLength(2)
  })

  it('preferência notifyOnCrash desligada suprime o toast', () => {
    mocks.getNotifyOnCrash.mockReturnValue(false)
    const { manager } = setup()
    manager.emit('status-change', 'app-pref', 'error')
    expect(mocks.notifications).toHaveLength(0)
  })

  it('desinstalação em andamento suprime o toast', () => {
    mocks.isAnyUninstallInProgress.mockReturnValue(true)
    const { manager } = setup()
    manager.emit('status-change', 'app-uninstall', 'error')
    expect(mocks.notifications).toHaveLength(0)
  })

  it('falha ao construir o toast vira warning e não interrompe o forward', () => {
    mocks.failNextNotification = true
    const { manager } = setup()
    expect(() => manager.emit('status-change', 'app-throw', 'error')).not.toThrow()
    expect(mocks.logWarn).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('app:status-changed', 'app-throw', 'error')
  })
})
