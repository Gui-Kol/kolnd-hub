import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn()
}))
const cpMock = vi.hoisted(() => ({ spawnSync: vi.fn() }))
const gamesMock = vi.hoisted(() => ({
  addGame: vi.fn(),
  extractIconPng: vi.fn(),
  gameIconsDir: vi.fn(() => 'C:\\fake\\icons'),
  getGames: vi.fn()
}))
const exeMock = vi.hoisted(() => ({ findGameExecutable: vi.fn() }))
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  logWarn: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('child_process', () => ({ spawnSync: cpMock.spawnSync }))
vi.mock('fs', () => ({
  existsSync: fsMock.existsSync,
  readdirSync: fsMock.readdirSync,
  readFileSync: fsMock.readFileSync,
  statSync: fsMock.statSync
}))
vi.mock('./games', () => ({
  addGame: gamesMock.addGame,
  extractIconPng: gamesMock.extractIconPng,
  gameIconsDir: gamesMock.gameIconsDir,
  getGames: gamesMock.getGames
}))
vi.mock('./games/exeFinder', () => ({ findGameExecutable: exeMock.findGameExecutable }))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  findSteamLibraries,
  findSteamRoot,
  importSteamGames,
  registerSteamIpc
} from './steamScanner'

const STEAM_ROOT = 'C:\\Steam'
const OTHER_LIB = 'D:\\SteamLibrary'

interface FsState {
  files?: string[]
  dirs?: string[]
  listing?: Record<string, string[] | Error>
  content?: Record<string, string | Error>
}

function setupFs(state: FsState = {}): void {
  const files = new Set(state.files ?? [])
  const dirs = new Set(state.dirs ?? [])
  const listing = state.listing ?? {}
  const content = state.content ?? {}

  fsMock.existsSync.mockImplementation((path: string) => files.has(path) || dirs.has(path))
  fsMock.statSync.mockImplementation((path: string) => {
    if (!files.has(path) && !dirs.has(path)) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    }
    return { isDirectory: () => dirs.has(path) }
  })
  fsMock.readdirSync.mockImplementation((path: string) => {
    const value = listing[path]
    if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    if (value instanceof Error) throw value
    return value
  })
  fsMock.readFileSync.mockImplementation((path: string) => {
    const value = content[path]
    if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    if (value instanceof Error) throw value
    return value
  })
}

function registryOutput(value: string, name = 'SteamPath'): string {
  return `HKEY_CURRENT_USER\\Software\\Valve\\Steam\n    ${name}    REG_SZ    ${value}\n`
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  cpMock.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' })
  gamesMock.getGames.mockReturnValue([])
  gamesMock.extractIconPng.mockResolvedValue(true)
  gamesMock.addGame.mockReturnValue({ success: true })
})

describe('findSteamRoot', () => {
  it('usa o SteamPath do registro, normalizando barras', () => {
    cpMock.spawnSync.mockReturnValue({
      status: 0,
      stdout: registryOutput('c:/program files (x86)/steam'),
      stderr: ''
    })
    setupFs({ dirs: ['c:\\program files (x86)\\steam'] })

    expect(findSteamRoot()).toBe('c:\\program files (x86)\\steam')
  })

  it('cai para HKLM e depois para os caminhos padrão', () => {
    cpMock.spawnSync
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: registryOutput('D:\\Steam', 'InstallPath'),
        stderr: ''
      })
    setupFs({ dirs: ['D:\\Steam'] })
    expect(findSteamRoot()).toBe('D:\\Steam')

    cpMock.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: '' })
    setupFs({ dirs: ['C:\\Program Files\\Steam'] })
    expect(findSteamRoot()).toBe('C:\\Program Files\\Steam')
  })

  it('valor vazio, stat falhando e spawn lançando → null', () => {
    cpMock.spawnSync.mockReturnValue({
      status: 0,
      stdout: '    SteamPath    REG_SZ    \n',
      stderr: ''
    })
    setupFs({})
    expect(findSteamRoot()).toBeNull()

    cpMock.spawnSync.mockImplementation(() => {
      throw new Error('reg não encontrado')
    })
    expect(findSteamRoot()).toBeNull()
  })
})

