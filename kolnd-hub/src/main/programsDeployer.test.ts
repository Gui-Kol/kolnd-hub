import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  cpSync: vi.fn(),
  copyFileSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn()
}))

const state = vi.hoisted(() => ({ packaged: false }))
const kloudMock = vi.hoisted(() => ({
  findKloudGamesExe: vi.fn(),
  getKloudGamesDir: vi.fn()
}))
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

// Nada é escrito em disco: o módulo inteiro roda sobre um fs simulado.
vi.mock('fs', () => ({
  existsSync: fsMock.existsSync,
  mkdirSync: fsMock.mkdirSync,
  cpSync: fsMock.cpSync,
  copyFileSync: fsMock.copyFileSync,
  renameSync: fsMock.renameSync,
  readdirSync: fsMock.readdirSync,
  statSync: fsMock.statSync
}))
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged
    },
    getPath: () => 'C:\\fake\\userdata'
  }
}))
vi.mock('./kloudGames', () => ({
  findKloudGamesExe: kloudMock.findKloudGamesExe,
  getKloudGamesDir: kloudMock.getKloudGamesDir
}))
vi.mock('./logger', () => ({ logger: loggerMock }))

import {
  deployPrograms,
  formatDeployReport,
  getMarkLviDataDir,
  seedMarkLviData
} from './programsDeployer'

const PROJECT = 'C:\\projeto'
const PROGRAMS_DIR = join(PROJECT, 'resources', 'programs')
const MARK_SOURCE = join(PROGRAMS_DIR, 'MarkLVI')
const DATA_DIR = join('C:\\fake\\userdata', 'mark-lvi')

/** Controla o fs simulado: quais caminhos existem, tipo e mtime. */
function setupFs(
  options: {
    files?: string[]
    dirs?: string[]
    mtime?: Record<string, number>
  } = {}
): void {
  const files = new Set(options.files ?? [])
  const dirs = new Set(options.dirs ?? [])
  const mtime = options.mtime ?? {}

  fsMock.existsSync.mockImplementation((path: string) => files.has(path) || dirs.has(path))
  fsMock.statSync.mockImplementation((path: string) => {
    const isFile = files.has(path)
    const isDirectory = dirs.has(path)
    if (!isFile && !isDirectory) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    }
    return {
      isFile: () => isFile,
      isDirectory: () => isDirectory,
      mtimeMs: mtime[path] ?? 0
    }
  })
}

beforeAll(() => {
  vi.spyOn(process, 'cwd').mockReturnValue(PROJECT)
  Object.defineProperty(process, 'resourcesPath', {
    value: 'C:\\fake\\resources',
    configurable: true
  })
})

afterAll(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  state.packaged = false
  fsMock.existsSync.mockReset().mockReturnValue(false)
  fsMock.mkdirSync.mockReset()
  fsMock.cpSync.mockReset()
  fsMock.copyFileSync.mockReset()
  fsMock.renameSync.mockReset()
  fsMock.readdirSync.mockReset().mockReturnValue([])
  fsMock.statSync.mockReset()
  kloudMock.findKloudGamesExe.mockReset().mockReturnValue(null)
  kloudMock.getKloudGamesDir.mockReset().mockReturnValue('C:\\fake\\kloud-games')
  loggerMock.info.mockReset()
  loggerMock.warn.mockReset()
  loggerMock.error.mockReset()
})

describe('getMarkLviDataDir', () => {
  it('usa <userData>/mark-lvi', () => {
    expect(getMarkLviDataDir()).toBe(DATA_DIR)
  })
})

