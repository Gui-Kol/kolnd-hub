import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const { findKloudGamesExeMock, resetKloudGamesStateMock, getKloudGamesUninstallLogPathMock } =
  vi.hoisted(() => ({
    findKloudGamesExeMock: vi.fn(),
    resetKloudGamesStateMock: vi.fn(() => true),
    getKloudGamesUninstallLogPathMock: vi.fn()
  }))

const { getKloudGamesServiceStatusMock, findKloudGamesUninstallEntryMock } = vi.hoisted(() => ({
  getKloudGamesServiceStatusMock: vi.fn(),
  findKloudGamesUninstallEntryMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\fake\\userData' }
}))

vi.mock('./kloudGames', () => ({
  findKloudGamesExe: findKloudGamesExeMock,
  resetKloudGamesState: resetKloudGamesStateMock,
  getKloudGamesUninstallLogPath: getKloudGamesUninstallLogPathMock
}))

vi.mock('./uninstallDetection', () => ({
  getKloudGamesServiceStatus: getKloudGamesServiceStatusMock,
  findKloudGamesUninstallEntry: findKloudGamesUninstallEntryMock
}))

import {
  checkExeGone,
  checkServiceGone,
  checkRegistryGone,
  checkShortcutsGone,
  checkTempCleaned,
  checkConfigGone,
  verifyKloudGamesRemoval,
  type KloudGamesUninstallReport
} from './uninstallVerify'

const savedEnv = { ...process.env }

/** Diretório base estável (criado antes de qualquer alteração de env). */
const base = mkdtempSync(join(tmpdir(), 'kg-verify-test-'))

function envDir(prefix: string): string {
  return mkdtempSync(join(base, prefix))
}

function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

afterAll(() => {
  removeDir(base)
})

function makeStartMenu(
  root: string,
  opts: { lizardByte?: boolean; rootLnks?: string[] } = {}
): void {
  const programs = join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  mkdirSync(programs, { recursive: true })
  if (opts.lizardByte) {
    mkdirSync(join(programs, 'LizardByte', 'KLOUD_GAMES'), { recursive: true })
  }
  for (const lnk of opts.rootLnks ?? []) {
    writeFileSync(join(programs, lnk), '')
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  findKloudGamesExeMock.mockReset()
  resetKloudGamesStateMock.mockReset()
  getKloudGamesUninstallLogPathMock.mockReset()
  getKloudGamesServiceStatusMock.mockReset()
  findKloudGamesUninstallEntryMock.mockReset()

  getKloudGamesUninstallLogPathMock.mockReturnValue(
    'C:\\fake\\userData\\logs\\kloud-games-uninstall.log'
  )

  // Default: máquina já limpa (Kloud Games não instalado).
  findKloudGamesExeMock.mockReturnValue(null)
  getKloudGamesServiceStatusMock.mockReturnValue('missing')
  findKloudGamesUninstallEntryMock.mockReturnValue(null)

  process.env.APPDATA = savedEnv.APPDATA
  process.env.TEMP = savedEnv.TEMP
  // Pastas de configuração do Kloud Games isoladas (não existem por padrão):
  // nunca apontar para os Program Files reais da máquina de teste.
  process.env.ProgramFiles = join(base, 'pf-none')
  process.env['ProgramFiles(x86)'] = join(base, 'pf86-none')
  process.env.ProgramData = join(base, 'pd-none')
  process.env.LOCALAPPDATA = join(base, 'lad-none')
})

afterEach(() => {
  process.env = savedEnv
})

describe('uninstallVerify — checkExeGone', () => {
  it('devolve true quando o exe sumiu (findKloudGamesExe === null) e chama resetKloudGamesState', () => {
    findKloudGamesExeMock.mockReturnValue(null)
    expect(checkExeGone()).toBe(true)
    expect(resetKloudGamesStateMock).toHaveBeenCalledTimes(1)
  })

  it('devolve false quando o exe ainda é encontrado', () => {
    findKloudGamesExeMock.mockReturnValue('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')
    expect(checkExeGone()).toBe(false)
  })
})

describe('uninstallVerify — checkServiceGone', () => {
  it('1060/missing → serviceGone true', () => {
    getKloudGamesServiceStatusMock.mockReturnValue('missing')
    expect(checkServiceGone()).toBe(true)
  })

  it('serviço rodando ou parado → serviceGone false', () => {
    getKloudGamesServiceStatusMock.mockReturnValue('running')
    expect(checkServiceGone()).toBe(false)
    getKloudGamesServiceStatusMock.mockReturnValue('stopped')
    expect(checkServiceGone()).toBe(false)
  })
})

