import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

const fsMock = vi.hoisted(() => ({ existsSync: vi.fn() }))
const gamesMock = vi.hoisted(() => ({
  addGame: vi.fn(),
  extractIconPng: vi.fn(),
  gameIconsDir: vi.fn(() => 'C:\\fake\\icons'),
  getGames: vi.fn()
}))
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))

vi.mock('fs', () => ({ existsSync: fsMock.existsSync }))
vi.mock('./games', () => ({
  addGame: gamesMock.addGame,
  extractIconPng: gamesMock.extractIconPng,
  gameIconsDir: gamesMock.gameIconsDir,
  getGames: gamesMock.getGames
}))
vi.mock('./logger', () => ({ logger: { ...loggerMock, debug: vi.fn() } }))

import { minecraftLauncherCandidates, scanMinecraftLauncher } from './minecraftScanner'

const PF86 = 'C:\\Program Files (x86)'
const PF = 'C:\\Program Files'
const LOCAL = 'C:\\Users\\Tiffo\\AppData\\Local'

/** Executável do launcher clássico, na ordem em que o scanner procura. */
const PF86_LAUNCHER = join(PF86, 'Minecraft Launcher', 'MinecraftLauncher.exe')
const PF_LAUNCHER = join(PF, 'Minecraft Launcher', 'MinecraftLauncher.exe')
const LOCAL_LAUNCHER = join(LOCAL, 'Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe')
const LEGACY_LAUNCHER = join(PF86, 'Minecraft', 'MinecraftLauncher.exe')
const XBOX_LAUNCHER = join('C:\\', 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ProgramFiles(x86)', PF86)
  vi.stubEnv('ProgramFiles', PF)
  vi.stubEnv('LOCALAPPDATA', LOCAL)
  fsMock.existsSync.mockReturnValue(false)
  gamesMock.getGames.mockReturnValue([])
  gamesMock.extractIconPng.mockResolvedValue(true)
  gamesMock.addGame.mockReturnValue({ success: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('minecraftLauncherCandidates', () => {
  it('devolve os candidatos na ordem documentada', () => {
    const candidates = minecraftLauncherCandidates({
      programFilesX86: PF86,
      programFiles: PF,
      localAppData: LOCAL
    })

    expect(candidates).toEqual([
      PF86_LAUNCHER,
      PF_LAUNCHER,
      LOCAL_LAUNCHER,
      XBOX_LAUNCHER,
      join('D:\\', 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
      join('E:\\', 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
      join('F:\\', 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
      join('G:\\', 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
      join('H:\\', 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'),
      LEGACY_LAUNCHER
    ])
  })

  it('deduplica bases iguais (case-insensitive) sem mudar a ordem', () => {
    const candidates = minecraftLauncherCandidates({
      programFilesX86: PF,
      programFiles: PF.toUpperCase(),
      localAppData: PF
    })

    expect(candidates[0]).toBe(PF_LAUNCHER)
    expect(candidates.filter((candidate) => candidate === PF_LAUNCHER)).toHaveLength(1)
    expect(new Set(candidates.map((candidate) => candidate.toLowerCase())).size).toBe(
      candidates.length
    )
  })

  it('ignora bases ausentes/vazias e mantém os caminhos do XboxGames', () => {
    const candidates = minecraftLauncherCandidates({})
    expect(candidates).toHaveLength(6)
    expect(candidates[0]).toBe(XBOX_LAUNCHER)
    expect(candidates.every((candidate) => candidate.includes('XboxGames'))).toBe(true)
  })
})

describe('scanMinecraftLauncher', () => {
  it('launcher presente → adiciona UMA entrada com id/origem/ícone fixos', async () => {
    fsMock.existsSync.mockImplementation((path: string) => path === PF86_LAUNCHER)

    const report = await scanMinecraftLauncher()
    expect(report).toMatchObject({
      source: 'minecraft',
      label: 'Minecraft Launcher',
      detected: true,
      imported: 1,
      alreadyInLibrary: 0
    })
    expect(gamesMock.addGame).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'minecraft-launcher',
        name: 'Minecraft Launcher',
        exePath: PF86_LAUNCHER,
        origin: 'minecraft',
        iconPath: join('C:\\fake\\icons', 'minecraft_launcher.png')
      })
    )
  })

  it('usa o segundo candidato quando o primeiro não existe', async () => {
    fsMock.existsSync.mockImplementation((path: string) => path === PF_LAUNCHER)

    const report = await scanMinecraftLauncher()
    expect(report.imported).toBe(1)
    expect(gamesMock.addGame).toHaveBeenCalledWith(
      expect.objectContaining({ exePath: PF_LAUNCHER })
    )
  })

  it('ausente com .minecraft presente → detected false e nada é importado', async () => {
    // A pasta `.minecraft\versions` existe, mas não é lançável isoladamente.
    fsMock.existsSync.mockImplementation(
      (path: string) => path === join(LOCAL, '.minecraft', 'versions', '1.20', '1.20.jar')
    )

    const report = await scanMinecraftLauncher()
    expect(report).toMatchObject({
      source: 'minecraft',
      detected: false,
      imported: 0,
      message: 'Minecraft Launcher não detectado neste PC.'
    })
    expect(gamesMock.addGame).not.toHaveBeenCalled()
    expect(fsMock.existsSync).not.toHaveBeenCalledWith(expect.stringContaining('.minecraft'))
  })

  it('entrada já na biblioteca por id ou exePath conta como alreadyInLibrary', async () => {
    fsMock.existsSync.mockImplementation((path: string) => path === XBOX_LAUNCHER)
    gamesMock.getGames.mockReturnValue([
      { id: 'minecraft-launcher', exePath: 'C:\\outro\\minecraft.exe', origin: 'minecraft' }
    ])

    const report = await scanMinecraftLauncher()
    expect(report.alreadyInLibrary).toBe(1)
    expect(report.imported).toBe(0)
    expect(gamesMock.addGame).not.toHaveBeenCalled()
  })

  it('duplicata detectada pelo addGame vira alreadyInLibrary; erro genérico vira errors', async () => {
    fsMock.existsSync.mockImplementation((path: string) => path === XBOX_LAUNCHER)

    gamesMock.addGame.mockReturnValueOnce({
      success: false,
      error: 'Este executável já está na sua biblioteca.'
    })
    const duplicate = await scanMinecraftLauncher()
    expect(duplicate.alreadyInLibrary).toBe(1)
    expect(duplicate.errors).toEqual([])

    gamesMock.addGame.mockReturnValueOnce({ success: false, error: 'disco cheio' })
    const failed = await scanMinecraftLauncher()
    expect(failed.errors).toEqual(['Minecraft Launcher: disco cheio'])
  })

  it('sem ícone extraível → iconPath null (card cai no fallback visual)', async () => {
    fsMock.existsSync.mockImplementation((path: string) => path === XBOX_LAUNCHER)
    gamesMock.extractIconPng.mockResolvedValue(false)

    const report = await scanMinecraftLauncher()
    expect(report.imported).toBe(1)
    expect(gamesMock.addGame).toHaveBeenCalledWith(expect.objectContaining({ iconPath: null }))
  })
})
