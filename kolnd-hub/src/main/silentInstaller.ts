import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface InstallResult {
  success: boolean
  error?: string
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

/** Verifica se o Kloud Games está instalado (Program Files). */
export function isKloudGamesInstalled(): boolean {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  return existsSync(join(programFiles, 'KLOUD_GAMES', 'KLOUD_GAMES.exe'))
}

/** Caminho da pasta de programas embutida no instalador do Hub. */
function getBundledProgramsDir(): string {
  // Em produção, os recursos extras ficam em <install-dir>/resources/programs.
  // Em dev, ficam em <project>/resources/programs.
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'programs')
  }
  return join(process.cwd(), 'resources', 'programs')
}

/** Instala o Kloud Games a partir do MSI embutido no instalador do Hub. */
export async function installKloudGames(): Promise<InstallResult> {
  if (isKloudGamesInstalled()) {
    return { success: true }
  }

  const msiPath = join(getBundledProgramsDir(), 'kloud-games', 'KLOUD_GAMES.msi')
  if (!existsSync(msiPath)) {
    return {
      success: false,
      error: `MSI do Kloud Games não encontrado em ${msiPath}. Gere-o a partir de kloud-games/ (ver README em resources/programs/kloud-games/).`
    }
  }

  // O MSI é per-machine: sem privilégios administrativos, o Windows abre o
  // prompt do UAC. Elevamos via PowerShell (RunAs) e aguardamos o fim.
  const escapedMsi = msiPath.replace(/'/g, "''")
  const command = `$p = Start-Process msiexec.exe -ArgumentList '/i "${escapedMsi}" /quiet /norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`

  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      stdio: 'ignore'
    })

    child.on('close', (code) => {
      if (code === 0 || isKloudGamesInstalled()) {
        resolve({ success: true })
      } else {
        resolve({
          success: false,
          error: `Instalação do Kloud Games falhou (msiexec saiu com código ${code}). Execute como administrador ou aprove o UAC.`
        })
      }
    })

    child.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })
  })
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
    error: 'winget não encontrado. Instale o Python manualmente ou execute este app como administrador.'
  }
}
