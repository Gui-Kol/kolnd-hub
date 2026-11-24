import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getGames: vi.fn(),
  addGame: vi.fn(),
  addCustomGame: vi.fn(),
  updateGame: vi.fn(),
  checkExePaths: vi.fn(),
  removeGame: vi.fn(),
  pickGameIcon: vi.fn(),
  setGameIcon: vi.fn(),
  previewExeIcon: vi.fn(),
  restoreExeIcon: vi.fn(),
  getGameIcon: vi.fn(),
  reloadGameIcons: vi.fn(),
  refreshGameIcons: vi.fn(),
  launchGame: vi.fn(),
  stopGame: vi.fn(),
  runningGamesMap: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./store', () => ({
  getGames: mocks.getGames,
  addGame: mocks.addGame,
  addCustomGame: mocks.addCustomGame,
  updateGame: mocks.updateGame,
  checkExePaths: mocks.checkExePaths,
  removeGame: mocks.removeGame
}))
vi.mock('./icons', () => ({
  pickGameIcon: mocks.pickGameIcon,
  setGameIcon: mocks.setGameIcon,
  previewExeIcon: mocks.previewExeIcon,
  restoreExeIcon: mocks.restoreExeIcon,
  getGameIcon: mocks.getGameIcon,
  reloadGameIcons: mocks.reloadGameIcons,
  refreshGameIcons: mocks.refreshGameIcons
}))
vi.mock('./launch', () => ({
  launchGame: mocks.launchGame,
  stopGame: mocks.stopGame,
  runningGamesMap: mocks.runningGamesMap
}))

import { registerGamesIpc } from './index'

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  registerGamesIpc()
})

describe('registerGamesIpc', () => {
  it('registra todos os canais da biblioteca', () => {
    expect([...mocks.handlers.keys()].sort()).toEqual([
      'games:add',
      'games:add-custom',
      'games:check-exes',
      'games:get',
      'games:get-icon',
      'games:launch',
      'games:pick-icon',
      'games:preview-exe-icon',
      'games:refresh-icons',
      'games:reload-icons',
      'games:remove',
      'games:restore-exe-icon',
      'games:running-map',
      'games:set-icon',
      'games:stop',
      'games:update'
    ])
  })

  it('encaminha leitura, adição e atualização', () => {
    mocks.getGames.mockReturnValue([{ id: 'g1' }])
    mocks.addGame.mockReturnValue({ success: true })
    mocks.updateGame.mockReturnValue({ success: true })
    mocks.checkExePaths.mockReturnValue([true])
    mocks.removeGame.mockReturnValue({ success: true })

    expect(call('games:get')).toEqual([{ id: 'g1' }])
    expect(call('games:add', { id: 'g1' })).toEqual({ success: true })
    expect(mocks.addGame).toHaveBeenCalledWith({ id: 'g1' })
    expect(call('games:update', 'g1', { name: 'X' })).toEqual({ success: true })
    expect(mocks.updateGame).toHaveBeenCalledWith('g1', { name: 'X' })
    expect(call('games:check-exes', ['C:\\a.exe'])).toEqual([true])
    expect(call('games:remove', 'g1')).toEqual({ success: true })
    expect(mocks.removeGame).toHaveBeenCalledWith('g1')
  })

  it('encaminha adição por executável e execução', async () => {
    mocks.addCustomGame.mockReturnValue(Promise.resolve({ success: true }))
    mocks.launchGame.mockReturnValue(Promise.resolve({ ok: true }))
    mocks.stopGame.mockReturnValue(Promise.resolve({ ok: true, killed: 1 }))
    mocks.runningGamesMap.mockReturnValue({ ok: true, running: {} })

    await expect(call('games:add-custom', 'C:\\jogo.exe')).resolves.toEqual({ success: true })
    await expect(call('games:launch', 'g1')).resolves.toEqual({ ok: true })
    await expect(call('games:stop', 'g1')).resolves.toEqual({ ok: true, killed: 1 })
    expect(call('games:running-map', ['g1'])).toEqual({ ok: true, running: {} })
  })

  it('encaminha os canais de ícone', async () => {
    mocks.pickGameIcon.mockReturnValue(Promise.resolve({ success: true, dataUrl: 'data:' }))
    mocks.setGameIcon.mockReturnValue({ success: true, iconPath: 'C:\\icon.png' })
    mocks.previewExeIcon.mockReturnValue(Promise.resolve({ success: true }))
    mocks.restoreExeIcon.mockReturnValue(Promise.resolve({ success: true }))
    mocks.getGameIcon.mockReturnValue('data:image/png;base64,xx')
    mocks.reloadGameIcons.mockReturnValue(Promise.resolve({ checked: 1, reloaded: 1, failed: 0 }))
    mocks.refreshGameIcons.mockReturnValue(Promise.resolve({ checked: 1, refreshed: 1, failed: 0 }))

    await expect(call('games:pick-icon')).resolves.toEqual({ success: true, dataUrl: 'data:' })
    expect(call('games:set-icon', 'g1', 'data:...')).toEqual({
      success: true,
      iconPath: 'C:\\icon.png'
    })
    expect(mocks.setGameIcon).toHaveBeenCalledWith('g1', 'data:...')
    await expect(call('games:preview-exe-icon', 'C:\\a.exe')).resolves.toEqual({ success: true })
    await expect(call('games:restore-exe-icon', 'g1', 'C:\\a.exe')).resolves.toEqual({
      success: true
    })
    expect(mocks.restoreExeIcon).toHaveBeenCalledWith('g1', 'C:\\a.exe')
    expect(call('games:get-icon', 'g1')).toBe('data:image/png;base64,xx')
    await expect(call('games:reload-icons')).resolves.toEqual({
      checked: 1,
      reloaded: 1,
      failed: 0
    })
    await expect(call('games:refresh-icons')).resolves.toEqual({
      checked: 1,
      refreshed: 1,
      failed: 0
    })
  })
})
