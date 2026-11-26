import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbsolemConfig } from '../../shared/config'
import type { PermissionsState } from '../../shared/permissions'
import { IPC } from '../../shared/ipc'
import type { IpcContext } from './lifecycle'

type Handler = (event: unknown, payload: unknown) => unknown

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  config: undefined as unknown,
  writes: [] as unknown[]
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      state.handlers.set(channel, handler)
    }
  }
}))

vi.mock('../store', () => ({
  setStoreValue: (_key: string, value: unknown) => {
    state.writes.push(value)
    const config = state.config as AbsolemConfig
    config.permissions = value as PermissionsState
    return { success: true }
  }
}))

const DEFAULT_PERMISSIONS: PermissionsState = {
  microphone: false,
  paused: false,
  categories: {
    'apps.launch': 'ask',
    'apps.close': 'ask',
    'files.read': 'ask',
    'files.write': 'ask',
    'system.power': 'deny',
    'uia.control': 'deny',
    'web.search': 'allow'
  }
}

function makeContext(): IpcContext {
  state.config = {
    permissions: structuredClone(DEFAULT_PERMISSIONS),
    routines: []
  } as unknown as AbsolemConfig
  return {
    getMainWindow: () => null,
    getOverlayWindow: () => null,
    getStoreSnapshot: () => state.config as AbsolemConfig,
    isQuitting: () => false
  }
}

function handlerFor(channel: string): Handler {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler ausente para ${channel}`)
  return handler
}

let registerActionsIpc: typeof import('./actions').registerActionsIpc

beforeEach(async () => {
  vi.resetModules()
  state.handlers.clear()
  state.writes = []
  const mod = await import('./actions')
  registerActionsIpc = mod.registerActionsIpc
})

describe('canais de permissões e pausa', () => {
  it('permissions:get devolve os defaults (ask/allow/deny)', () => {
    registerActionsIpc(makeContext())

    const result = handlerFor(IPC.permissionsGet)(null, undefined)

    expect(result).toMatchObject({
      ok: true,
      permissions: {
        microphone: false,
        paused: false,
        categories: {
          'apps.launch': 'ask',
          'files.read': 'ask',
          'system.power': 'deny',
          'uia.control': 'deny',
          'web.search': 'allow'
        }
      }
    })
  })

  it('permissions:set persiste a categoria sem perder microphone/pausa', () => {
    const ctx = makeContext()
    const config = state.config as AbsolemConfig
    config.permissions.microphone = true
    registerActionsIpc(ctx)

    const result = handlerFor(IPC.permissionsSet)(null, {
      category: 'files.read',
      decision: 'deny'
    })

    expect(result).toEqual({ ok: true })
    expect(state.writes).toHaveLength(1)
    const current = handlerFor(IPC.permissionsGet)(null, undefined) as {
      permissions: PermissionsState
    }
    expect(current.permissions.categories['files.read']).toBe('deny')
    expect(current.permissions.microphone).toBe(true)
    expect(current.permissions.paused).toBe(false)
  })

  it('categoria ou decisão inválida é recusada sem escrever', () => {
    registerActionsIpc(makeContext())

    expect(
      handlerFor(IPC.permissionsSet)(null, { category: 'shell.livre', decision: 'allow' })
    ).toMatchObject({ ok: false })
    expect(
      handlerFor(IPC.permissionsSet)(null, { category: 'files.read', decision: 'talvez' })
    ).toMatchObject({ ok: false })
    expect(handlerFor(IPC.permissionsSet)(null, { category: 'files.read' })).toMatchObject({
      ok: false
    })
    expect(state.writes).toHaveLength(0)
  })

  it('actions:pause persiste e actions:status reflete pausa, permissões e limites', () => {
    registerActionsIpc(makeContext())

    const paused = handlerFor(IPC.actionsPause)(null, { paused: true })
    expect(paused).toEqual({ ok: true, paused: true })
    expect(state.writes).toHaveLength(1)

    const status = handlerFor(IPC.actionsStatus)(null, undefined) as {
      ok: boolean
      status: { paused: boolean; permissions: PermissionsState; routines: unknown[] }
    }
    expect(status.ok).toBe(true)
    expect(status.status.paused).toBe(true)
    expect(status.status.permissions.categories['system.power']).toBe('deny')
    expect(status.status.routines).toEqual([])

    expect(handlerFor(IPC.actionsPause)(null, { paused: 'sim' })).toMatchObject({ ok: false })
    expect(handlerFor(IPC.actionsPause)(null, { paused: false })).toEqual({
      ok: true,
      paused: false
    })
  })
})
