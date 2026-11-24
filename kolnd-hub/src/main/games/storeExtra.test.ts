import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStoredGames: vi.fn(),
  setStoredGames: vi.fn(),
  normalizeGame: vi.fn(),
  realNormalizeGame: null as unknown,
  gameIconsDir: vi.fn(() => 'C:\\ud\\game-icons'),
  resolveIcon: vi.fn((path: unknown) => (typeof path === 'string' ? path : null)),
  deleteStaleIcons: vi.fn(),
  extractIconPng: vi.fn(),
  deleteCachedIcon: vi.fn(),
  existsSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
  logWarn: vi.fn()
}))

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>()
  mocks.realNormalizeGame = actual.normalizeGame
  return {
    ...actual,
    getStoredGames: mocks.getStoredGames,
    setStoredGames: mocks.setStoredGames,
    normalizeGame: (...args: unknown[]) => mocks.normalizeGame(...args)
  }
})
vi.mock('./icons', () => ({
  gameIconsDir: mocks.gameIconsDir,
  resolveIconInsideGameIcons: mocks.resolveIcon,
  deleteStaleIcons: mocks.deleteStaleIcons,
  extractIconPng: mocks.extractIconPng,
  deleteCachedIcon: mocks.deleteCachedIcon
}))
vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  rmSync: mocks.rmSync,
  statSync: mocks.statSync
}))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import { addCustomGame, addGame, checkExePaths, getGames, removeGame, updateGame } from './store'
import type { Game } from './store'

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game-1',
    name: 'Jogo',
    exePath: 'C:\\Jogos\\jogo.exe',
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getStoredGames.mockReturnValue([])
  mocks.setStoredGames.mockReturnValue({ success: true })
  mocks.resolveIcon.mockImplementation((path: unknown) => (typeof path === 'string' ? path : null))
  mocks.normalizeGame.mockImplementation((value: unknown) =>
    (mocks.realNormalizeGame as (v: unknown) => unknown)(value)
  )
  mocks.extractIconPng.mockResolvedValue(true)
  mocks.existsSync.mockReturnValue(true)
  mocks.statSync.mockReturnValue({ isFile: () => true })
})

describe('getGames', () => {
  it('devolve a lista persistida', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    expect(getGames()).toEqual([game()])
  })
})

describe('addGame — validações extras', () => {
  it('recusa ícone fora da pasta canônica', () => {
    mocks.resolveIcon.mockReturnValueOnce(null)
    expect(addGame(game({ iconPath: 'C:\\fora.png' }))).toEqual({
      success: false,
      error: 'O ícone deve estar dentro da pasta de ícones do Kolnd Hub.'
    })
  })

  it('recusa steamAppId duplicado', () => {
    mocks.getStoredGames.mockReturnValue([game({ id: 'outro', steamAppId: 42 })])
    expect(addGame(game({ steamAppId: 42 }))).toEqual({
      success: false,
      error: 'Este jogo da Steam já está na sua biblioteca.'
    })
  })

  it('propaga falha do store ao salvar', () => {
    mocks.setStoredGames.mockReturnValue({ success: false, error: 'sem disco' })
    expect(addGame(game())).toEqual({ success: false, error: 'sem disco' })

    mocks.setStoredGames.mockReturnValue({ success: false })
    expect(addGame(game())).toEqual({
      success: false,
      error: 'Não foi possível salvar o jogo.'
    })
  })
})

describe('addCustomGame — validações extras', () => {
  it('recusa caminho que não é arquivo e jogo já existente', async () => {
    mocks.statSync.mockReturnValue({ isFile: () => false })
    await expect(addCustomGame('C:\\Jogos\\jogo.exe')).resolves.toEqual({
      success: false,
      error: 'O caminho escolhido não é um arquivo.'
    })

    mocks.statSync.mockReturnValue({ isFile: () => true })
    mocks.getStoredGames.mockReturnValue([game()])
    await expect(addCustomGame('C:\\Jogos\\jogo.exe')).resolves.toEqual({
      success: false,
      error: 'Este jogo já está na sua biblioteca.'
    })
  })

  it('propaga a falha de addGame (ex.: store cheio)', async () => {
    mocks.setStoredGames.mockReturnValue({ success: false, error: 'disco cheio' })
    await expect(addCustomGame('C:\\Jogos\\jogo.exe')).resolves.toEqual({
      success: false,
      error: 'disco cheio'
    })
  })
})

