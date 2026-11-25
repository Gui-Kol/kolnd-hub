import { existsSync } from 'fs'
import { join } from 'path'
import type { GameSourceImportReport } from '../shared/gameImport'
import { addGame, extractIconPng, gameIconsDir, getGames } from './games'
import { logger } from './logger'

/**
 * Busca do Minecraft Launcher.
 *
 * O launcher é UMA entrada só: as versões de `.minecraft\versions` não são
 * executáveis autônomos (o launcher escolhe a versão e baixa os assets), então
 * varrer essa pasta geraria cards quebrados. O executável é procurado nos
 * caminhos padrão de instalação, incluindo a versão da Microsoft Store em
 * `<drive>:\XboxGames`.
 */

/** Fonte de variáveis de ambiente usada na montagem dos candidatos (injetável em teste). */
export interface MinecraftLauncherEnv {
  programFilesX86?: string
  programFiles?: string
  localAppData?: string
}

const MINECRAFT_LAUNCHER_ID = 'minecraft-launcher'
const MINECRAFT_LAUNCHER_NAME = 'Minecraft Launcher'
/** Unidades onde a Microsoft Store instala os jogos (XboxGames). */
const XBOX_GAMES_DRIVES = ['C', 'D', 'E', 'F', 'G', 'H'] as const

/**
 * Candidatos ao executável do launcher, na ordem de preferência.
 * Deduplica sem diferenciar maiúsculas (dois envs podem apontar para o mesmo
 * diretório) e ignora bases vazias.
 */
export function minecraftLauncherCandidates(env: MinecraftLauncherEnv): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []

  const add = (candidate: string | null): void => {
    if (!candidate) return
    const key = candidate.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(candidate)
  }

  const addUnder = (base: string | undefined, relative: string): void => {
    if (!base || !base.trim()) return
    add(join(base, relative))
  }

  // Instalação clássica (64/32 bits) e a pasta por usuário do launcher novo.
  addUnder(env.programFilesX86, join('Minecraft Launcher', 'MinecraftLauncher.exe'))
  addUnder(env.programFiles, join('Minecraft Launcher', 'MinecraftLauncher.exe'))
  addUnder(env.localAppData, join('Programs', 'Minecraft Launcher', 'MinecraftLauncher.exe'))

  // Versão empacotada pela Microsoft Store (XboxGames) em qualquer unidade usual.
  for (const drive of XBOX_GAMES_DRIVES) {
    add(join(`${drive}:\\`, 'XboxGames', 'Minecraft Launcher', 'Content', 'Minecraft.exe'))
  }

  // Instalador antigo, por último: só existe em máquinas com a versão legada.
  addUnder(env.programFilesX86, join('Minecraft', 'MinecraftLauncher.exe'))

  return candidates
}

/** Relatório-base do Minecraft: zera os contadores mantendo source/label fixos. */
function emptyMinecraftReport(): GameSourceImportReport {
  return {
    source: 'minecraft',
    label: 'Minecraft Launcher',
    detected: true,
    imported: 0,
    alreadyInLibrary: 0,
    ignored: 0,
    noExe: 0,
    errors: []
  }
}

/** Procura o launcher e adiciona UMA entrada à biblioteca. Nunca lança. */
export async function scanMinecraftLauncher(): Promise<GameSourceImportReport> {
  const report = emptyMinecraftReport()
  const candidates = minecraftLauncherCandidates({
    programFilesX86: process.env['ProgramFiles(x86)'],
    programFiles: process.env.ProgramFiles,
    localAppData: process.env.LOCALAPPDATA
  })
  const exePath = candidates.find((candidate) => existsSync(candidate)) ?? null

  if (!exePath) {
    // Ausência do launcher não é erro; `.minecraft` sozinho não é um jogo lançável.
    report.detected = false
    report.message = 'Minecraft Launcher não detectado neste PC.'
    return report
  }

  const existing = getGames()
  const exeKey = exePath.toLowerCase()
  if (
    existing.some(
      (game) => game.id === MINECRAFT_LAUNCHER_ID || game.exePath.toLowerCase() === exeKey
    )
  ) {
    // Id determinístico: buscar de novo nunca duplica a entrada.
    report.alreadyInLibrary = 1
    return report
  }

  // Ícone embutido → PNG em %APPDATA%/kolnd-hub/game-icons/minecraft_launcher.png.
  const iconPath = join(gameIconsDir(), 'minecraft_launcher.png')
  const iconOk = await extractIconPng(exePath, iconPath)

  const result = addGame({
    id: MINECRAFT_LAUNCHER_ID,
    name: MINECRAFT_LAUNCHER_NAME,
    exePath,
    iconPath: iconOk ? iconPath : null,
    origin: 'minecraft',
    addedAt: new Date().toISOString()
  })

  if (result.success) {
    report.imported = 1
  } else {
    const message = result.error ?? 'erro desconhecido'
    if (message.includes('Já existe') || message.includes('já está na sua biblioteca')) {
      report.alreadyInLibrary = 1
    } else {
      report.errors.push(`${MINECRAFT_LAUNCHER_NAME}: ${message}`)
    }
  }

  logger.info(
    'minecraft',
    `Busca concluída: ${report.imported} importado(s), ` +
      `${report.alreadyInLibrary} já na biblioteca, ${report.errors.length} erro(s)`
  )
  return report
}