describe('findSteamLibraries', () => {
  it('une a raiz com as bibliotecas do libraryfolders.vdf e deduplica', () => {
    const vdf = join(STEAM_ROOT, 'steamapps', 'libraryfolders.vdf')
    setupFs({
      files: [vdf],
      dirs: [STEAM_ROOT, OTHER_LIB, join(STEAM_ROOT, 'steamapps'), join(OTHER_LIB, 'steamapps')],
      content: {
        [vdf]: `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}`
      }
    })

    expect(findSteamLibraries(STEAM_ROOT)).toEqual([STEAM_ROOT, OTHER_LIB])
  })

  it('sem vdf devolve só a raiz quando steamapps existe', () => {
    setupFs({ dirs: [STEAM_ROOT, join(STEAM_ROOT, 'steamapps')] })
    expect(findSteamLibraries(STEAM_ROOT)).toEqual([STEAM_ROOT])
  })

  it('vdf ilegível loga warning e segue com a raiz', () => {
    const vdf = join(STEAM_ROOT, 'steamapps', 'libraryfolders.vdf')
    setupFs({
      files: [vdf],
      dirs: [STEAM_ROOT, join(STEAM_ROOT, 'steamapps')],
      content: { [vdf]: new Error('EACCES') }
    })

    expect(findSteamLibraries(STEAM_ROOT)).toEqual([STEAM_ROOT])
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'steam',
      'Não foi possível ler libraryfolders.vdf:',
      expect.any(Error)
    )
  })

  it('biblioteca inacessível ou sem steamapps é descartada', () => {
    const vdf = join(STEAM_ROOT, 'steamapps', 'libraryfolders.vdf')
    setupFs({
      files: [vdf],
      dirs: [STEAM_ROOT, join(STEAM_ROOT, 'steamapps'), 'E:\\SemSteamApps'],
      content: { [vdf]: `"path"\t\t"E:\\\\SemSteamApps"\n"path"\t\t"F:\\\\Inacessivel"\n` }
    })

    expect(findSteamLibraries(STEAM_ROOT)).toEqual([STEAM_ROOT])
  })
})