describe('seedMarkLviData', () => {
  it('copia config/memory mais novos (temp + rename) e ignora diretórios', () => {
    const configDir = join(MARK_SOURCE, 'config')
    const settings = join(configDir, 'settings.json')
    const certs = join(configDir, 'certs')
    const destConfig = join(DATA_DIR, 'config')
    setupFs({
      files: [settings],
      dirs: [configDir, certs],
      mtime: { [settings]: 200 }
    })
    fsMock.readdirSync.mockImplementation((dir: string) =>
      dir === configDir ? ['settings.json', 'certs'] : []
    )

    seedMarkLviData()

    const dest = join(destConfig, 'settings.json')
    expect(fsMock.copyFileSync).toHaveBeenCalledWith(
      settings,
      join(destConfig, `.settings.json.tmp-${process.pid}`)
    )
    expect(fsMock.renameSync).toHaveBeenCalledWith(
      join(destConfig, `.settings.json.tmp-${process.pid}`),
      dest
    )
    expect(loggerMock.info).toHaveBeenCalledWith(
      'programsDeployer',
      expect.stringContaining('1 arquivo(s) copiado(s)')
    )
  })

  it('não sobrescreve destino com mtime maior ou igual', () => {
    const memoryDir = join(MARK_SOURCE, 'memory')
    const memory = join(memoryDir, 'memory.json')
    const dest = join(DATA_DIR, 'memory', 'memory.json')
    setupFs({
      files: [memory, dest],
      dirs: [memoryDir],
      mtime: { [memory]: 100, [dest]: 100 }
    })
    fsMock.readdirSync.mockReturnValue(['memory.json'])

    seedMarkLviData()
    expect(fsMock.copyFileSync).not.toHaveBeenCalled()
    expect(loggerMock.info).not.toHaveBeenCalled()
  })

  it('copia quando o destino é mais antigo que a fonte', () => {
    const memoryDir = join(MARK_SOURCE, 'memory')
    const memory = join(memoryDir, 'memory.json')
    const dest = join(DATA_DIR, 'memory', 'memory.json')
    setupFs({
      files: [memory, dest],
      dirs: [memoryDir],
      mtime: { [memory]: 200, [dest]: 100 }
    })
    fsMock.readdirSync.mockReturnValue(['memory.json'])

    seedMarkLviData()
    expect(fsMock.copyFileSync).toHaveBeenCalledTimes(1)
  })

  it('ignora pasta ausente, readdir com erro e stat com erro', () => {
    const configDir = join(MARK_SOURCE, 'config')
    const memoryDir = join(MARK_SOURCE, 'memory')
    setupFs({ dirs: [configDir, memoryDir] })
    fsMock.readdirSync.mockImplementation((dir: string) => {
      if (dir === configDir) throw new Error('sem permissão')
      return ['fantasma.txt']
    })

    expect(() => seedMarkLviData()).not.toThrow()
    expect(fsMock.copyFileSync).not.toHaveBeenCalled()
  })

  it('falha de cópia é logada e não interrompe os demais arquivos', () => {
    const configDir = join(MARK_SOURCE, 'config')
    const file = join(configDir, 'a.json')
    setupFs({ files: [file], dirs: [configDir], mtime: { [file]: 10 } })
    fsMock.readdirSync.mockReturnValue(['a.json'])
    fsMock.copyFileSync.mockImplementation(() => {
      throw new Error('disco cheio')
    })

    seedMarkLviData()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'programsDeployer',
      expect.stringContaining('seed do Mark LVI: falha'),
      expect.any(Error)
    )
  })

  it('erro global vira warning e nunca propaga', () => {
    fsMock.existsSync.mockImplementation(() => {
      throw new Error('fs quebrado')
    })
    expect(() => seedMarkLviData()).not.toThrow()
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'programsDeployer',
      'seed do Mark LVI falhou (não bloqueia o app):',
      expect.any(Error)
    )
  })
})

