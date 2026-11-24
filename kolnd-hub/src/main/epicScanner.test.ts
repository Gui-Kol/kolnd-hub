import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'
import { exePathHash } from './games/naming'

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn()
}))
const gamesMock = vi.hoisted(() => ({
  addGame: vi.fn(),
  extractIconPng: vi.fn(),
  gameIconsDir: vi.fn(() => 'C:\\fake\\icons'),
  getGames: vi.fn()
}))
const exeMock = vi.hoisted(() => ({ findGameExecutable: vi.fn() }))
const mocks = vi.hoisted(() => ({ logWarn: vi.fn() }))

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

import { epicManifestsDir, parseEpicManifest, scanEpicGames } from './epicScanner'

const PROGRAM_DATA = 'C:\\ProgramData'
const MANIFESTS_DIR = join(PROGRAM_DATA, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')

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

/** Manifesto Epic válido; `overrides` cobre os casos de descarte. */
function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    DisplayName: 'Rocket League',
    InstallLocation: 'D:\\Epic\\RocketLeague',
    LaunchExecutable: 'Binaries\\Win64\\Launcher.exe',
    bIsIncompleteInstall: false,
    MainGameAppName: '',
    AppCategories: ['games'],
    ...overrides
  })
}

/** Prepara o manifesto na pasta padrão com o conteúdo informado. */
function addManifest(entry: string, content: string | Error): void {
  setupFs({
    files: [join(MANIFESTS_DIR, entry)],
    dirs: [MANIFESTS_DIR],
    listing: { [MANIFESTS_DIR]: [entry] },
    content: { [join(MANIFESTS_DIR, entry)]: content }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ProgramData = PROGRAM_DATA
  gamesMock.getGames.mockReturnValue([])
  gamesMock.extractIconPng.mockResolvedValue(true)
  gamesMock.addGame.mockReturnValue({ success: true })
})

describe('parseEpicManifest', () => {
  it('aceita jogo válido e normaliza LaunchExecutable ausente para null', () => {
    expect(parseEpicManifest(manifest())).toEqual({
      displayName: 'Rocket League',
      installLocation: 'D:\\Epic\\RocketLeague',
      launchExecutable: 'Binaries\\Win64\\Launcher.exe'
    })

    const withoutExe = parseEpicManifest(
      manifest({ LaunchExecutable: '', AppCategories: undefined })
    )
    expect(withoutExe).toMatchObject({ launchExecutable: null })
  })

  it('descarta JSON inválido, instalação incompleta, DLC e campos vazios', () => {
    expect(parseEpicManifest('{')).toBeNull()
    expect(parseEpicManifest('null')).toBeNull()
    expect(parseEpicManifest('[]')).toBeNull()
    expect(parseEpicManifest(manifest({ bIsIncompleteInstall: true }))).toBeNull()
    expect(parseEpicManifest(manifest({ MainGameAppName: 'RocketLeagueDLC' }))).toBeNull()
    expect(parseEpicManifest(manifest({ DisplayName: '  ' }))).toBeNull()
    expect(parseEpicManifest(manifest({ InstallLocation: '' }))).toBeNull()
  })

  it('descarta categoria não-jogo e lista de categorias malformada', () => {
    expect(parseEpicManifest(manifest({ AppCategories: ['plugins', 'mods'] }))).toBeNull()
    expect(parseEpicManifest(manifest({ AppCategories: ['games', 42] }))).toBeNull()
  })
})

describe('epicManifestsDir', () => {
  it('monta o caminho padrão a partir de %ProgramData%', () => {
    expect(epicManifestsDir(PROGRAM_DATA)).toBe(MANIFESTS_DIR)
    expect(epicManifestsDir(undefined)).toBe(MANIFESTS_DIR)
  })
})

describe('scanEpicGames', () => {
  it('pasta de manifestos ausente → detected false e mensagem amigável', async () => {
    setupFs({})
    const report = await scanEpicGames()
    expect(report).toMatchObject({
      source: 'epic',
      label: 'Epic Games',
      detected: false,
      imported: 0,
      message: 'Epic Games não detectado neste PC.'
    })
    expect(report.errors).toEqual([])
  })

  it('importa jogo válido pelo LaunchExecutable e ignora os descartáveis', async () => {
    const entries = [
      'rocket.item',
      'incomplete.item',
      'dlc.item',
      'tool.item',
      'broken.item',
      'noexe.item'
    ]
    const exe = 'D:\\Epic\\RocketLeague\\Binaries\\Win64\\Launcher.exe'
    setupFs({
      files: [exe, ...entries.map((entry) => join(MANIFESTS_DIR, entry))],
      dirs: [MANIFESTS_DIR],
      listing: { [MANIFESTS_DIR]: [...entries, 'nota.txt'] },
      content: {
        [join(MANIFESTS_DIR, 'rocket.item')]: manifest(),
        [join(MANIFESTS_DIR, 'incomplete.item')]: manifest({
          DisplayName: 'Incompleto',
          bIsIncompleteInstall: true
        }),
        [join(MANIFESTS_DIR, 'dlc.item')]: manifest({
          DisplayName: 'DLC',
          MainGameAppName: 'RocketLeagueDLC'
        }),
        [join(MANIFESTS_DIR, 'tool.item')]: manifest({
          DisplayName: 'Ferramenta',
          AppCategories: ['plugins']
        }),
        [join(MANIFESTS_DIR, 'broken.item')]: '{',
        [join(MANIFESTS_DIR, 'noexe.item')]: manifest({
          DisplayName: 'Sem Exe',
          InstallLocation: 'D:\\Epic\\SemExe',
          LaunchExecutable: ''
        })
      }
    })
    exeMock.findGameExecutable.mockReturnValue(null)

    const report = await scanEpicGames()
    expect(report.detected).toBe(true)
    expect(report.imported).toBe(1)
    expect(report.ignored).toBe(4)
    expect(report.noExe).toBe(1)
    expect(report.errors).toEqual([])
    expect(gamesMock.addGame).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `epic-${exePathHash(exe)}`,
        name: 'Rocket League',
        exePath: exe,
        origin: 'epic',
        iconPath: join('C:\\fake\\icons', `epic_${exePathHash(exe)}.png`)
      })
    )
  })

  it('cai para findGameExecutable quando o LaunchExecutable não existe', async () => {
    const install = 'D:\\Epic\\Fallback'
    const exe = join(install, 'FallbackGame.exe')
    addManifest('fallback.item', manifest({ DisplayName: 'Fallback', InstallLocation: install }))
    exeMock.findGameExecutable.mockReturnValue(exe)

    const report = await scanEpicGames()
    expect(report.imported).toBe(1)
    expect(exeMock.findGameExecutable).toHaveBeenCalledWith(install)
    expect(gamesMock.addGame).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Fallback', exePath: exe })
    )
  })

  it('conta jogo já presente por id, duplicata no mesmo scan e falha "já existe"', async () => {
    const exeA = 'D:\\Epic\\A\\a.exe'
    const exeB = 'D:\\Epic\\B\\b.exe'
    const exeC = 'D:\\Epic\\C\\c.exe'
    setupFs({
      files: [exeA, exeB, exeC],
      dirs: [MANIFESTS_DIR],
      listing: { [MANIFESTS_DIR]: ['a.item', 'dup.item', 'b.item', 'c.item'] },
      content: {
        [join(MANIFESTS_DIR, 'a.item')]: manifest({
          DisplayName: 'A',
          InstallLocation: 'D:\\Epic\\A',
          LaunchExecutable: 'a.exe'
        }),
        [join(MANIFESTS_DIR, 'dup.item')]: manifest({
          DisplayName: 'Duplicado',
          InstallLocation: 'D:\\Epic\\A',
          LaunchExecutable: 'a.exe'
        }),
        [join(MANIFESTS_DIR, 'b.item')]: manifest({
          DisplayName: 'B',
          InstallLocation: 'D:\\Epic\\B',
          LaunchExecutable: 'b.exe'
        }),
        [join(MANIFESTS_DIR, 'c.item')]: manifest({
          DisplayName: 'C',
          InstallLocation: 'D:\\Epic\\C',
          LaunchExecutable: 'c.exe'
        })
      }
    })
    gamesMock.getGames.mockReturnValue([
      { id: `epic-${exePathHash(exeA)}`, exePath: exeA, origin: 'epic', steamAppId: undefined }
    ])
    gamesMock.addGame.mockImplementation((game: { exePath: string }) =>
      game.exePath === exeB
        ? { success: false, error: 'Este executável já está na sua biblioteca.' }
        : { success: true }
    )

    const report = await scanEpicGames()
    expect(report.imported).toBe(1) // C
    expect(report.alreadyInLibrary).toBe(3) // A (id prévio) + dup (mesmo scan) + B (addGame)
    expect(report.errors).toEqual([])
  })

  it('falha genérica do addGame vai para errors sem abortar os demais', async () => {
    const exe = 'D:\\Epic\\Erro\\erro.exe'
    addManifest(
      'erro.item',
      manifest({
        DisplayName: 'Com Erro',
        InstallLocation: 'D:\\Epic\\Erro',
        LaunchExecutable: 'erro.exe'
      })
    )
    setupFs({
      files: [exe],
      dirs: [MANIFESTS_DIR],
      listing: { [MANIFESTS_DIR]: ['erro.item'] },
      content: {
        [join(MANIFESTS_DIR, 'erro.item')]: manifest({
          DisplayName: 'Com Erro',
          InstallLocation: 'D:\\Epic\\Erro',
          LaunchExecutable: 'erro.exe'
        })
      }
    })
    gamesMock.addGame.mockReturnValue({ success: false, error: 'disco cheio' })

    const report = await scanEpicGames()
    expect(report.errors).toEqual(['Com Erro: disco cheio'])
    expect(report.imported).toBe(0)
  })

  it('falha ao listar a pasta vira erro da fonte (detected continua true)', async () => {
    setupFs({
      dirs: [MANIFESTS_DIR],
      listing: { [MANIFESTS_DIR]: new Error('EACCES') }
    })

    const report = await scanEpicGames()
    expect(report.detected).toBe(true)
    expect(report.errors).toEqual(['Não foi possível ler a pasta de jogos da Epic Games.'])
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'epic',
      `Sem acesso a ${MANIFESTS_DIR}:`,
      expect.any(Error)
    )
  })

  it('manifesto ilegível conta como ignorado e não derruba a varredura', async () => {
    addManifest('ilegivel.item', new Error('EACCES'))

    const report = await scanEpicGames()
    expect(report.ignored).toBe(1)
    expect(report.imported).toBe(0)
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'epic',
      'Falha ao ler ilegivel.item:',
      expect.any(Error)
    )
  })
})
