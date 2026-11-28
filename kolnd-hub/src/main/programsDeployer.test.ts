import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  cpSync: vi.fn(),
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

import { deployPrograms, formatDeployReport } from './programsDeployer'

const PROJECT = 'C:\\projeto'
const PROGRAMS_DIR = join(PROJECT, 'resources', 'programs')
const MARK_DIR = join(PROGRAMS_DIR, 'MarkLVII')

/** Controla o fs simulado: quais caminhos existem e seus mtimes. */
function setupFs(
  options: { files?: string[]; dirs?: string[]; mtimes?: Record<string, number> } = {}
): void {
  const files = new Set(options.files ?? [])
  const dirs = new Set(options.dirs ?? [])
  const mtimes = options.mtimes ?? {}

  fsMock.existsSync.mockImplementation((path: string) => files.has(path) || dirs.has(path))
  fsMock.statSync.mockImplementation((path: string) => {
    const mtimeMs = mtimes[path]
    if (mtimeMs === undefined) throw new Error(`ENOENT: ${path}`)
    return { mtimeMs }
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
  fsMock.statSync.mockReset().mockImplementation(() => {
    throw new Error('ENOENT')
  })
  kloudMock.findKloudGamesExe.mockReset().mockReturnValue(null)
  kloudMock.getKloudGamesDir.mockReset().mockReturnValue('C:\\fake\\kloud-games')
  loggerMock.info.mockReset()
  loggerMock.warn.mockReset()
  loggerMock.error.mockReset()
})

describe('deployPrograms — Mark LVII', () => {
  it('empacotado: exe embutido em resources/programs/MarkLVII já existe', async () => {
    state.packaged = true
    const targetDir = join('C:\\fake\\resources', 'programs', 'MarkLVII')
    setupFs({ files: [join(targetDir, 'MarkLVII.exe')] })

    const [mark] = await deployPrograms()
    expect(mark).toEqual({
      id: 'mark-lvi',
      name: 'Mark LVII (JARVIS)',
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
    expect(mark.error).toContain('resources/programs/MarkLVII')
  })

  it('dev: copia do build local quando o exe alvo não existe', async () => {
    const sourceDir = join(PROJECT, '..', 'Mark-LVII', 'dist', 'MarkLVII')
    setupFs({ files: [join(sourceDir, 'MarkLVII.exe')] })

    const [mark] = await deployPrograms()
    expect(fsMock.cpSync).toHaveBeenCalledWith(sourceDir, MARK_DIR, { recursive: true })
    expect(mark.installed).toBe(true)
    expect(mark.path).toBe(MARK_DIR)
  })

  it('dev: falha de cópia vira resultado de erro', async () => {
    const sourceDir = join(PROJECT, '..', 'Mark-LVII', 'dist', 'MarkLVII')
    setupFs({ files: [join(sourceDir, 'MarkLVII.exe')] })
    fsMock.cpSync.mockImplementation(() => {
      throw new Error('sem espaço')
    })

    const [mark] = await deployPrograms()
    expect(mark.installed).toBe(false)
    expect(mark.error).toBe('Falha ao copiar Mark LVII: sem espaço')
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

describe('deployPrograms — Absolem', () => {
  const ABSOLEM_DIR = join(PROGRAMS_DIR, 'Absolem')

  it('empacotado: exe embutido em resources/programs/Absolem já existe', async () => {
    state.packaged = true
    const targetDir = join('C:\\fake\\resources', 'programs', 'Absolem')
    setupFs({ files: [join(targetDir, 'Absolem.exe')] })

    const [, , absolem] = await deployPrograms()
    expect(absolem).toEqual({
      id: 'absolem',
      name: 'Absolem',
      installed: true,
      path: targetDir
    })
  })

  it('empacotado sem o exe: falha explicando que o instalador deve embutir', async () => {
    state.packaged = true
    setupFs({})

    const [, , absolem] = await deployPrograms()
    expect(absolem.installed).toBe(false)
    expect(absolem.error).toContain('Executável não encontrado')
    expect(absolem.error).toContain('resources/programs/Absolem')
  })

  it('dev: copia do build local quando o exe alvo não existe', async () => {
    const sourceDir = join(PROJECT, '..', 'Absolem', 'dist', 'win-unpacked')
    setupFs({ files: [join(sourceDir, 'Absolem.exe')] })

    const [, , absolem] = await deployPrograms()
    expect(fsMock.cpSync).toHaveBeenCalledWith(sourceDir, ABSOLEM_DIR, { recursive: true })
    expect(absolem.installed).toBe(true)
    expect(absolem.path).toBe(ABSOLEM_DIR)
  })

  it('dev: recopia quando o build local é mais novo que o bundle', async () => {
    const sourceDir = join(PROJECT, '..', 'Absolem', 'dist', 'win-unpacked')
    const sourceExe = join(sourceDir, 'Absolem.exe')
    const targetExe = join(ABSOLEM_DIR, 'Absolem.exe')
    setupFs({
      files: [sourceExe, targetExe],
      mtimes: { [sourceExe]: 2_000, [targetExe]: 1_000 }
    })

    const [, , absolem] = await deployPrograms()
    expect(fsMock.cpSync).toHaveBeenCalledWith(sourceDir, ABSOLEM_DIR, { recursive: true })
    expect(absolem.installed).toBe(true)
    expect(absolem.path).toBe(ABSOLEM_DIR)
  })

  it('dev: bundle mais novo que o build local não é recopiado', async () => {
    const sourceDir = join(PROJECT, '..', 'Absolem', 'dist', 'win-unpacked')
    const sourceExe = join(sourceDir, 'Absolem.exe')
    const targetExe = join(ABSOLEM_DIR, 'Absolem.exe')
    setupFs({
      files: [sourceExe, targetExe],
      mtimes: { [sourceExe]: 1_000, [targetExe]: 2_000 }
    })

    const [, , absolem] = await deployPrograms()
    expect(fsMock.cpSync).not.toHaveBeenCalled()
    expect(absolem.installed).toBe(true)
    expect(absolem.path).toBe(ABSOLEM_DIR)
  })

  it('dev: bundle existente sem build local é aceito como está', async () => {
    const targetExe = join(ABSOLEM_DIR, 'Absolem.exe')
    setupFs({ files: [targetExe] })

    const [, , absolem] = await deployPrograms()
    expect(fsMock.cpSync).not.toHaveBeenCalled()
    expect(absolem.installed).toBe(true)
  })

  it('dev: falha no statSync não derruba o deploy (trata como não mais novo)', async () => {
    const sourceDir = join(PROJECT, '..', 'Absolem', 'dist', 'win-unpacked')
    const sourceExe = join(sourceDir, 'Absolem.exe')
    const targetExe = join(ABSOLEM_DIR, 'Absolem.exe')
    setupFs({ files: [sourceExe, targetExe] })
    fsMock.statSync.mockImplementation(() => {
      throw new Error('EPERM')
    })

    const [, , absolem] = await deployPrograms()
    expect(fsMock.cpSync).not.toHaveBeenCalled()
    expect(absolem.installed).toBe(true)
  })

  it('empacotado: nunca recopia nem consulta mtime (instalador substitui)', async () => {
    state.packaged = true
    const targetDir = join('C:\\fake\\resources', 'programs', 'Absolem')
    const targetExe = join(targetDir, 'Absolem.exe')
    const sourceDir = join(PROJECT, '..', 'Absolem', 'dist', 'win-unpacked')
    const sourceExe = join(sourceDir, 'Absolem.exe')
    setupFs({
      files: [targetExe, sourceExe],
      mtimes: { [sourceExe]: 2_000, [targetExe]: 1_000 }
    })

    const [, , absolem] = await deployPrograms()
    expect(fsMock.cpSync).not.toHaveBeenCalled()
    expect(fsMock.statSync).not.toHaveBeenCalled()
    expect(absolem).toEqual({
      id: 'absolem',
      name: 'Absolem',
      installed: true,
      path: targetDir
    })
  })

  it('dev: falha de cópia vira resultado de erro', async () => {
    const sourceDir = join(PROJECT, '..', 'Absolem', 'dist', 'win-unpacked')
    setupFs({ files: [join(sourceDir, 'Absolem.exe')] })
    fsMock.cpSync.mockImplementation(() => {
      throw new Error('sem espaço')
    })

    const [, , absolem] = await deployPrograms()
    expect(absolem.installed).toBe(false)
    expect(absolem.error).toBe('Falha ao copiar Absolem: sem espaço')
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
