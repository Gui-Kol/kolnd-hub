import { spawn, spawnSync } from 'child_process'
import { ensureKloudGamesInstalled, findKloudGamesExe } from './kloudGames'

export interface InstallResult {
  success: boolean
  error?: string
  /** true quando o Kloud Games já estava instalado e a instalação foi pulada. */
  alreadyInstalled?: boolean
}

/** Verifica se o winget está disponível no sistema. */
export function isWingetAvailable(): boolean {
  try {
    const result = spawnSync('winget', ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000
    })
    return result.status === 0
  } catch {
    return false
  }
}

/** Executa um comando e retorna o resultado. */
function runCommand(command: string, args: string[]): Promise<InstallResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: 'ignore'
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        resolve({ success: false, error: `${command} saiu com código ${code}` })
      }
    })

    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
}

/** Verifica se o Kloud Games está instalado (pasta do Hub, estado salvo ou Program Files). */
export function isKloudGamesInstalled(): boolean {
  return findKloudGamesExe() !== null
}

/**
 * Instala o Kloud Games a partir do MSI embutido no instalador do Hub.
 * Procura o .exe primeiro; se não encontrar, abre o MSI (UAC) e salva os
 * caminhos em resources/programs/kloud-games/kloud-games.paths.json.
 */
export async function installKloudGames(): Promise<InstallResult> {
  const result = await ensureKloudGamesInstalled()
  if (result.success) {
    return { success: true, alreadyInstalled: result.installedNow === false }
  }
  return { success: false, error: result.error }
}

/** Instala o Python 3 usando winget (silencioso). */
export async function installPython(): Promise<InstallResult> {
  if (isWingetAvailable()) {
    return runCommand('winget', [
      'install',
      '--id',
      'Python.Python.3.12',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ])
  }

  return {
    success: false,
    error:
      'winget não encontrado. Instale o Python manualmente ou execute este app como administrador.'
  }
}
