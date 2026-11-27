import { existsSync, mkdirSync, cpSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { findKloudGamesExe, getKloudGamesDir } from './kloudGames'
import { logger } from './logger'

export interface ProgramDeployResult {
  id: string
  name: string
  installed: boolean
  path?: string
  error?: string
}

/** Caminho base do Kolnd Hub (diretório do .exe em produção, raiz do projeto em dev). */
function getHubBaseDir(): string {
  return app?.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
}

/** Caminho onde os programas embutidos ficam dentro do app. */
function getProgramsDir(): string {
  // Em produção, os recursos extras ficam em <install-dir>/resources/programs.
  // Em dev, ficam em <project>/resources/programs.
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'programs')
  }
  return join(getHubBaseDir(), 'resources', 'programs')
}

/**
 * Verifica/copia o build do Mark LVII para resources/programs/MarkLVII.
 *
 * O Mark LVII grava config/ e memory/ ao lado do próprio .exe, então o
 * diretório do bundle é também o diretório de dados do app.
 */
function deployMarkLvii(): ProgramDeployResult {
  const targetDir = join(getProgramsDir(), 'MarkLVII')
  const targetExe = join(targetDir, 'MarkLVII.exe')

  if (existsSync(targetExe)) {
    return { id: 'mark-lvi', name: 'Mark LVII (JARVIS)', installed: true, path: targetDir }
  }

  // Em desenvolvimento, tenta copiar do build local se existir.
  // NUNCA em produção: o pacote instalado deve vir exclusivamente dos
  // resources/ embutidos no .exe (extraResources) — copiar de uma árvore de
  // desenvolvimento para dentro da instalação mascararia um pacote quebrado.
  const isDev = !app?.isPackaged
  if (isDev) {
    const sourceDir = join(getHubBaseDir(), '..', 'Mark-LVII', 'dist', 'MarkLVII')
    const sourceExe = join(sourceDir, 'MarkLVII.exe')

    if (existsSync(sourceExe)) {
      try {
        logger.info(
          'programsDeployer',
          `DEV fallback: copiando Mark LVII de ${sourceDir} para ${targetDir} (não ocorre em produção)`
        )
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true })
        }
        cpSync(sourceDir, targetDir, { recursive: true })
        return { id: 'mark-lvi', name: 'Mark LVII (JARVIS)', installed: true, path: targetDir }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          id: 'mark-lvi',
          name: 'Mark LVII (JARVIS)',
          installed: false,
          error: `Falha ao copiar Mark LVII: ${message}`
        }
      }
    }
  }

  return {
    id: 'mark-lvi',
    name: 'Mark LVII (JARVIS)',
    installed: false,
    error: `Executável não encontrado em ${targetExe}. Em produção, o instalador deve embutir este programa em resources/programs/MarkLVII.`
  }
}

/** Verifica se o Kloud Games está instalado (instala via MSI embutido no 1º run). */
function deployKloudGames(): ProgramDeployResult {
  const installedExe = findKloudGamesExe()

  if (installedExe) {
    return { id: 'kloud-games', name: 'Kloud Games', installed: true, path: installedExe }
  }

  const msi = join(getKloudGamesDir(), 'KLOUD_GAMES.msi')
  if (existsSync(msi)) {
    return {
      id: 'kloud-games',
      name: 'Kloud Games',
      installed: false,
      error: `MSI do Kloud Games embutido em ${msi}, mas ainda não instalado. Execute a instalação pela tela de primeira execução (ou instale manualmente com msiexec /i "${msi}").`
    }
  }

  return {
    id: 'kloud-games',
    name: 'Kloud Games',
    installed: false,
    error:
      'KLOUD_GAMES.exe não encontrado e MSI do Kloud Games não embutido em resources/programs/kloud-games/.'
  }
}

/**
 * Verifica/copia o build do Absolem para resources/programs/Absolem.
 *
 * O Absolem é distribuído como o build Electron pronto (win-unpacked), sem
 * instalador próprio: roda direto de dentro da pasta do Hub e some junto com
 * ela na desinstalação. Os dados do app ficam em %APPDATA%\absolem.
 */
function deployAbsolem(): ProgramDeployResult {
  const targetDir = join(getProgramsDir(), 'Absolem')
  const targetExe = join(targetDir, 'Absolem.exe')

  if (existsSync(targetExe)) {
    return { id: 'absolem', name: 'Absolem', installed: true, path: targetDir }
  }

  // Mesmo racional do Mark LVII: em dev copia do build local; em produção só
  // aceita o que veio nos resources embutidos no instalador.
  const isDev = !app?.isPackaged
  if (isDev) {
    const sourceDir = join(getHubBaseDir(), '..', 'Absolem', 'dist', 'win-unpacked')
    const sourceExe = join(sourceDir, 'Absolem.exe')

    if (existsSync(sourceExe)) {
      try {
        logger.info(
          'programsDeployer',
          `DEV fallback: copiando Absolem de ${sourceDir} para ${targetDir} (não ocorre em produção)`
        )
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true })
        }
        cpSync(sourceDir, targetDir, { recursive: true })
        return { id: 'absolem', name: 'Absolem', installed: true, path: targetDir }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          id: 'absolem',
          name: 'Absolem',
          installed: false,
          error: `Falha ao copiar Absolem: ${message}`
        }
      }
    }
  }

  return {
    id: 'absolem',
    name: 'Absolem',
    installed: false,
    error: `Executável não encontrado em ${targetExe}. Em produção, o instalador deve embutir este programa em resources/programs/Absolem.`
  }
}

/** Verifica/implanta todos os programas do ecossistema. */
export async function deployPrograms(): Promise<ProgramDeployResult[]> {
  // Absolem por último para preservar a ordem/índices históricos usados nos testes.
  return [deployMarkLvii(), deployKloudGames(), deployAbsolem()]
}

/** Gera um relatório em texto do resultado da implantação. */
export function formatDeployReport(results: ProgramDeployResult[]): string {
  const lines: string[] = ['=== Implantação de Programas ===']
  for (const result of results) {
    lines.push(
      `${result.name}: ${result.installed ? 'OK' : 'FALHOU'}${result.path ? ` (${result.path})` : ''}${result.error ? ` — ${result.error}` : ''}`
    )
  }
  return lines.join('\n')
}
