import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  ensureKloudGamesInstalled: vi.fn(),
  getKloudGamesStatus: vi.fn(),
  invalidateKloudGamesRunningCache: vi.fn(),
  launchKloudGamesElevated: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('../kloudGames', () => ({
  ensureKloudGamesInstalled: mocks.ensureKloudGamesInstalled,
  getKloudGamesStatus: mocks.getKloudGamesStatus,
  invalidateKloudGamesRunningCache: mocks.invalidateKloudGamesRunningCache,
  launchKloudGamesElevated: mocks.launchKloudGamesElevated
}))

import { registerKloudGamesIpc } from './kloudGames'
import type { IpcContext } from './lifecycle'

const ctx = {} as IpcContext

function call(channel: string): unknown {
  return mocks.handlers.get(channel)?.({})
}

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerKloudGamesIpc(ctx)
})

describe('kloud-games:launch', () => {
  it('sem instalação disponível → erro', async () => {
    mocks.ensureKloudGamesInstalled.mockResolvedValue({ success: false })
    expect(await call('kloud-games:launch')).toEqual({
      success: false,
      error: 'Kloud Games não está disponível.'
    })
  })

  it('instalação ok mas sem exePath → erro', async () => {
    mocks.ensureKloudGamesInstalled.mockResolvedValue({ success: true })
    expect(await call('kloud-games:launch')).toEqual({
      success: false,
      error: 'Kloud Games não está disponível.'
    })
  })

  it('abre elevado e invalida o cache do status de execução', async () => {
    mocks.ensureKloudGamesInstalled.mockResolvedValue({
      success: true,
      exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe',
      installedNow: true
    })
    mocks.launchKloudGamesElevated.mockResolvedValue({ success: true })

    expect(await call('kloud-games:launch')).toEqual({
      success: true,
      error: undefined,
      exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe',
      cwd: 'C:\\Program Files\\KLOUD_GAMES',
      installedNow: true
    })
    expect(mocks.launchKloudGamesElevated).toHaveBeenCalledWith(
      'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe'
    )
    expect(mocks.invalidateKloudGamesRunningCache).toHaveBeenCalledTimes(1)
  })

  it('falha de elevação não invalida o cache e devolve erro', async () => {
    mocks.ensureKloudGamesInstalled.mockResolvedValue({
      success: true,
      exePath: 'C:\\Kg\\kg.exe'
    })
    mocks.launchKloudGamesElevated.mockResolvedValue({ success: false, error: 'UAC cancelado' })

    expect(await call('kloud-games:launch')).toMatchObject({
      success: false,
      error: 'UAC cancelado',
      installedNow: false
    })
    expect(mocks.invalidateKloudGamesRunningCache).not.toHaveBeenCalled()
  })
})

describe('kloud-games:status', () => {
  it('devolve o status do módulo principal', async () => {
    mocks.getKloudGamesStatus.mockResolvedValue({ installed: true, running: false })
    expect(await call('kloud-games:status')).toEqual({ installed: true, running: false })
  })
})
