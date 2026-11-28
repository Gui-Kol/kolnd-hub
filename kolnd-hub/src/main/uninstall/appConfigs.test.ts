import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\fake\\Roaming' }
}))

import {
  escapePowerShellLiteral,
  getAbsolemDataDir,
  getKloudGamesInstallConfigDirs,
  getKloudGamesPerUserConfigDirs,
  wipeConfigFolder
} from './appConfigs'

describe('appConfigs — caminhos', () => {
  it('userData do Absolem fica em %APPDATA%\\absolem', () => {
    expect(getAbsolemDataDir()).toBe('C:\\fake\\Roaming\\absolem')
  })

  it('configurações per-user do Kloud Games incluem serviço e ProgramData', () => {
    const saved = {
      local: process.env.LOCALAPPDATA,
      programData: process.env.ProgramData
    }
    process.env.LOCALAPPDATA = 'C:\\Users\\Teste\\AppData\\Local'
    process.env.ProgramData = 'C:\\ProgramData'
    try {
      expect(getKloudGamesPerUserConfigDirs()).toEqual([
        'C:\\Users\\Teste\\AppData\\Local\\LizardByte\\KLOUD_GAMES',
        'C:\\ProgramData\\KLOUD_GAMES'
      ])
    } finally {
      process.env.LOCALAPPDATA = saved.local
      process.env.ProgramData = saved.programData
    }
  })

  it('configurações da instalação apontam para Program Files (x86 também)', () => {
    const saved = {
      programFiles: process.env.ProgramFiles,
      programFilesX86: process.env['ProgramFiles(x86)']
    }
    process.env.ProgramFiles = 'C:\\Program Files'
    process.env['ProgramFiles(x86)'] = 'C:\\Program Files (x86)'
    try {
      expect(getKloudGamesInstallConfigDirs()).toEqual([
        'C:\\Program Files\\KLOUD_GAMES\\config',
        'C:\\Program Files (x86)\\KLOUD_GAMES\\config'
      ])
    } finally {
      process.env.ProgramFiles = saved.programFiles
      process.env['ProgramFiles(x86)'] = saved.programFilesX86
    }
  })

  it('escapa aspas simples para string PowerShell', () => {
    expect(escapePowerShellLiteral("C:\\Pasta d'Água\\config")).toBe("C:\\Pasta d''Água\\config")
  })
})

describe('appConfigs — wipeConfigFolder', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'app-configs-test-'))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('apaga o conteúdo item a item e remove a raiz vazia', () => {
    const target = join(base, 'absolem')
    mkdirSync(join(target, 'logs'), { recursive: true })
    writeFileSync(join(target, 'config.json'), '{}')
    writeFileSync(join(target, 'logs', 'absolem.log'), 'log')

    const logs: string[] = []
    const result = wipeConfigFolder(target, ['absolem'], (line) => logs.push(line), '[teste]')

    expect(result.errors).toEqual([])
    expect(result.deleted.sort()).toEqual(['config.json', 'logs'])
    expect(result.inventory.sort()).toEqual(['config.json', 'logs'])
    expect(existsSync(target)).toBe(false)
    expect(logs.join('')).toContain('[teste] Inventário')
  })

  it('recusa apagar pasta com nome inesperado (trava de basename)', () => {
    const target = join(base, 'outra-coisa')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'importante.txt'), 'não apague')

    const result = wipeConfigFolder(target, ['absolem'], () => {}, '[teste]')

    expect(result.errors).toHaveLength(1)
    expect(result.deleted).toEqual([])
    expect(readFileSync(join(target, 'importante.txt'), 'utf8')).toBe('não apague')
  })

  it('pasta inexistente é idempotente e não gera erro', () => {
    const result = wipeConfigFolder(join(base, 'absolem'), ['absolem'], () => {}, '[teste]')
    expect(result.errors).toEqual([])
    expect(result.deleted).toEqual([])
  })
})
