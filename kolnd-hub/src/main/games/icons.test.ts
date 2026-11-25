import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  userData: 'C:\\ud',
  getFileIcon: vi.fn(),
  showOpenDialog: vi.fn(),
  createFromPath: vi.fn(),
  createFromBuffer: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
  getStoredGames: vi.fn(),
  setStoredGames: vi.fn(),
  getGameIconsVersion: vi.fn(),
  setGameIconsVersion: vi.fn(),
  lookupIconDataUrl: vi.fn(),
  storeIconDataUrl: vi.fn(),
  invalidateIconCache: vi.fn(),
  readExeIconIco: vi.fn(),
  findGameExecutable: vi.fn(),
  steamGameRootFromExe: vi.fn(),
  reloadMissingGameIcons: vi.fn(),
  refreshAllGameIcons: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userData,
    getFileIcon: mocks.getFileIcon
  },
  dialog: { showOpenDialog: mocks.showOpenDialog },
  nativeImage: {
    createFromPath: mocks.createFromPath,
    createFromBuffer: mocks.createFromBuffer
  }
}))
vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  mkdtempSync: mocks.mkdtempSync,
  readFileSync: mocks.readFileSync,
  readdirSync: mocks.readdirSync,
  rmSync: mocks.rmSync,
  statSync: mocks.statSync,
  writeFileSync: mocks.writeFileSync
}))
vi.mock('os', () => ({ tmpdir: () => 'C:\\fake-tmp' }))
vi.mock('../store', () => ({
  getStoredGames: mocks.getStoredGames,
  setStoredGames: mocks.setStoredGames,
  getGameIconsVersion: mocks.getGameIconsVersion,
  setGameIconsVersion: mocks.setGameIconsVersion
}))
vi.mock('../iconCache', () => ({
  lookupIconDataUrl: mocks.lookupIconDataUrl,
  storeIconDataUrl: mocks.storeIconDataUrl,
  invalidateIconCache: mocks.invalidateIconCache
}))
vi.mock('./exeIcon', () => ({ readExeIconIco: mocks.readExeIconIco }))
vi.mock('./exeFinder', () => ({
  findGameExecutable: mocks.findGameExecutable,
  steamGameRootFromExe: mocks.steamGameRootFromExe
}))
vi.mock('./iconReload', () => ({
  reloadMissingGameIcons: mocks.reloadMissingGameIcons,
  refreshAllGameIcons: mocks.refreshAllGameIcons
}))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  deleteCachedIcon,
  deleteStaleIcons,
  extractIconPng,
  GAME_ICON_PIPELINE_VERSION,
  gameIconsDir,
  getGameIcon,
  pickGameIcon,
  previewExeIcon,
  refreshGameIcons,
  reloadGameIcons,
  repairGameIconsIfNeeded,
  resolveIconInsideGameIcons,
  restoreExeIcon,
  setGameIcon
} from './icons'
import type { StoredGame } from '../store'

const ICONS = 'C:\\ud\\game-icons'

function image(options: { empty?: boolean; png?: Buffer; bitmap?: Buffer } = {}) {
  const result = {
    isEmpty: () => options.empty ?? false,
    toPNG: () => options.png ?? Buffer.from('png'),
    resize: () => result,
    toBitmap: () => options.bitmap ?? Buffer.alloc(4)
  }
  return result
}

function game(overrides: Partial<StoredGame> = {}): StoredGame {
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
  mocks.createFromPath.mockReturnValue(image())
  mocks.createFromBuffer.mockReturnValue(image())
  mocks.mkdtempSync.mockReturnValue('C:\\fake-tmp\\dir')
  mocks.getStoredGames.mockReturnValue([])
  mocks.setStoredGames.mockReturnValue({ success: true })
  mocks.lookupIconDataUrl.mockReturnValue(null)
  mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
  mocks.existsSync.mockReturnValue(false)
  mocks.readdirSync.mockReturnValue([])
  mocks.readExeIconIco.mockReturnValue(null)
  mocks.getFileIcon.mockResolvedValue(image())
  mocks.steamGameRootFromExe.mockReturnValue(null)
  mocks.findGameExecutable.mockReturnValue(null)
})