describe('uninstallVerify — checkRegistryGone', () => {
  it('entrada ausente → registryGone true', () => {
    findKloudGamesUninstallEntryMock.mockReturnValue(null)
    expect(checkRegistryGone()).toBe(true)
  })

  it('entrada presente → registryGone false', () => {
    findKloudGamesUninstallEntryMock.mockReturnValue({
      productCode: '{11111111-1111-1111-1111-111111111111}',
      uninstallString: `MsiExec.exe /I{11111111-1111-1111-1111-111111111111}`,
      displayName: 'Kloud Games',
      scope: 'machine'
    })
    expect(checkRegistryGone()).toBe(false)
  })
})

describe('uninstallVerify — checkShortcutsGone', () => {
  let root: string | null = null

  afterEach(() => {
    if (root) removeDir(root)
    root = null
  })

  it('true quando não há pasta LizardByte\\KLOUD_GAMES nem atalho raiz', () => {
    root = envDir('kg-sm-clean-')
    process.env.APPDATA = root
    makeStartMenu(root)
    expect(checkShortcutsGone()).toBe(true)
  })

  it('false quando existe a pasta LizardByte\\KLOUD_GAMES', () => {
    root = envDir('kg-sm-lb-')
    process.env.APPDATA = root
    makeStartMenu(root, { lizardByte: true })
    expect(checkShortcutsGone()).toBe(false)
  })

  it('false quando existe atalho KLOUD_GAMES*.lnk na raiz de Programs', () => {
    root = envDir('kg-sm-lnk-')
    process.env.APPDATA = root
    makeStartMenu(root, { rootLnks: ['KLOUD_GAMES.lnk'] })
    expect(checkShortcutsGone()).toBe(false)
  })

  it('ignora atalhos que não começam com KLOUD_GAMES', () => {
    root = envDir('kg-sm-other-')
    process.env.APPDATA = root
    makeStartMenu(root, { rootLnks: ['Outro Programa.lnk', 'Kolnd Hub.lnk'] })
    expect(checkShortcutsGone()).toBe(true)
  })

  it('falha ao ler Programs → considera ausente (tolerante)', () => {
    root = envDir('kg-sm-noread-')
    process.env.APPDATA = root
    // Programs não existe: readdirSync falha → true
    expect(checkShortcutsGone()).toBe(true)
  })
})

describe('uninstallVerify — checkTempCleaned', () => {
  let root: string | null = null

  afterEach(() => {
    if (root) removeDir(root)
    root = null
  })

  it('true quando %TEMP%\\KLOUD_GAMES não existe', () => {
    root = envDir('kg-temp-clean-')
    process.env.TEMP = root
    expect(checkTempCleaned()).toBe(true)
  })

  it('false quando %TEMP%\\KLOUD_GAMES ainda existe', () => {
    root = envDir('kg-temp-present-')
    process.env.TEMP = root
    mkdirSync(join(root, 'KLOUD_GAMES'), { recursive: true })
    expect(checkTempCleaned()).toBe(false)
  })
})

describe('uninstallVerify — checkConfigGone', () => {
  let root: string | null = null

  afterEach(() => {
    if (root) removeDir(root)
    root = null
  })

  it('true quando nenhuma pasta de configuração do Kloud Games existe', () => {
    root = envDir('kg-cfg-clean-')
    process.env.LOCALAPPDATA = join(root, 'Local')
    process.env.ProgramData = join(root, 'ProgramData')
    process.env.ProgramFiles = join(root, 'Program Files')
    process.env['ProgramFiles(x86)'] = join(root, 'Program Files (x86)')
    expect(checkConfigGone()).toBe(true)
  })

  it('false quando %LOCALAPPDATA%\\LizardByte\\KLOUD_GAMES ainda existe', () => {
    root = envDir('kg-cfg-local-')
    process.env.LOCALAPPDATA = root
    mkdirSync(join(root, 'LizardByte', 'KLOUD_GAMES'), { recursive: true })
    expect(checkConfigGone()).toBe(false)
  })

  it('false quando %ProgramData%\\KLOUD_GAMES ainda existe', () => {
    root = envDir('kg-cfg-pd-')
    process.env.ProgramData = root
    mkdirSync(join(root, 'KLOUD_GAMES'), { recursive: true })
    expect(checkConfigGone()).toBe(false)
  })

  it('false quando config\\ dentro da instalação ainda existe', () => {
    root = envDir('kg-cfg-pf-')
    process.env.ProgramFiles = root
    mkdirSync(join(root, 'KLOUD_GAMES', 'config'), { recursive: true })
    expect(checkConfigGone()).toBe(false)
  })
})

