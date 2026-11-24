import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userData: 'C:\\ud',
  showOpenDialog: vi.fn(),
  createFromPath: vi.fn(),
  createFromBuffer: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
  getStoredGames: vi.fn(),
  lookupIconDataUrl: vi.fn(),
  storeIconDataUrl: vi.fn(),
  invalidateIconCache: vi.fn(),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  nativeImage: {
    createFromPath: mocks.createFromPath,
    createFromBuffer: mocks.createFromBuffer
  }
}))
vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  readdirSync: mocks.readdirSync,
  rmSync: mocks.rmSync,
  statSync: mocks.statSync,
  writeFileSync: mocks.writeFileSync
}))
vi.mock('../store', () => ({ getStoredGames: mocks.getStoredGames }))
vi.mock('../iconCache', () => ({
  lookupIconDataUrl: mocks.lookupIconDataUrl,
  storeIconDataUrl: mocks.storeIconDataUrl,
  invalidateIconCache: mocks.invalidateIconCache
}))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  COVER_MAX_BYTES,
  coverExtensionForMime,
  getGameCover,
  pickGameCover,
  resolveCoverInsideGameCovers,
  safeCoverBase,
  safeCoverFileName,
  setGameCover
} from './covers'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getStoredGames.mockReturnValue([])
  mocks.existsSync.mockReturnValue(true)
  mocks.statSync.mockReturnValue({ isFile: () => true, size: 1024 })
})

describe('helpers puros de capa', () => {
  it('mapeia mime para extensão canônica', () => {
    expect(coverExtensionForMime('image/png')).toBe('.png')
    expect(coverExtensionForMime('image/jpeg')).toBe('.jpg')
    expect(coverExtensionForMime('image/webp')).toBe('.webp')
    expect(coverExtensionForMime('image/gif')).toBeNull()
  })

  it('gera nome de arquivo seguro a partir do id', () => {
    expect(safeCoverBase('steam_123')).toBe('steam_123')
    expect(safeCoverBase('a/b:c')).toBe('a_b_c')
    expect(safeCoverBase('   ')).toBe('game')
    expect(safeCoverFileName('steam_123', 'image/jpeg')).toBe('steam_123.jpg')
    expect(safeCoverFileName('g1', 'image/gif')).toBeNull()
  })

  it('só aceita caminho absoluto dentro de game-covers', () => {
    expect(resolveCoverInsideGameCovers('C:\\ud\\game-covers\\a.png')).toBe(
      'C:\\ud\\game-covers\\a.png'
    )
    expect(resolveCoverInsideGameCovers('C:\\fora\\a.png')).toBeNull()
    expect(resolveCoverInsideGameCovers('game-covers\\a.png')).toBeNull()
    expect(resolveCoverInsideGameCovers(null)).toBeNull()
  })
})

describe('pickGameCover', () => {
  it('cancelado → canceled sem erro', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(pickGameCover()).resolves.toEqual({ success: false, canceled: true })
  })

  it('recusa arquivo grande/corrompido', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a.png'] })
    mocks.statSync.mockReturnValue({ isFile: () => true, size: COVER_MAX_BYTES + 1 })
    await expect(pickGameCover()).resolves.toEqual({
      success: false,
      error: 'A imagem é muito grande (máx. 8 MB).'
    })

    mocks.statSync.mockReturnValue({ isFile: () => true, size: 1024 })
    mocks.createFromPath.mockReturnValue({ isEmpty: () => true })
    await expect(pickGameCover()).resolves.toEqual({
      success: false,
      error: 'Não foi possível ler a imagem. O arquivo pode estar corrompido.'
    })
  })
})

describe('setGameCover / getGameCover', () => {
  it('valida id, dataURL e existência do jogo', () => {
    expect(setGameCover('', 'data:image/png;base64,AA')).toEqual({
      success: false,
      error: 'Identificador do jogo inválido.'
    })
    expect(setGameCover('g1', 'texto')).toEqual({
      success: false,
      error: 'Formato de imagem não suportado. Use PNG, JPG ou WebP.'
    })
    mocks.createFromBuffer.mockReturnValue({ isEmpty: () => false })
    expect(setGameCover('g1', 'data:image/png;base64,AA')).toEqual({
      success: false,
      error: 'Jogo não encontrado na biblioteca.'
    })
    expect(getGameCover('g1')).toBeNull()
  })
})
