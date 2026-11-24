import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listStartupItems: vi.fn(),
  removeStartupItem: vi.fn(),
  addStartupItem: vi.fn(),
  removeStartupItemsBatch: vi.fn(),
  addStartupItemsBatch: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../startupManager', () => ({
  listStartupItems: mocks.listStartupItems,
  removeStartupItem: mocks.removeStartupItem,
  addStartupItem: mocks.addStartupItem,
  removeStartupItemsBatch: mocks.removeStartupItemsBatch,
  addStartupItemsBatch: mocks.addStartupItemsBatch
}))

import { registerStartupIpc } from './startup'
import type { IpcContext } from './lifecycle'

const ctx = {} as IpcContext

function call(channel: string, payload?: unknown): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return payload === undefined ? handler({}) : handler({}, payload)
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerStartupIpc(ctx)
})

describe('startup IPC', () => {
  it('startup:list devolve os itens', () => {
    mocks.listStartupItems.mockReturnValue([{ name: 'A' }])
    expect(call('startup:list')).toEqual([{ name: 'A' }])
  })

  it('startup:remove encaminha o item', () => {
    const item = { location: 'registry', scope: 'user', name: 'App' }
    mocks.removeStartupItem.mockReturnValue({ success: true })
    expect(call('startup:remove', item)).toEqual({ success: true })
    expect(mocks.removeStartupItem).toHaveBeenCalledWith(item)
  })

  it('startup:add encaminha o item', () => {
    const item = { name: 'App', path: 'C:\\app.exe' }
    mocks.addStartupItem.mockReturnValue({ success: true })
    expect(call('startup:add', item)).toEqual({ success: true })
    expect(mocks.addStartupItem).toHaveBeenCalledWith(item)
  })

  it('startup:removeBatch encaminha a lista', () => {
    const items = [{ location: 'l', scope: 's', name: 'n' }]
    mocks.removeStartupItemsBatch.mockReturnValue({ success: true, removed: 1 })
    expect(call('startup:removeBatch', items)).toEqual({ success: true, removed: 1 })
    expect(mocks.removeStartupItemsBatch).toHaveBeenCalledWith(items)
  })

  it('startup:addBatch encaminha a lista', () => {
    const items = [{ name: 'n', path: 'p' }]
    mocks.addStartupItemsBatch.mockReturnValue({ success: true, added: 1 })
    expect(call('startup:addBatch', items)).toEqual({ success: true, added: 1 })
    expect(mocks.addStartupItemsBatch).toHaveBeenCalledWith(items)
  })
})