describe('uninstallVerify — verifyKloudGamesRemoval', () => {
  let root: string | null = null

  beforeEach(() => {
    root = envDir('kg-verify-')
    process.env.APPDATA = root
    process.env.TEMP = root
  })

  afterEach(() => {
    if (root) removeDir(root)
    root = null
  })

  it('laudo tudo limpo: remaining vazio, todos true', () => {
    const report: KloudGamesUninstallReport = verifyKloudGamesRemoval()
    expect(report.exeGone).toBe(true)
    expect(report.serviceGone).toBe(true)
    expect(report.registryGone).toBe(true)
    expect(report.shortcutsGone).toBe(true)
    expect(report.tempCleaned).toBe(true)
    expect(report.configGone).toBe(true)
    expect(report.remaining).toEqual([])
    expect(report.logPath).toBe('C:\\fake\\userData\\logs\\kloud-games-uninstall.log')
  })

  it('serviço residual: remaining com 1 entrada, não derruba o fluxo', () => {
    getKloudGamesServiceStatusMock.mockReturnValue('running')
    const report = verifyKloudGamesRemoval()
    expect(report.serviceGone).toBe(false)
    expect(report.exeGone).toBe(true)
    expect(report.registryGone).toBe(true)
    expect(report.remaining).toHaveLength(1)
    expect(report.remaining[0]).toContain('KLOUD_GAMESsvc')
    expect(() => verifyKloudGamesRemoval()).not.toThrow()
  })

  it('laudo com 1–3 remanescentes: booleanos e remaining corretos', () => {
    findKloudGamesExeMock.mockReturnValue('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')
    getKloudGamesServiceStatusMock.mockReturnValue('stopped')
    findKloudGamesUninstallEntryMock.mockReturnValue({
      productCode: '{22222222-2222-2222-2222-222222222222}',
      uninstallString: `MsiExec.exe /I{22222222-2222-2222-2222-222222222222}`,
      displayName: 'Kloud Games',
      scope: 'machine'
    })
    const report = verifyKloudGamesRemoval()
    expect(report.exeGone).toBe(false)
    expect(report.serviceGone).toBe(false)
    expect(report.registryGone).toBe(false)
    expect(report.shortcutsGone).toBe(true)
    expect(report.tempCleaned).toBe(true)
    expect(report.remaining).toHaveLength(3)
    expect(report.remaining[0]).toContain('KLOUD_GAMES.exe')
    expect(report.remaining[1]).toContain('KLOUD_GAMESsvc')
    expect(report.remaining[2]).toContain('registro')
  })

  it('todos os itens presentes: remaining com 6 entradas, nenhum item derruba o fluxo', () => {
    findKloudGamesExeMock.mockReturnValue('C:\\x\\KLOUD_GAMES.exe')
    getKloudGamesServiceStatusMock.mockReturnValue('running')
    findKloudGamesUninstallEntryMock.mockReturnValue({
      productCode: '{33333333-3333-3333-3333-333333333333}',
      uninstallString: `MsiExec.exe /I{33333333-3333-3333-3333-333333333333}`,
      displayName: 'Kloud Games',
      scope: 'machine'
    })
    makeStartMenu(root!, { lizardByte: true, rootLnks: ['KLOUD_GAMES.lnk'] })
    mkdirSync(join(root!, 'KLOUD_GAMES'), { recursive: true })
    process.env.ProgramData = join(root!, 'ProgramData')
    mkdirSync(join(root!, 'ProgramData', 'KLOUD_GAMES'), { recursive: true })
    const report = verifyKloudGamesRemoval()
    expect(report.remaining).toHaveLength(6)
    expect(report.exeGone).toBe(false)
    expect(report.serviceGone).toBe(false)
    expect(report.registryGone).toBe(false)
    expect(report.shortcutsGone).toBe(false)
    expect(report.tempCleaned).toBe(false)
    expect(report.configGone).toBe(false)
    expect(() => verifyKloudGamesRemoval()).not.toThrow()
  })
})
