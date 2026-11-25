import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getRemoteStatus: vi.fn(),
  getRemoteMode: vi.fn(),
  requestRemoteMode: vi.fn(),
  fetchPublicIp: vi.fn(),
  installZeroTier: vi.fn(),
  openZeroTier: vi.fn(),
  setZeroTierOpen: vi.fn(),
  openKloudWebPanel: vi.fn(),
  copyRemoteText: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../remoteAccess', () => ({
  getRemoteStatus: mocks.getRemoteStatus,
  requestRemoteMode: mocks.requestRemoteMode,
  fetchPublicIp: mocks.fetchPublicIp,
  installZeroTier: mocks.installZeroTier,
  openZeroTier: mocks.openZeroTier,
  setZeroTierOpen: mocks.setZeroTierOpen,
  openKloudWebPanel: mocks.openKloudWebPanel,
  copyRemoteText: mocks.copyRemoteText
}))
vi.mock('../store', () => ({ getRemoteMode: mocks.getRemoteMode }))

import { registerRemoteAccessIpc } from './remoteAccess'
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
  registerRemoteAccessIpc(ctx)
})

describe('remoteAccess IPC', () => {
  it('registra os nove canais', () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      'remote:copy',
      'remote:get-mode',
      'remote:install-zerotier',
      'remote:open-kloud-web',
      'remote:open-zerotier',
      'remote:public-ip',
      'remote:set-mode',
      'remote:set-zerotier-open',
      'remote:status'
    ])
  })

  it('encaminha cada canal para a função correspondente', async () => {
    mocks.getRemoteStatus.mockReturnValue({ state: 'idle' })
    mocks.getRemoteMode.mockReturnValue('lan')
    mocks.requestRemoteMode.mockReturnValue({ ok: true })
    mocks.fetchPublicIp.mockResolvedValue({ ip: '1.2.3.4' })
    mocks.installZeroTier.mockResolvedValue({ success: true })
    mocks.openZeroTier.mockResolvedValue({ success: true })
    mocks.setZeroTierOpen.mockResolvedValue({ success: true, open: true })
    mocks.openKloudWebPanel.mockResolvedValue({ success: true })
    mocks.copyRemoteText.mockReturnValue({ ok: true })

    expect(call('remote:status')).toEqual({ state: 'idle' })
    expect(call('remote:get-mode')).toBe('lan')
    expect(call('remote:set-mode', 'wan')).toEqual({ ok: true })
    expect(mocks.requestRemoteMode).toHaveBeenCalledWith('wan')
    await expect(call('remote:public-ip')).resolves.toEqual({ ip: '1.2.3.4' })
    await expect(call('remote:install-zerotier')).resolves.toEqual({ success: true })
    await expect(call('remote:open-zerotier')).resolves.toEqual({ success: true })
    await expect(call('remote:set-zerotier-open', true)).resolves.toEqual({
      success: true,
      open: true
    })
    expect(mocks.setZeroTierOpen).toHaveBeenCalledWith(true)
    await expect(call('remote:open-kloud-web')).resolves.toEqual({ success: true })
    expect(call('remote:copy', 'texto')).toEqual({ ok: true })
    expect(mocks.copyRemoteText).toHaveBeenCalledWith('texto')
  })
})