describe('importSteamGames', () => {
  it('Steam não detectada → relatório com erro', async () => {
    setupFs({})
    const report = await importSteamGames()
    expect(report).toMatchObject({
      ok: false,
      imported: 0,
      error: 'Steam não detectada. Verifique se ela está instalada.'
    })
  })

  it('importa jogos válidos e contabiliza ferramentas, duplicados, sem exe e erros', async () => {
    const steamapps = join(STEAM_ROOT, 'steamapps')
    const vdf = join(steamapps, 'libraryfolders.vdf')
    const common = join(steamapps, 'common')
    const rootExe = join(common, 'Jogo Bom', 'jogo.exe')
    const iconlessExe = join(common, 'Sem Icone', 'sem-icone.exe')
    cpMock.spawnSync.mockReturnValue({
      status: 0,
      stdout: registryOutput(STEAM_ROOT),
      stderr: ''
    })
    const manifest = (name: string, id: number, dir: string): string =>
      `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n\t"installdir"\t\t"${dir}"\n}\n`

    const files = [
      vdf,
      join(steamapps, 'appmanifest_1.acf'),
      join(steamapps, 'appmanifest_2.acf'),
      join(steamapps, 'appmanifest_3.acf'),
      join(steamapps, 'appmanifest_4.acf'),
      join(steamapps, 'appmanifest_5.acf'),
      join(steamapps, 'appmanifest_6.acf'),
      join(steamapps, 'appmanifest_7.acf'),
      join(steamapps, 'appmanifest_9.acf'),
      join(steamapps, 'appmanifest_999.acf'),
      rootExe,
      iconlessExe
    ]
    setupFs({
      files,
      dirs: [STEAM_ROOT, steamapps, common],
      listing: {
        [steamapps]: [
          'appmanifest_1.acf',
          'appmanifest_2.acf',
          'appmanifest_3.acf',
          'appmanifest_4.acf',
          'appmanifest_5.acf',
          'appmanifest_6.acf',
          'appmanifest_7.acf',
          'appmanifest_9.acf',
          'appmanifest_999.acf',
          'notas.txt'
        ]
      },
      content: {
        [vdf]: '"libraryfolders"\n}\n',
        [join(steamapps, 'appmanifest_1.acf')]: manifest('Proton 9.0', 100, 'Proton'),
        [join(steamapps, 'appmanifest_2.acf')]: manifest('Runtime', 228980, 'Runtime'),
        [join(steamapps, 'appmanifest_3.acf')]: manifest('Já Tenho', 300, 'Ja'),
        [join(steamapps, 'appmanifest_4.acf')]: manifest('Sem Executável', 400, 'Nada'),
        [join(steamapps, 'appmanifest_5.acf')]: manifest('Jogo Bom', 500, 'Jogo Bom'),
        [join(steamapps, 'appmanifest_6.acf')]: manifest('Sem Icone', 600, 'Sem Icone'),
        [join(steamapps, 'appmanifest_7.acf')]: manifest('Duplicado', 700, 'Dup'),
        [join(steamapps, 'appmanifest_9.acf')]: manifest('Falha Estranha', 900, 'Falha'),
        [join(steamapps, 'appmanifest_999.acf')]: new Error('EACCES')
      }
    })

    gamesMock.getGames.mockReturnValue([{ id: 'old', steamAppId: 300 }])
    exeMock.findGameExecutable.mockImplementation((dir: string) => {
      if (dir === join(common, 'Jogo Bom')) return rootExe
      if (dir === join(common, 'Sem Icone')) return iconlessExe
      if (dir === join(common, 'Dup') || dir === join(common, 'Falha')) return join(dir, 'game.exe')
      return null
    })
    gamesMock.extractIconPng.mockImplementation(async (_exe: string, icon: string) =>
      icon.includes('500')
    )
    gamesMock.addGame.mockImplementation((game: { steamAppId: number }) => {
      if (game.steamAppId === 700) return { success: false, error: 'Já existe um jogo igual.' }
      if (game.steamAppId === 900) return { success: false, error: 'disco cheio' }
      return { success: true }
    })

    const report = await importSteamGames()
    expect(report.ok).toBe(true)
    expect(report.imported).toBe(2)
    expect(report.alreadyInLibrary).toBe(2) // 300 (steamAppId) + 700 (addGame "Já existe")
    expect(report.ignoredTools).toBe(2) // Proton (nome) + 228980 (id conhecido)
    expect(report.noExe).toBe(1)
    expect(report.errors).toEqual(['Falha Estranha: disco cheio'])

    expect(gamesMock.addGame).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^steam-500-[0-9a-f]{10}$/),
        origin: 'steam',
        steamAppId: 500,
        iconPath: join('C:\\fake\\icons', 'steam_500.png')
      })
    )
    expect(gamesMock.addGame).toHaveBeenCalledWith(
      expect.objectContaining({ steamAppId: 600, iconPath: null })
    )
  })

  it('manifesto duplicado entre bibliotecas conta uma vez e readdir com erro é ignorado', async () => {
    const steamapps = join(STEAM_ROOT, 'steamapps')
    const otherSteamapps = join(OTHER_LIB, 'steamapps')
    const vdf = join(steamapps, 'libraryfolders.vdf')
    const manifest = `"appid"\t\t"42"\n"name"\t\t"Jogo"\n"installdir"\t\t"Jogo"\n`
    cpMock.spawnSync.mockReturnValue({
      status: 0,
      stdout: registryOutput(STEAM_ROOT),
      stderr: ''
    })

    setupFs({
      files: [
        vdf,
        join(steamapps, 'appmanifest_42.acf'),
        join(otherSteamapps, 'appmanifest_42.acf')
      ],
      dirs: [STEAM_ROOT, steamapps, OTHER_LIB, otherSteamapps, join(steamapps, 'common')],
      listing: {
        [steamapps]: ['appmanifest_42.acf'],
        [otherSteamapps]: new Error('EACCES')
      },
      content: {
        [vdf]: `"path"\t\t"D:\\\\SteamLibrary"\n`,
        [join(steamapps, 'appmanifest_42.acf')]: manifest
      }
    })
    exeMock.findGameExecutable.mockReturnValue(join(steamapps, 'common', 'Jogo', 'jogo.exe'))

    const report = await importSteamGames()
    expect(report.imported).toBe(1)
    expect(gamesMock.addGame).toHaveBeenCalledTimes(1)
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'steam',
      `Sem acesso a ${otherSteamapps}:`,
      expect.any(Error)
    )
  })
})

describe('registerSteamIpc', () => {
  it('registra steam:import e devolve o relatório', async () => {
    registerSteamIpc()
    setupFs({})
    const handler = mocks.handlers.get('steam:import')
    expect(handler).toBeDefined()
    await expect(handler?.({})).resolves.toMatchObject({ ok: false })
  })
})