describe('caminhos e validação de ícone', () => {
  it('gameIconsDir fica em <userData>/game-icons', () => {
    expect(gameIconsDir()).toBe(ICONS)
  })

  it('resolveIconInsideGameIcons aceita só caminho absoluto dentro da pasta', () => {
    expect(resolveIconInsideGameIcons(join(ICONS, 'game-1.png'))).toBe(join(ICONS, 'game-1.png'))
    expect(resolveIconInsideGameIcons(join(ICONS, '..', 'fora.png'))).toBeNull()
    expect(resolveIconInsideGameIcons(ICONS)).toBeNull()
    expect(resolveIconInsideGameIcons('game-1.png')).toBeNull()
    expect(resolveIconInsideGameIcons(null)).toBeNull()
    expect(resolveIconInsideGameIcons('   ')).toBeNull()
  })
})

describe('deleteStaleIcons', () => {
  it('apaga imagens do jogo e preserva o caminho recém-gravado', () => {
    const keep = join(ICONS, 'game-1.png')
    mocks.existsSync.mockReturnValue(true)
    mocks.readdirSync.mockReturnValue([
      'game-1.png',
      'game-1.jpg',
      'game-1.webp',
      'game-2.png',
      'game-1.txt'
    ])

    deleteStaleIcons('game-1', keep)
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'game-1.jpg'), { force: true })
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'game-1.webp'), { force: true })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(keep, { force: true })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(join(ICONS, 'game-2.png'), { force: true })
  })

  it('pasta ausente ou falha ao apagar não lança', () => {
    mocks.readdirSync.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    expect(() => deleteStaleIcons('game-1', null)).not.toThrow()

    mocks.readdirSync.mockReturnValueOnce(['game-1.png'])
    mocks.rmSync.mockImplementationOnce(() => {
      throw new Error('EPERM')
    })
    expect(() => deleteStaleIcons('game-1', null)).not.toThrow()
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('extractIconPng', () => {
  it('grava o PNG extraído dos recursos PE', async () => {
    mocks.readExeIconIco.mockReturnValue(Buffer.from('ico'))
    mocks.createFromPath.mockReturnValue(image({ png: Buffer.from('png-pe') }))

    await expect(extractIconPng('C:\\jogo.exe', join(ICONS, 'game-1.png'))).resolves.toBe(true)
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      join(ICONS, 'game-1.png'),
      Buffer.from('png-pe')
    )
    expect(mocks.invalidateIconCache).toHaveBeenCalled()
  })

  it('cai para app.getFileIcon quando o PE não tem ícone', async () => {
    await expect(extractIconPng('C:\\jogo.exe', join(ICONS, 'x.png'))).resolves.toBe(true)
    expect(mocks.getFileIcon).toHaveBeenCalledWith('C:\\jogo.exe', { size: 'large' })
  })

  it('retorna false quando imagem vazia, exe sem ícone ou escrita falha', async () => {
    mocks.getFileIcon.mockResolvedValue(image({ empty: true }))
    await expect(extractIconPng('C:\\jogo.exe', join(ICONS, 'x.png'))).resolves.toBe(false)

    mocks.readExeIconIco.mockReturnValue(Buffer.from('ico'))
    mocks.createFromPath.mockReturnValue(image({ empty: true }))
    mocks.getFileIcon.mockRejectedValue(new Error('shell falhou'))
    await expect(extractIconPng('C:\\jogo.exe', join(ICONS, 'x.png'))).resolves.toBe(false)

    mocks.readExeIconIco.mockReturnValue(null)
    mocks.getFileIcon.mockResolvedValue(image())
    mocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('disco cheio')
    })
    await expect(extractIconPng('C:\\jogo.exe', join(ICONS, 'x.png'))).resolves.toBe(false)
  })

  it('PNG vazio do ico também cai para o shell', async () => {
    mocks.readExeIconIco.mockReturnValue(Buffer.from('ico'))
    mocks.createFromPath.mockReturnValue(image({ png: Buffer.alloc(0) }))
    await expect(extractIconPng('C:\\jogo.exe', join(ICONS, 'x.png'))).resolves.toBe(true)
    expect(mocks.getFileIcon).toHaveBeenCalled()
  })
})

