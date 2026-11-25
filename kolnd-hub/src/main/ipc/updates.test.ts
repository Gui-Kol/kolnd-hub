import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  cancelUpdate: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../appUpdates', () => ({
  checkForUpdate: mocks.checkForUpdate,
  installUpdate: mocks.installUpdate,
  cancelUpdate: mocks.cancelUpdate
}))

import { registerUpdatesIpc } from './updates'
import type { IpcContext } from './lifecycle'

const ctx = {} as IpcContext

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerUpdatesIpc(ctx)
})

describe('updates IPC', () => {
  it('updates:check delega a busca', async () => {
    mocks.checkForUpdate.mockResolvedValue({ ok: true, update: null })
    await expect(call('updates:check')).resolves.toEqual({ ok: true, update: null })
  })

  it('updates:install repassa o releaseId e o contexto', async () => {
    mocks.installUpdate.mockResolvedValue({ success: true })
    await expect(call('updates:install', 123)).resolves.toEqual({ success: true })
    expect(mocks.installUpdate).toHaveBeenCalledWith(ctx, 123)
  })

  it('updates:install remove strings/objetos (validação fica no appUpdates)', async () => {
    mocks.installUpdate.mockResolvedValue({ success: false, error: 'id inválido' })
    await call('updates:install', { id: 1 })
    expect(mocks.installUpdate).toHaveBeenCalledWith(ctx, { id: 1 })
  })

  it('updates:cancel delega o cancelamento', () => {
    mocks.cancelUpdate.mockReturnValue({ success: true })
    expect(call('updates:cancel')).toEqual({ success: true })
  })
})
