import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { GameSourceImportReport } from '../shared/gameImport'
import { addGame, extractIconPng, gameIconsDir, getGames } from './games'
import { findGameExecutable } from './games/exeFinder'
import { exePathHash } from './games/naming'
import { logger } from './logger'

/**
 * Busca de jogos instalados pelo Epic Games Launcher.
 *
 * O launcher grava um manifesto JSON (`*.item`) por jogo em
 * `%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests`. O manifesto é a fonte
 * da verdade: instalações incompletas, DLCs (`MainGameAppName` preenchido) e
 * entradas que não são jogos (`AppCategories` sem `games`) são descartadas.
 *
 * O parser é puro e exportado para teste; a varredura usa `addGame` (dedupe real
 * por id/exePath) e mantém a mesma linguagem do scanner da Steam.
 */

/** Manifesto Epic já validado — só o que a importação precisa. */
export interface EpicManifest {
  displayName: string
  installLocation: string
  /** Caminho relativo ao `InstallLocation`; null quando o manifesto não traz. */
  launchExecutable: string | null
}

/** Pasta padrão dos manifestos (exportada para testes e diagnóstico). */
export function epicManifestsDir(programData = process.env.ProgramData): string {
  return join(programData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
}

/**
 * Valida o JSON de um manifesto Epic e devolve só os campos usados.
 * Devolve null para JSON inválido, instalação incompleta, DLC, categoria que
 * não é jogo ou entrada sem nome/pasta de instalação.
 */
export function parseEpicManifest(jsonContent: string): EpicManifest | null {
  let raw: unknown
  try {
    raw = JSON.parse(jsonContent)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>

  // Instalação incompleta não tem executável confiável — não entra na biblioteca.
  if (data.bIsIncompleteInstall === true) return null

  const displayName = typeof data.DisplayName === 'string' ? data.DisplayName.trim() : ''
  const installLocation =
    typeof data.InstallLocation === 'string' ? data.InstallLocation.trim() : ''
  if (!displayName || !installLocation) return null

  // `MainGameAppName` preenchido identifica DLC/add-on, não um jogo autônomo.
  const mainGameAppName =
    typeof data.MainGameAppName === 'string' ? data.MainGameAppName.trim() : ''
  if (mainGameAppName) return null

  // Manifestos antigos podem não ter categorias; quando têm uma lista não vazia,
  // ela precisa declarar explicitamente que a entrada é um jogo.
  const categories = data.AppCategories
  if (Array.isArray(categories) && categories.length > 0) {
    if (!categories.every((category): category is string => typeof category === 'string')) {
      return null
    }
    if (!categories.some((category) => category.trim().toLowerCase() === 'games')) return null
  }

  const launchExecutable =
    typeof data.LaunchExecutable === 'string' && data.LaunchExecutable.trim()
      ? data.LaunchExecutable.trim()
      : null

  return { displayName, installLocation, launchExecutable }
}

/** Relatório-base da Epic: zera os contadores mantendo source/label fixos. */
function emptyEpicReport(): GameSourceImportReport {
  return {
    source: 'epic',
    label: 'Epic Games',
    detected: true,
    imported: 0,
    alreadyInLibrary: 0,
    ignored: 0,
    noExe: 0,
    errors: []
  }
}

/** Executável do manifesto: `LaunchExecutable` existente ou a varredura da pasta. */
function resolveEpicExecutable(manifest: EpicManifest): string | null {
  if (manifest.launchExecutable) {
    const candidate = join(manifest.installLocation, manifest.launchExecutable)
    if (existsSync(candidate)) return candidate
  }
  return findGameExecutable(manifest.installLocation)
}

/** Varre os manifestos da Epic. Nunca lança — falhas viram contadores/erros. */
export async function scanEpicGames(): Promise<GameSourceImportReport> {
  const report = emptyEpicReport()
  const manifestsDir = epicManifestsDir()

  let manifestsDirExists = false
  try {
    manifestsDirExists = statSync(manifestsDir).isDirectory()
  } catch {
    // Launcher não instalado (ou sem a pasta de dados) não é erro.
  }
  if (!manifestsDirExists) {
    report.detected = false
    report.message = 'Epic Games não detectado neste PC.'
    return report
  }

  let entries: string[]
  try {
    entries = readdirSync(manifestsDir)
  } catch (err) {
    logger.warn('epic', `Sem acesso a ${manifestsDir}:`, err)
    report.errors.push('Não foi possível ler a pasta de jogos da Epic Games.')
    return report
  }

  const existing = getGames()
  const existingIds = new Set(existing.map((game) => game.id))
  const existingExePaths = new Set(existing.map((game) => game.exePath.toLowerCase()))
  // Dedupe dentro da própria varredura (dois manifestos para o mesmo .exe).
  const seenExePaths = new Set<string>()
  const now = new Date().toISOString()

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.item')) continue

    let manifest: EpicManifest | null
    try {
      manifest = parseEpicManifest(readFileSync(join(manifestsDir, entry), 'utf8'))
    } catch (err) {
      logger.warn('epic', `Falha ao ler ${entry}:`, err)
      report.ignored += 1
      continue
    }
    if (!manifest) {
      // Incompleto, DLC, categoria não-jogo ou JSON inválido: descarte esperado.
      report.ignored += 1
      continue
    }

    const exePath = resolveEpicExecutable(manifest)
    if (!exePath) {
      report.noExe += 1
      continue
    }

    const hash = exePathHash(exePath)
    const id = `epic-${hash}`
    const exeKey = exePath.toLowerCase()
    if (existingIds.has(id) || existingExePaths.has(exeKey) || seenExePaths.has(exeKey)) {
      report.alreadyInLibrary += 1
      continue
    }
    seenExePaths.add(exeKey)

    // Ícone embutido → PNG em %APPDATA%/kolnd-hub/game-icons/epic_<hash>.png.
    const iconPath = join(gameIconsDir(), `epic_${hash}.png`)
    const iconOk = await extractIconPng(exePath, iconPath)

    const result = addGame({
      id,
      name: manifest.displayName,
      exePath,
      iconPath: iconOk ? iconPath : null,
      origin: 'epic',
      addedAt: now
    })

    if (result.success) {
      report.imported += 1
      existingIds.add(id)
      existingExePaths.add(exeKey)
    } else {
      // Mesmo .exe de um jogo personalizado/Steam conta como "já na biblioteca".
      const message = result.error ?? 'erro desconhecido'
      if (message.includes('Já existe') || message.includes('já está na sua biblioteca')) {
        report.alreadyInLibrary += 1
      } else {
        report.errors.push(`${manifest.displayName}: ${message}`)
      }
    }
  }

  logger.info(
    'epic',
    `Busca concluída: ${report.imported} importado(s), ` +
      `${report.alreadyInLibrary} já na biblioteca, ${report.ignored} ignorado(s), ` +
      `${report.noExe} sem executável, ${report.errors.length} erro(s)`
  )
  return report
}
