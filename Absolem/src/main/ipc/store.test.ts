import { describe, expect, it, vi } from 'vitest'
import type { MemoryConfig } from '../../shared/config'
import { IPC } from '../../shared/ipc'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
  memory: { enabled: true, autoExtract: true, lastConsolidationAt: null } as MemoryConfig,
  audit: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      state.handlers.set(channel, handler)
    }
  }
}))

vi.mock('../store', () => ({
  isStoreKey: (value: unknown) => value === 'memory',
  getStoreSnapshot: () => ({ memory: state.memory }),
  setStoreValue: (_key: string, value: unknown) => {
    state.memory = value as MemoryConfig
    return { success: true }
  }
}))

vi.mock('../memory/instance', () => ({
  getMemoryRuntime: () => ({ auditConfigChange: state.audit })
}))

const { registerStoreIpc } = await import('./store')

function handler(channel: string): (payload: unknown) => unknown {
  const found = state.handlers.get(channel)
  if (!found) throw new Error(`handler ausente: ${channel}`)
  return (payload) => found({}, payload)
}

describe('IPC do store', () => {
  it('store:get devolve a chave normalizada', () => {
    registerStoreIpc()

    expect(handler(IPC.storeGet)({ key: 'memory' })).toEqual({
      ok: true,
      key: 'memory',
      value: { enabled: true, autoExtract: true, lastConsolidationAt: null }
    })
    expect(handler(IPC.storeGet)({ key: 'nope' })).toMatchObject({ ok: false })
  })

  it('store:set de memory persiste e audita pausa', () => {
    registerStoreIpc()

    const result = handler(IPC.storeSet)({
      key: 'memory',
      value: { enabled: false, autoExtract: true, lastConsolidationAt: null }
    })

    expect(result).toEqual({ ok: true })
    expect(state.memory.enabled).toBe(false)
    expect(state.audit).toHaveBeenCalledWith(
      { enabled: true, autoExtract: true, lastConsolidationAt: null },
      { enabled: false, autoExtract: true, lastConsolidationAt: null }
    )
  })
})