describe('pickGameIcon', () => {
  it('cancelado → {canceled:true}', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(pickGameIcon()).resolves.toEqual({ success: false, canceled: true })
  })

  it('recusa .ico, extensões desconhecidas, vazio e grande demais', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a.ico'] })
    await expect(pickGameIcon()).resolves.toMatchObject({ error: expect.stringContaining('.ico') })

    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a.txt'] })
    await expect(pickGameIcon()).resolves.toMatchObject({
      error: expect.stringContaining('Formato')
    })

    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a.png'] })
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 0 })
    await expect(pickGameIcon()).resolves.toMatchObject({ error: expect.stringContaining('vazia') })

    mocks.statSync.mockReturnValue({ isFile: () => true, size: 5 * 1024 * 1024 })
    await expect(pickGameIcon()).resolves.toMatchObject({ error: expect.stringContaining('4 MB') })
  })

  it('recusa imagem que não decodifica', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a.png'] })
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.createFromPath.mockReturnValue(image({ empty: true }))
    await expect(pickGameIcon()).resolves.toMatchObject({
      error: expect.stringContaining('corrompido')
    })
  })

  it('sucesso devolve dataURL com o tipo correto', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a.jpeg'] })
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 3 })
    mocks.readFileSync.mockReturnValue(Buffer.from('abc'))
    await expect(pickGameIcon()).resolves.toEqual({
      success: true,
      dataUrl: 'data:image/jpeg;base64,YWJj'
    })
  })

  it('exceção vira erro amigável', async () => {
    mocks.showOpenDialog.mockRejectedValue(new Error('diálogo'))
    await expect(pickGameIcon()).resolves.toEqual({
      success: false,
      error: 'Não foi possível abrir a imagem escolhida.'
    })
  })
})

describe('setGameIcon', () => {
  const PNG = `data:image/png;base64,${Buffer.from('img').toString('base64')}`

  it('valida id, payload e formato', () => {
    expect(setGameIcon('  ', PNG)).toMatchObject({ success: false })
    expect(setGameIcon('game-1', 42)).toMatchObject({ success: false })
    expect(setGameIcon('game-1', 'data:text/plain;base64,AAAA')).toMatchObject({
      success: false,
      error: expect.stringContaining('Formato')
    })
    mocks.createFromBuffer.mockReturnValueOnce(image({ empty: true }))
    expect(setGameIcon('game-1', PNG)).toMatchObject({ success: false })
  })

  it('exige jogo existente e grava no formato do mime', () => {
    mocks.getStoredGames.mockReturnValue([])
    expect(setGameIcon('game-1', PNG)).toEqual({
      success: false,
      error: 'Jogo não encontrado na biblioteca.'
    })

    mocks.getStoredGames.mockReturnValue([game()])
    expect(setGameIcon('game-1', PNG)).toEqual({
      success: true,
      iconPath: join(ICONS, 'game-1.png')
    })
    expect(mocks.writeFileSync).toHaveBeenCalledWith(join(ICONS, 'game-1.png'), Buffer.from('img'))

    const JPG = `data:image/jpeg;base64,${Buffer.from('img').toString('base64')}`
    expect(setGameIcon('game-1', JPG)).toMatchObject({ iconPath: join(ICONS, 'game-1.jpg') })
    const WEBP = `data:image/webp;base64,${Buffer.from('img').toString('base64')}`
    expect(setGameIcon('game-1', WEBP)).toMatchObject({ iconPath: join(ICONS, 'game-1.webp') })
  })

  it('falha de escrita vira erro', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('EPERM')
    })
    expect(setGameIcon('game-1', PNG)).toEqual({
      success: false,
      error: 'Não foi possível gravar a imagem na pasta de ícones.'
    })
  })
})

