import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  isFirstRun: vi.fn(() => true),
  markFirstRunComplete: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../firstRun', () => ({
  isFirstRun: mocks.isFirstRun,
  markFirstRunComplete: mocks.markFirstRunComplete
}))

import { registerFirstRunIpc } from './firstRun'
import type { IpcContext } from './lifecycle'

const ctx = {} as IpcContext

function call(channel: string): unknown {
  return mocks.handlers.get(channel)?.({})
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerFirstRunIpc(ctx)
})

describe('firstRun IPC', () => {
  it('firstRun:check devolve o estado atual', () => {
    expect(call('firstRun:check')).toBe(true)
    mocks.isFirstRun.mockReturnValue(false)
    expect(call('firstRun:check')).toBe(false)
  })

  it('firstRun:markComplete grava a flag e confirma', () => {
    expect(call('firstRun:markComplete')).toEqual({ success: true })
    expect(mocks.markFirstRunComplete).toHaveBeenCalledTimes(1)
  })
})
