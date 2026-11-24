import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPcName: vi.fn(),
  listRunningProcesses: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../startupManager', () => ({
  getPcName: mocks.getPcName,
  listRunningProcesses: mocks.listRunningProcesses
}))

import { registerSystemIpc } from './system'
import type { IpcContext } from './lifecycle'

const ctx = {} as IpcContext

function call(channel: string): unknown {
  return mocks.handlers.get(channel)?.({})
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerSystemIpc(ctx)
})

describe('system IPC', () => {
  it('system:pc-name devolve o nome do PC', () => {
    mocks.getPcName.mockReturnValue('DESKTOP-1')
    expect(call('system:pc-name')).toBe('DESKTOP-1')
  })

  it('system:running-processes devolve a lista assíncrona', async () => {
    mocks.listRunningProcesses.mockResolvedValue([{ id: 1, name: 'app' }])
    await expect(call('system:running-processes')).resolves.toEqual([{ id: 1, name: 'app' }])
    expect(mocks.listRunningProcesses).toHaveBeenCalledTimes(1)
  })
})