describe('previewExeIcon / restoreExeIcon', () => {
  it('preview valida caminho e existência', async () => {
    expect(await previewExeIcon(null)).toMatchObject({ success: false })
    expect(await previewExeIcon('relativo.exe')).toMatchObject({ success: false })
    expect(await previewExeIcon('C:\\Jogos\\jogo.exe')).toEqual({
      success: false,
      error: 'Executável não encontrado: C:\\Jogos\\jogo.exe'
    })
  })

  it('preview devolve dataURL do ícone ou erro quando vazio', async () => {
    mocks.existsSync.mockReturnValue(true)
    expect(await previewExeIcon('C:\\Jogos\\jogo.exe')).toMatchObject({
      success: true,
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/)
    })

    mocks.getFileIcon.mockResolvedValue(image({ empty: true }))
    await expect(previewExeIcon('C:\\Jogos\\jogo.exe')).resolves.toEqual({
      success: false,
      error: 'O executável não tem um ícone utilizável.'
    })
  })

  it('preview captura erro inesperado do leitor de ícone', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readExeIconIco.mockImplementation(() => {
      throw new Error('PE inválido')
    })
    await expect(previewExeIcon('C:\\Jogos\\jogo.exe')).resolves.toMatchObject({ success: false })
  })

  it('restore valida id, jogo, caminho opcional e existência', async () => {
    expect(await restoreExeIcon('  ')).toMatchObject({ success: false })
    mocks.getStoredGames.mockReturnValue([])
    expect(await restoreExeIcon('game-1')).toMatchObject({ success: false })

    mocks.getStoredGames.mockReturnValue([game()])
    expect(await restoreExeIcon('game-1', 'relativo.exe')).toMatchObject({ success: false })
    expect(await restoreExeIcon('game-1')).toMatchObject({
      error: expect.stringContaining('Executável não encontrado')
    })
  })

  it('restore extrai do exe gravado ou do override', async () => {
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.existsSync.mockReturnValue(true)
    mocks.readExeIconIco.mockReturnValue(Buffer.from('ico'))

    await expect(restoreExeIcon('game-1')).resolves.toEqual({
      success: true,
      iconPath: join(ICONS, 'game-1.png')
    })
    await expect(restoreExeIcon('game-1', 'C:\\Outro\\jogo.exe')).resolves.toMatchObject({
      success: true
    })

    mocks.readExeIconIco.mockReturnValue(null)
    mocks.getFileIcon.mockResolvedValue(image({ empty: true }))
    await expect(restoreExeIcon('game-1')).resolves.toMatchObject({
      error: 'O executável não tem um ícone utilizável.'
    })
  })
})