describe('deployPrograms — Mark LVI', () => {
  it('empacotado: exe embutido em resources/programs/MarkLVI já existe', async () => {
    state.packaged = true
    const targetDir = join('C:\\fake\\resources', 'programs', 'MarkLVI')
    setupFs({ files: [join(targetDir, 'MarkLVI.exe')] })

    const [mark] = await deployPrograms()
    expect(mark).toEqual({
      id: 'mark-lvi',
      name: 'Mark LVI (JARVIS)',
      installed: true,
      path: targetDir
    })
  })

  it('empacotado sem o exe: falha explicando que o instalador deve embutir', async () => {
    state.packaged = true
    setupFs({})

    const [mark] = await deployPrograms()
    expect(mark.installed).toBe(false)
    expect(mark.error).toContain('Executável não encontrado')
    expect(mark.error).toContain('resources/programs/MarkLVI')
  })

  it('dev: copia do build local quando o exe alvo não existe', async () => {
    const sourceDir = join(PROJECT, '..', 'Mark-LVI', 'dist', 'MarkLVI')
    const targetDir = join(PROGRAMS_DIR, 'MarkLVI')
    setupFs({ files: [join(sourceDir, 'MarkLVI.exe')] })

    const [mark] = await deployPrograms()
    expect(fsMock.cpSync).toHaveBeenCalledWith(sourceDir, targetDir, { recursive: true })
    expect(mark.installed).toBe(true)
    expect(mark.path).toBe(targetDir)
  })

  it('dev: falha de cópia vira resultado de erro', async () => {
    const sourceDir = join(PROJECT, '..', 'Mark-LVI', 'dist', 'MarkLVI')
    setupFs({ files: [join(sourceDir, 'MarkLVI.exe')] })
    fsMock.cpSync.mockImplementation(() => {
      throw new Error('sem espaço')
    })

    const [mark] = await deployPrograms()
    expect(mark.installed).toBe(false)
    expect(mark.error).toBe('Falha ao copiar Mark LVI: sem espaço')
  })

  it('dev sem build local: falha silenciosa (sem cópia)', async () => {
    setupFs({})
    const [mark] = await deployPrograms()
    expect(fsMock.cpSync).not.toHaveBeenCalled()
    expect(mark.installed).toBe(false)
  })
})

describe('deployPrograms — Kloud Games', () => {
  it('exe encontrado → instalado com caminho', async () => {
    kloudMock.findKloudGamesExe.mockReturnValue('C:\\Program Files\\Kloud Games\\KLOUD_GAMES.exe')
    const [, kloud] = await deployPrograms()
    expect(kloud).toEqual({
      id: 'kloud-games',
      name: 'Kloud Games',
      installed: true,
      path: 'C:\\Program Files\\Kloud Games\\KLOUD_GAMES.exe'
    })
  })

  it('sem exe mas com MSI embutido → erro orientando a primeira execução', async () => {
    const msi = join('C:\\fake\\kloud-games', 'KLOUD_GAMES.msi')
    setupFs({ files: [msi] })

    const [, kloud] = await deployPrograms()
    expect(kloud.installed).toBe(false)
    expect(kloud.error).toContain('MSI do Kloud Games embutido')
    expect(kloud.error).toContain(msi)
  })

  it('sem exe e sem MSI → erro genérico', async () => {
    setupFs({})
    const [, kloud] = await deployPrograms()
    expect(kloud.error).toBe(
      'KLOUD_GAMES.exe não encontrado e MSI do Kloud Games não embutido em resources/programs/kloud-games/.'
    )
  })
})

describe('formatDeployReport', () => {
  it('lista OK/FALHOU com caminho e erro quando presentes', () => {
    const report = formatDeployReport([
      { id: 'a', name: 'Programa A', installed: true, path: 'C:\\A' },
      { id: 'b', name: 'Programa B', installed: false, error: 'faltou' },
      { id: 'c', name: 'Programa C', installed: true }
    ])
    const lines = report.split('\n')
    expect(lines[0]).toBe('=== Implantação de Programas ===')
    expect(lines[1]).toBe('Programa A: OK (C:\\A)')
    expect(lines[2]).toBe('Programa B: FALHOU — faltou')
    expect(lines[3]).toBe('Programa C: OK')
  })
})
