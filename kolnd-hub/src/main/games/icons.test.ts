import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAbsolute, join, relative, resolve } from 'node:path'

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
  putIcon: vi.fn(),
  readIcon: vi.fn(),
  hasIcon: vi.fn(),
  materialize: vi.fn(),
  removeIfUnreferenced: vi.fn(),
  buildGeneratedIcon: vi.fn(),
  fetchOnlineArtForGame: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userData,
    getVersion: () => '1.2.1',
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
vi.mock('./iconVault', () => ({
  iconVaultDir: () => 'C:\\ud\\icon-vault',
  putIcon: mocks.putIcon,
  readIcon: mocks.readIcon,
  hasIcon: mocks.hasIcon,
  materialize: mocks.materialize,
  removeIfUnreferenced: mocks.removeIfUnreferenced
}))
vi.mock('./iconGenerated', () => ({
  buildGeneratedIcon: mocks.buildGeneratedIcon
}))
vi.mock('./iconOnline', () => ({
  fetchOnlineArtForGame: mocks.fetchOnlineArtForGame
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
  iconCandidates,
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
  mocks.readIcon.mockReturnValue(null)
  mocks.hasIcon.mockReturnValue(false)
  mocks.materialize.mockReturnValue(true)
  mocks.removeIfUnreferenced.mockReturnValue(false)
  mocks.putIcon.mockImplementation((_buffer: Buffer, ext: string) => ({
    sha: 'a'.repeat(64),
    ext,
    path: `C:\\ud\\icon-vault\\${'a'.repeat(64)}${ext}`
  }))
  mocks.fetchOnlineArtForGame.mockResolvedValue(null)
  mocks.buildGeneratedIcon.mockImplementation((game: { id: string }) => ({
    buffer: Buffer.from(`<svg>${game.id}</svg>`),
    ext: '.svg',
    mime: 'image/svg+xml'
  }))
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
  const steamGame = { id: 'steam-42-abc', origin: 'steam' as const, steamAppId: 42 }

  it('apaga imagens do jogo e preserva o caminho recém-gravado', () => {
    const keep = join(ICONS, 'steam-42-abc.png')
    mocks.existsSync.mockReturnValue(true)
    mocks.readdirSync.mockReturnValue([
      'steam-42-abc.png',
      'steam-42-abc.jpg',
      'steam-42-abc.webp',
      'game-2.png',
      'steam-42-abc.txt'
    ])

    deleteStaleIcons(steamGame, keep)
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'steam-42-abc.jpg'), { force: true })
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'steam-42-abc.webp'), { force: true })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(keep, { force: true })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(join(ICONS, 'game-2.png'), { force: true })
  })

  it('cobre os nomes legados do jogo (e só dele)', () => {
    mocks.readdirSync.mockReturnValue([
      'steam_42.png',
      'epic_abc.png',
      'custom_def.png',
      'minecraft_launcher.png',
      'outro_42.png'
    ])

    deleteStaleIcons(steamGame, null)
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'steam_42.png'), { force: true })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(join(ICONS, 'epic_abc.png'), { force: true })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(join(ICONS, 'custom_def.png'), { force: true })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(join(ICONS, 'minecraft_launcher.png'), {
      force: true
    })
    expect(mocks.rmSync).not.toHaveBeenCalledWith(join(ICONS, 'outro_42.png'), { force: true })

    mocks.rmSync.mockClear()
    deleteStaleIcons({ id: 'minecraft-launcher', origin: 'minecraft' }, null)
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'minecraft_launcher.png'), {
      force: true
    })
  })

  it('pasta ausente ou falha ao apagar não lança', () => {
    mocks.readdirSync.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    expect(() => deleteStaleIcons(steamGame, null)).not.toThrow()

    mocks.readdirSync.mockReturnValueOnce(['steam-42-abc.png'])
    mocks.rmSync.mockImplementationOnce(() => {
      throw new Error('EPERM')
    })
    expect(() => deleteStaleIcons(steamGame, null)).not.toThrow()
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('iconCandidates', () => {
  it('ordem: iconPath → canônico (iconExt primeiro) → legado', () => {
    const iconPath = join(ICONS, 'manual.jpg')
    const entry = {
      ...game(),
      iconPath,
      iconExt: '.jpg',
      origin: 'steam' as const,
      steamAppId: 42
    }
    const candidates = iconCandidates(entry)

    expect(candidates[0]).toBe(iconPath)
    expect(candidates[1]).toBe(join(ICONS, 'game-1.jpg'))
    expect(candidates[2]).toBe(join(ICONS, 'game-1.png'))
    expect(candidates).toContain(join(ICONS, 'game-1.jpeg'))
    expect(candidates).toContain(join(ICONS, 'game-1.webp'))
    expect(candidates.at(-1)).toBe(join(ICONS, 'steam_42.png'))
  })

  it('legado de cada origem usa o nome dos scanners', () => {
    expect(
      iconCandidates({ ...game(), id: 'epic-abc123', origin: 'epic' }).map((path) =>
        path.slice(ICONS.length + 1)
      )
    ).toContain('epic_abc123.png')
    expect(
      iconCandidates({ ...game(), id: 'custom-abc123', origin: 'custom' }).map((path) =>
        path.slice(ICONS.length + 1)
      )
    ).toContain('custom_abc123.png')
    expect(
      iconCandidates({ ...game(), id: 'minecraft-launcher', origin: 'minecraft' }).map((path) =>
        path.slice(ICONS.length + 1)
      )
    ).toContain('minecraft_launcher.png')
  })

  it('id malicioso nunca escapa de game-icons', () => {
    const dir = resolve(ICONS)
    for (const entry of [
      { ...game(), id: '..\\..\\x', origin: 'custom' as const },
      { ...game(), id: 'custom-..\\..\\x', origin: 'custom' as const },
      { ...game(), id: 'epic-/../../x', origin: 'epic' as const },
      { ...game(), id: 'a:b', origin: 'steam' as const, steamAppId: 1 }
    ]) {
      for (const candidate of iconCandidates(entry)) {
        const rel = relative(dir, resolve(candidate))
        expect(rel).not.toBe('')
        expect(rel.startsWith('..')).toBe(false)
        expect(isAbsolute(rel)).toBe(false)
      }
    }
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
    expect(mocks.putIcon).toHaveBeenCalledWith(Buffer.from('img'), '.png')
    expect(mocks.materialize).toHaveBeenCalledWith(
      'a'.repeat(64),
      '.png',
      join(ICONS, 'game-1.png')
    )
    const saved = mocks.setStoredGames.mock.calls.at(-1)?.[0] as StoredGame[]
    expect(saved[0]).toMatchObject({
      iconSha: 'a'.repeat(64),
      iconExt: '.png',
      iconOrigin: 'manual'
    })

    const JPG = `data:image/jpeg;base64,${Buffer.from('img').toString('base64')}`
    expect(setGameIcon('game-1', JPG)).toMatchObject({ iconPath: join(ICONS, 'game-1.jpg') })
    expect(mocks.materialize).toHaveBeenCalledWith(
      'a'.repeat(64),
      '.jpg',
      join(ICONS, 'game-1.jpg')
    )
    const WEBP = `data:image/webp;base64,${Buffer.from('img').toString('base64')}`
    expect(setGameIcon('game-1', WEBP)).toMatchObject({ iconPath: join(ICONS, 'game-1.webp') })
  })

  it('falha ao gravar no cofre/materializar vira erro', () => {
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.putIcon.mockReturnValueOnce(null)
    expect(setGameIcon('game-1', PNG)).toEqual({
      success: false,
      error: 'Não foi possível gravar a imagem na pasta de ícones.'
    })

    mocks.materialize.mockReturnValueOnce(false)
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
    expect(mocks.putIcon).toHaveBeenCalledWith(Buffer.from('png'), '.png')
    expect(mocks.materialize).toHaveBeenCalledWith(
      'a'.repeat(64),
      '.png',
      join(ICONS, 'game-1.png')
    )
    const saved = mocks.setStoredGames.mock.calls.at(-1)?.[0] as StoredGame[]
    expect(saved[0]).toMatchObject({ iconOrigin: 'derived', iconExt: '.png' })
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

  it('arquivo inválido seguido de válido continua a busca', () => {
    const broken = join(ICONS, 'broken.png')
    const canonical = join(ICONS, 'game-1.png')
    mocks.getStoredGames.mockReturnValue([game({ iconPath: broken })])
    mocks.existsSync.mockImplementation((path: string) => path === broken || path === canonical)
    mocks.statSync
      .mockReturnValueOnce({ isFile: () => true, size: 0 })
      .mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.from('ok'))

    expect(getGameIcon('game-1')).toBe('data:image/png;base64,b2s=')
    expect(mocks.readFileSync).toHaveBeenCalledWith(canonical)
  })

  it('rematerializa do cofre quando nenhum arquivo local existe', () => {
    const sha = 'a'.repeat(64)
    mocks.getStoredGames.mockReturnValue([game({ iconSha: sha, iconExt: '.jpg' })])
    mocks.existsSync.mockReturnValue(false)
    mocks.readIcon.mockReturnValue(Buffer.from('vault'))
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 5 })
    mocks.readFileSync.mockReturnValue(Buffer.from('vault'))

    expect(getGameIcon('game-1')).toBe('data:image/jpeg;base64,dmF1bHQ=')
    expect(mocks.materialize).toHaveBeenCalledWith(sha, '.jpg', join(ICONS, 'game-1.jpg'))
    expect(mocks.readFileSync).toHaveBeenCalledWith(join(ICONS, 'game-1.jpg'))
  })

  it('deleteCachedIcon apaga candidatos, faz GC do cofre e não lança', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.rmSync.mockImplementationOnce(() => {
      throw new Error('EBUSY')
    })
    expect(() => deleteCachedIcon(game())).not.toThrow()
    expect(mocks.rmSync).toHaveBeenCalledWith(join(ICONS, 'game-1.png'), { force: true })
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('repairGameIconsIfNeeded (semeadura sempre ativa)', () => {
  it('com versão atual e lista vazia não grava nada', async () => {
    mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
    mocks.getStoredGames.mockReturnValue([])
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.setStoredGames).not.toHaveBeenCalled()
    expect(mocks.setGameIconsVersion).not.toHaveBeenCalled()
  })

  it('com versão atual ainda semeia jogo novo sem iconSha', async () => {
    mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.existsSync.mockImplementation((path: string) => path === join(ICONS, 'game-1.png'))
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.from('novo'))

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    expect(mocks.putIcon).toHaveBeenCalledWith(Buffer.from('novo'), '.png')
    expect(mocks.setGameIconsVersion).not.toHaveBeenCalled()
  })

  it('lista vazia com versão antiga marca a versão e devolve 0', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([])
    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.setGameIconsVersion).toHaveBeenCalledWith(GAME_ICON_PIPELINE_VERSION)
  })

  it('semeia o cofre e infere manual na dúvida', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.existsSync.mockImplementation((path: string) => path === join(ICONS, 'game-1.png'))
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.from('icon'))

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    expect(mocks.putIcon).toHaveBeenCalledWith(Buffer.from('icon'), '.png')
    const saved = mocks.setStoredGames.mock.calls[0][0] as StoredGame[]
    expect(saved[0]).toMatchObject({
      iconSha: 'a'.repeat(64),
      iconExt: '.png',
      iconOrigin: 'manual'
    })
    expect(mocks.setGameIconsVersion).toHaveBeenCalledWith(GAME_ICON_PIPELINE_VERSION)
  })

  it('ícone em nome legado vira origin derived', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([
      game({
        id: 'steam-42-abc',
        origin: 'steam',
        steamAppId: 42,
        exePath: 'C:\\Steam\\steamapps\\common\\Jogo\\jogo.exe'
      })
    ])
    mocks.existsSync.mockImplementation((path: string) => path === join(ICONS, 'steam_42.png'))
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.from('steam-icon'))

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    const saved = mocks.setStoredGames.mock.calls[0][0] as StoredGame[]
    expect(saved[0].iconOrigin).toBe('derived')
  })

  it('jogo que já tem iconSha não é tocado (idempotente)', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([
      game({ iconSha: 'b'.repeat(64), iconExt: '.png', iconOrigin: 'manual' })
    ])
    mocks.existsSync.mockReturnValue(true)

    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.putIcon).not.toHaveBeenCalled()
    expect(mocks.setStoredGames).not.toHaveBeenCalled()
    expect(mocks.setGameIconsVersion).toHaveBeenCalledWith(GAME_ICON_PIPELINE_VERSION)
  })

  it('sem nenhuma fonte grava o SVG gerado (garantia final)', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.existsSync.mockReturnValue(false)

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    expect(mocks.buildGeneratedIcon).toHaveBeenCalledTimes(1)
    expect(mocks.putIcon).toHaveBeenCalledWith(Buffer.from('<svg>game-1</svg>'), '.svg')
    const saved = mocks.setStoredGames.mock.calls[0][0] as StoredGame[]
    expect(saved[0]).toMatchObject({
      iconExt: '.svg',
      iconOrigin: 'generated'
    })
    expect(mocks.setGameIconsVersion).toHaveBeenCalledWith(GAME_ICON_PIPELINE_VERSION)
  })

  it('usa a fonte online antes de gerar o fallback', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([game({ name: 'Bodycam' })])
    mocks.existsSync.mockReturnValue(false)
    mocks.fetchOnlineArtForGame.mockResolvedValue({
      buffer: Buffer.from('online-art'),
      ext: '.jpg',
      source: 'steam-search',
      url: 'https://cdn.cloudflare.steamstatic.com/x.jpg'
    })

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    expect(mocks.fetchOnlineArtForGame).toHaveBeenCalledTimes(1)
    expect(mocks.buildGeneratedIcon).not.toHaveBeenCalled()
    const saved = mocks.setStoredGames.mock.calls[0][0] as StoredGame[]
    expect(saved[0]).toMatchObject({ iconExt: '.jpg', iconOrigin: 'online' })
  })

  it('re-tenta um ícone generated na execução seguinte e promove para online', async () => {
    mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
    mocks.setStoredGames.mockImplementation((games: StoredGame[]) => {
      mocks.getStoredGames.mockReturnValue(games)
      return { success: true }
    })
    mocks.getStoredGames.mockReturnValue([game({ name: 'Bodycam' })])
    mocks.existsSync.mockReturnValue(false)

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    expect(mocks.getStoredGames().at(0)?.iconOrigin).toBe('generated')

    mocks.fetchOnlineArtForGame.mockResolvedValue({
      buffer: Buffer.from('art-real'),
      ext: '.png',
      source: 'steam-cdn',
      url: 'https://cdn.cloudflare.steamstatic.com/x.png'
    })
    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    expect(mocks.fetchOnlineArtForGame).toHaveBeenCalled()
    expect(mocks.getStoredGames().at(0)).toMatchObject({
      iconExt: '.png',
      iconOrigin: 'online'
    })
  })

  it('não adquire nem gera para ícone manual legível', async () => {
    mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
    mocks.getStoredGames.mockReturnValue([
      game({
        iconPath: join(ICONS, 'game-1.png'),
        iconSha: 'b'.repeat(64),
        iconExt: '.png',
        iconOrigin: 'manual'
      })
    ])
    mocks.existsSync.mockReturnValue(true)
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.from('manual'))

    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.fetchOnlineArtForGame).not.toHaveBeenCalled()
    expect(mocks.buildGeneratedIcon).not.toHaveBeenCalled()
    expect(mocks.setStoredGames).not.toHaveBeenCalled()
  })

  it('manual perdido (sem arquivo/blob) é regenerado', async () => {
    mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
    mocks.setStoredGames.mockImplementation((games: StoredGame[]) => {
      mocks.getStoredGames.mockReturnValue(games)
      return { success: true }
    })
    mocks.getStoredGames.mockReturnValue([
      game({ iconOrigin: 'manual', iconSha: 'b'.repeat(64), iconExt: '.png' })
    ])
    mocks.existsSync.mockReturnValue(false)
    mocks.readIcon.mockReturnValue(null)
    // materialize não deve "criar" o blob quando o cofre está vazio — as duas
    // leituras de getGameIcon (filtro + guarda do acquire) enxergam null.
    mocks.materialize.mockReturnValueOnce(false).mockReturnValueOnce(false)

    await expect(repairGameIconsIfNeeded()).resolves.toBe(1)
    expect(mocks.buildGeneratedIcon).toHaveBeenCalledTimes(1)
    expect(mocks.getStoredGames().at(0)).toMatchObject({
      iconExt: '.svg',
      iconOrigin: 'generated'
    })
  })

  it('não adquire um ícone válido já existente', async () => {
    mocks.getGameIconsVersion.mockReturnValue(GAME_ICON_PIPELINE_VERSION)
    mocks.getStoredGames.mockReturnValue([
      game({ iconSha: 'b'.repeat(64), iconExt: '.png', iconOrigin: 'derived' })
    ])
    mocks.existsSync.mockReturnValue(false)
    // Vault responde para o getGameIcon rematerializar.
    mocks.readIcon.mockReturnValue(Buffer.from('ok'))
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 2 })
    mocks.readFileSync.mockReturnValue(Buffer.from('ok'))

    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.fetchOnlineArtForGame).not.toHaveBeenCalled()
    expect(mocks.buildGeneratedIcon).not.toHaveBeenCalled()
    expect(mocks.setStoredGames).not.toHaveBeenCalled()
  })

  it('falha ao salvar o store adia a versão', async () => {
    mocks.getGameIconsVersion.mockReturnValue(0)
    mocks.getStoredGames.mockReturnValue([game()])
    mocks.existsSync.mockImplementation((path: string) => path === join(ICONS, 'game-1.png'))
    mocks.statSync.mockReturnValue({ isFile: () => true, size: 10 })
    mocks.readFileSync.mockReturnValue(Buffer.from('icon'))
    mocks.setStoredGames.mockReturnValueOnce({ success: false })

    await expect(repairGameIconsIfNeeded()).resolves.toBe(0)
    expect(mocks.setGameIconsVersion).not.toHaveBeenCalled()
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
    expect(deps.isManual(game({ iconOrigin: 'manual' }))).toBe(true)
    expect(deps.isManual(game({ iconOrigin: 'derived' }))).toBe(false)
    expect(deps.persist([game()])).toBe(true)
    expect(mocks.logInfo).toHaveBeenCalled()
  })

  it('fonte da Steam prefere o binário do jogo ao exe salvo (launcher)', async () => {
    mocks.refreshAllGameIcons.mockResolvedValue({ checked: 1, refreshed: 0, failed: 0 })
    const launcher = 'C:\\Steam\\steamapps\\common\\Jogo\\Launcher.exe'
    const realExe = 'C:\\Steam\\steamapps\\common\\Jogo\\jogo.exe'
    mocks.getStoredGames.mockReturnValue([
      game({ origin: 'steam', steamAppId: 42, exePath: launcher })
    ])
    mocks.steamGameRootFromExe.mockReturnValue('C:\\Steam\\steamapps\\common\\Jogo')
    mocks.findGameExecutable.mockReturnValue(realExe)
    mocks.existsSync.mockReturnValue(true)

    await refreshGameIcons()
    const deps = mocks.refreshAllGameIcons.mock.calls[0][0]
    expect(deps.exeOf(game({ origin: 'steam', steamAppId: 42, exePath: launcher }))).toBe(realExe)
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