describe('getGameIcon / deleteCachedIcon', () => {
  it('id inválido ou jogo ausente → null', () => {
    expect(getGameIcon(42)).toBeNull()
    mocks.getStoredGames.mockReturnValue([])
    expect(getGameIcon('game-1')).toBeNull()
  })

  it('serve do cache LRU quando o stat bate', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.existsSync.mockImplementation((path: string) => path === join(ICONS, 'game-1.png'))
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.lookupIconDataUrl.mockReturnValue('data:image/png;base64,old')

    expect(getGameIcon('game-1')).toBe('data:image/png;base64,old')
    expect(mocks.readFileSync).not.toHaveBeenCalled()
  })

  it('lê e monta dataURL com o mime pela extensão', () => {
    mocks.getStoredGames.mockReturnValue([game({ iconPath: join(ICONS, 'game-1.jpg') })])
    mocks.existsSync.mockReturnValue(true)
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.from('jpg'))

    expect(getGameIcon('game-1')).toBe('data:image/jpeg;base64,anBn')
    expect(mocks.storeIconDataUrl).toHaveBeenCalled()
  })

  it('arquivo inválido/grande/ilegível → null e cache invalidado', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.existsSync.mockReturnValue(true)

    mocks.statSync.mockReturnValue({ isFile: () => false, size: 10 })
    expect(getGameIcon('game-1')).toBeNull()

    mocks.statSync.mockReturnValue({ isFile: () => true, size: 0 })
    expect(getGameIcon('game-1')).toBeNull()

    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.alloc(0))
    expect(getGameIcon('game-1')).toBeNull()

    mocks.readFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(getGameIcon('game-1')).toBeNull()
  })

  it('deleteCachedIcon apaga candidatos e não lança', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.rmSync.mockImplementationOnce(() => {
      throw new Error('EBUSY')
    })
    expect(() => deleteCachedIcon(game())).not.toThrow()
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'game-1.png'), { force: true })
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('repairGameIconsIfNeeded', () => {
  it('não faz nada quando a versão do pipeline já é a atual', async () => {
    mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.getStoredGames).not.toHaveBeenCalled()
  })

  it('lista vazia marca a versão e devolve 0', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([])
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.setGameIconsVersion).toHaveBeenCalledWith(GAME_ICON_PIPELINE_VERSION)
  })

  it('sem referência do ícone genérico adia o reparo', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.getFileIcon.mockResolvedValue(image({ empty: true }))
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.setGameIconsVersion).not.toHaveBeenCalled()
  })

  it('re-extrai ícones da Steam existentes', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([
      game({
        origin: 'steam',
        steamAppId: 42,
        exePath: 'C:\\Steam\\steamapps\\common\\Jogo\\jogo.exe'
      })
    ])
    mocks.existsSync.mockImplementation(
      (path: string) =>
        path === join(ICONS, 'steam_42.png') ||
        path === 'C:\\Steam\\steamapps\\common\\Jogo\\jogo.exe'
    )
    mocks.readExeIconIco.mockReturnValue(Buffer.from('ico'))

    const repaired = await repairGameIconsIfNeeded()
    expect(repaired).toBe(1)
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      join(ICONS, 'steam_42.png'),
      expect.any(Buffer)
    )
    expect(mocks.setGameIconsVersion).toHaveBeenCalledWith(GAME_ICON_PIPELINE_VERSION)
  })

  it('Steam com arquivo/alvo ausente é pulada', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([
      game({ origin: 'steam', steamAppId: 42, exePath: 'C:\\Jogos\\jogo.exe' })
    ])
    mocks.existsSync.mockReturnValue(false)
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
  })

  it('custom só é regravado quando o ícone atual é o genérico', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.readExeIconIco.mockReturnValue(Buffer.from('ico'))
    mocks.existsSync.mockImplementation(
      (path: string) => path === join(ICONS, 'game-1.png') || path === 'C:\\Jogos\\jogo.exe'
    )
    // Bitmap igual ao genérico → regrava.
    mocks.createFromPath.mockReturnValue(image({ bitmap: Buffer.alloc(4, 1) }))
    mocks.getFileIcon.mockResolvedValue(image({ bitmap: Buffer.alloc(4, 1) }))

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)

    // Bitmap diferente → preserva o ícone do usuário.
    mocks.writeFileSync.mockClear()
    mocks.setGameIconsVersion.mockClear()
    mocks.createFromPath.mockReturnValue(image({ bitmap: Buffer.from([200, 200, 200, 200]) }))
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.writeFileSync).not.toHaveBeenCalledWith(
      join(ICONS, 'game-1.png'),
      expect.anything()
    )
  })

  it('erro global é logado e devolve 0', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockImplementation(() => {
      throw new Error('store quebrado')
    })
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('refreshGameIcons / reloadGameIcons', () => {
  it('delega a atualização em massa e loga o resultado', async () => {
    mocks.refreshAllGameIcons.mockResolvedValue({ checked: 2, refreshed: 1, failed: 1 })
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.setStoredGames.mockReturnValue({ success: true })

    await expect(refreshGameIcons()).resolves.toEqual({ checked: 2, refreshed: 1, failed: 1 })
    const deps = mocks.refreshAllGameIcons.mock.calls[0][0]
    expect(deps.games()).toHaveLength(1)
    expect(deps.targetOf(game())).toBe(join(ICONS, 'game-1.png'))
    expect(deps.persist([game()])).toBe(true)
    expect(mocks.logInfo).toHaveBeenCalled()
  })

  it('erro na atualização em massa devolve contagem zerada', async () => {
    mocks.refreshAllGameIcons.mockRejectedValue(new Error('falhou'))
    await expect(refreshGameIcons()).resolves.toEqual({ checked: 0, refreshed: 0, failed: 0 })
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('reload delega a recarga de ícones ausentes', async () => {
    mocks.reloadMissingGameIcons.mockResolvedValue({ checked: 2, reloaded: 2, failed: 0 })
    mocks.getStoredGames.mockReturnValue([game()])

    await expect(reloadGameIcons()).resolves.toEqual({ checked: 2, reloaded: 2, failed: 0 })
    expect(mocks.logInfo).toHaveBeenCalled()

    mocks.reloadMissingGameIcons.mockRejectedValue(new Error('falhou'))
    await expect(reloadGameIcons()).resolves.toEqual({ checked: 0, reloaded: 0, failed: 0 })
  })
})