describe('checkExePaths — falha do fs', () => {
  it('existsSync lançando vira false', () => {
    mocks.existsSync.mockImplementationOnce(() => {
      throw new Error('EACCES')
    })
    expect(checkExePaths(['C:\\a.exe'])).toEqual([false])
  })
})

describe('updateGame — ramos de erro e troca de ícone', () => {
  it('valida exePath, iconPath, origem e steamAppId', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    expect(updateGame('game-1', { exePath: '' })).toEqual({
      success: false,
      error: 'Caminho do executável inválido.'
    })
    mocks.resolveIcon.mockReturnValueOnce(null)
    expect(updateGame('game-1', { iconPath: 'C:\\fora.png' })).toEqual({
      success: false,
      error: 'O ícone deve estar dentro da pasta de ícones do Kolnd Hub.'
    })
    expect(updateGame('game-1', { origin: 'manual' as never })).toEqual({
      success: false,
      error: 'Origem do jogo inválida.'
    })
    expect(updateGame('game-1', { origin: 'epic' })).toEqual({ success: true })
    expect((mocks.setStoredGames.mock.calls.at(-1)?.[0] as Game[] | undefined)?.[0].origin).toBe(
      'epic'
    )
    expect(updateGame('game-1', { origin: 'minecraft' })).toEqual({ success: true })
    expect((mocks.setStoredGames.mock.calls.at(-1)?.[0] as Game[] | undefined)?.[0].origin).toBe(
      'minecraft'
    )
    expect(updateGame('game-1', { steamAppId: 1.5 })).toEqual({
      success: false,
      error: 'steamAppId inválido.'
    })
  })

  it('null limpa iconPath e remove steamAppId', () => {
    mocks.getStoredGames.mockReturnValue([game({ steamAppId: 42, iconPath: 'C:\\ud\\a.png' })])
    expect(updateGame('game-1', { iconPath: null, steamAppId: null })).toEqual({ success: true })
    const saved = mocks.setStoredGames.mock.calls[0][0] as Game[]
    expect(saved[0].iconPath).toBeNull()
    expect(saved[0].steamAppId).toBeUndefined()
  })

  it('dados inválidos após a alteração e falha do store', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.normalizeGame.mockReturnValueOnce(null)
    expect(updateGame('game-1', { name: 'Novo' })).toEqual({
      success: false,
      error: 'Dados do jogo inválidos após a alteração.'
    })

    mocks.setStoredGames.mockReturnValueOnce({ success: false, error: 'sem disco' })
    expect(updateGame('game-1', { name: 'Novo' })).toEqual({
      success: false,
      error: 'sem disco'
    })
    mocks.setStoredGames.mockReturnValueOnce({ success: false })
    expect(updateGame('game-1', { name: 'Novo' })).toEqual({
      success: false,
      error: 'Não foi possível salvar as alterações.'
    })
  })

  it('troca de ícone apaga o antigo e falha de rm só loga', () => {
    const oldIcon = 'C:\\ud\\game-icons\\game-1.png'
    mocks.getStoredGames.mockReturnValue([game({ iconPath: oldIcon })])
    mocks.resolveIcon.mockImplementation((path: unknown) =>
      typeof path === 'string' ? path : null
    )

    expect(updateGame('game-1', { iconPath: 'C:\\ud\\game-icons\\game-1.jpg' })).toEqual({
      success: true
    })
    expect(mocks.rmSync).toHaveBeenCalledWith(oldIcon, { force: true })
    expect(mocks.deleteStaleIcons).toHaveBeenCalledWith('game-1', 'C:\\ud\\game-icons\\game-1.jpg')

    mocks.rmSync.mockImplementationOnce(() => {
      throw new Error('EBUSY')
    })
    expect(updateGame('game-1', { iconPath: 'C:\\ud\\game-icons\\game-1.webp' })).toEqual({
      success: true
    })
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('removeGame — falha do store', () => {
  it('não apaga o ícone quando a persistência falha', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.setStoredGames.mockReturnValue({ success: false })
    expect(removeGame('game-1')).toEqual({
      success: false,
      error: 'Não foi possível remover o jogo.'
    })
    expect(mocks.deleteCachedIcon).not.toHaveBeenCalled()
  })
})
