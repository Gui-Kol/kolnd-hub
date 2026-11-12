import { existsSync, mkdirSync, cpSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { findKloudGamesExe, getKloudGamesDir } from './kloudGames'

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

/** Verifica/copia o build do Mark LVI para resources/programs/MarkLVI. */
function deployMarkLvi(): ProgramDeployResult {
  const targetDir = join(getProgramsDir(), 'MarkLVI')
  const targetExe = join(targetDir, 'MarkLVI.exe')

  if (existsSync(targetExe)) {
    return { id: 'mark-lvi', name: 'Mark LVI (JARVIS)', installed: true, path: targetDir }
  }

  // Em desenvolvimento, tenta copiar do fonte/build local se existir.
  const isDev = !app?.isPackaged
  if (isDev) {
    const sourceDir = join(getHubBaseDir(), '..', 'Mark-LVI', 'dist', 'MarkLVI')
    const sourceExe = join(sourceDir, 'MarkLVI.exe')

    if (existsSync(sourceExe)) {
      try {
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true })
        }
        cpSync(sourceDir, targetDir, { recursive: true })
        return { id: 'mark-lvi', name: 'Mark LVI (JARVIS)', installed: true, path: targetDir }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          id: 'mark-lvi',
          name: 'Mark LVI (JARVIS)',
          installed: false,
          error: `Falha ao copiar Mark LVI: ${message}`
        }
      }
    }
  }

  return {
    id: 'mark-lvi',
    name: 'Mark LVI (JARVIS)',
    installed: false,
    error: `Executável não encontrado em ${targetExe}. Em produção, o instalador deve embutir este programa em resources/programs/MarkLVI.`
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
    error: 'KLOUD_GAMES.exe não encontrado e MSI do Kloud Games não embutido em resources/programs/kloud-games/.'
  }
}

/** Verifica/implanta todos os programas do ecossistema. */
export async function deployPrograms(): Promise<ProgramDeployResult[]> {
  return [deployMarkLvi(), deployKloudGames()]
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
