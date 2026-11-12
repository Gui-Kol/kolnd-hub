import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface KloudGamesPathsState {
  /** Caminho absoluto do KLOUD_GAMES.exe (null se ainda não detectado). */
  exePath: string | null
  /** Caminho absoluto do KLOUD_GAMES.msi embutido no Hub (null se ausente/movido). */
  msiPath: string | null
  /** ISO timestamp de quando a instalação foi detectada/concluída pelo Hub. */
  installedAt: string | null
  /** ISO timestamp da última vez que o Hub atualizou este arquivo. */
  updatedAt: string | null
}

export interface KloudGamesEnsureResult {
  success: boolean
  /** Caminho do exe quando encontrado/instalado com sucesso. */
  exePath?: string
  /** Caminho do MSI embutido. */
  msiPath?: string | null
  /** true quando o fluxo precisou instalar o MSI nesta chamada. */
  installedNow?: boolean
  error?: string
}

export interface KloudGamesStatus {
  installed: boolean
  exePath: string | null
  msiPath: string | null
  /** Pasta resources\programs\kloud-games do Kolnd Hub (onde o .paths.json vive). */
  dir: string
}

const EXE_NAME = 'KLOUD_GAMES.exe'
const MSI_NAME = 'KLOUD_GAMES.msi'
const STATE_FILE = 'kloud-games.paths.json'

/** Pasta resources/programs/kloud-games (resourcesPath em produção, cwd em dev). */
export function getKloudGamesDir(): string {
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'programs', 'kloud-games')
  }
  return join(process.cwd(), 'resources', 'programs', 'kloud-games')
}

/** Caminho do arquivo JSON onde o Hub persiste os caminhos detectados. */
export function getKloudGamesStatePath(): string {
  return join(getKloudGamesDir(), STATE_FILE)
}

function emptyState(): KloudGamesPathsState {
  return { exePath: null, msiPath: null, installedAt: null, updatedAt: null }
}

/** Lê o JSON de estado. Tolerante a arquivo ausente/corrompido. */
export function readKloudGamesState(): KloudGamesPathsState {
  try {
    const raw = readFileSync(getKloudGamesStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<KloudGamesPathsState>
    return {
      exePath: typeof parsed.exePath === 'string' ? parsed.exePath : null,
      msiPath: typeof parsed.msiPath === 'string' ? parsed.msiPath : null,
      installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null
    }
  } catch {
    return emptyState()
  }
}

/**
 * Grava o JSON de estado em resources/programs/kloud-games. Best-effort:
 * em produção a pasta pode ser somente leitura (dentro de Program Files),
 * então falha aqui nunca deve impedir o Hub de abrir/fechar o Kloud Games.
 * Retorna true quando conseguiu gravar.
 */
export function writeKloudGamesState(state: KloudGamesPathsState): boolean {
  try {
    const dir = getKloudGamesDir()
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(getKloudGamesStatePath(), JSON.stringify(state, null, 2) + '\n', 'utf8')
    return true
  } catch (err) {
    console.warn(
      `[kloud-games] Não foi possível salvar ${getKloudGamesStatePath()}:`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}

/** Busca limitada por KLOUD_GAMES.exe dentro de uma pasta (profundidade/entradas limitadas). */
function walkForExe(dir: string, depth = 0): string | null {
  if (depth > 3) return null

  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === EXE_NAME.toLowerCase()) {
      return join(dir, entry.name)
    }
  }

  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      !['node_modules', '_internal'].includes(entry.name.toLowerCase())
    ) {
      const found = walkForExe(join(dir, entry.name), depth + 1)
      if (found) return found
    }
  }

  return null
}

/** Candidatos conhecidos de instalação per-machine (MSI instala em Program Files). */
function programFilesCandidates(): string[] {
  const candidates: string[] = []
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const programW6432 = process.env['ProgramW6432']

  candidates.push(join(programFiles, 'KLOUD_GAMES', EXE_NAME))
  if (programW6432) candidates.push(join(programW6432, 'KLOUD_GAMES', EXE_NAME))
  if (programFilesX86) candidates.push(join(programFilesX86, 'KLOUD_GAMES', EXE_NAME))

  return candidates
}

/** Localiza o KLOUD_GAMES.exe. Ordem: estado salvo → pasta do Hub → Program Files. */
export function findKloudGamesExe(): string | null {
  const saved = readKloudGamesState().exePath
  if (saved && existsSync(saved)) {
    return saved
  }

  // 1) Dentro de resources/programs/kloud-games (build portable/copiado manualmente).
  const inHubDir = walkForExe(getKloudGamesDir())
  if (inHubDir) {
    return inHubDir
  }

  // 2) Locais padrão do MSI (Program Files).
  for (const candidate of programFilesCandidates()) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

/** Localiza o MSI embutido em resources/programs/kloud-games. */
export function findKloudGamesMsi(): string | null {
  const msi = join(getKloudGamesDir(), MSI_NAME)
  return existsSync(msi) ? msi : null
}

/**
 * Revalida todos os caminhos (exe/msi), atualiza o kloud-games.paths.json e
 * retorna o que foi encontrado. Chamado a cada abertura/consulta de status.
 */
export function refreshKloudGamesPaths(): { exePath: string | null; msiPath: string | null } {
  const saved = readKloudGamesState()
  const msiPath = findKloudGamesMsi() ?? saved.msiPath
  const exePath = findKloudGamesExe()

  writeKloudGamesState({
    exePath,
    msiPath,
    installedAt: exePath ? (saved.installedAt ?? new Date().toISOString()) : null,
    updatedAt: new Date().toISOString()
  })

  return { exePath, msiPath }
}

/** Status consumido pelo renderer (tela de abrir do Hub). */
export function getKloudGamesStatus(): KloudGamesStatus {
  const { exePath, msiPath } = refreshKloudGamesPaths()
  return {
    installed: Boolean(exePath),
    exePath,
    msiPath,
    dir: getKloudGamesDir()
  }
}

/** Instala o MSI elevado via msiexec /quiet (mesmo fluxo da primeira execução). */
function installMsiElevated(msiPath: string): Promise<{ success: boolean; error?: string }> {
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
      if (code === 0 || findKloudGamesExe()) {
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

/**
 * Garante que o Kloud Games esteja instalado:
 *  1. Procura o .exe (estado salvo → pasta do Hub → Program Files);
 *  2. Se não achar, abre o MSI embutido para instalação (UAC);
 *  3. Após instalar, detecta o caminho do .exe e salva tudo em
 *     resources/programs/kloud-games/kloud-games.paths.json.
 */
export async function ensureKloudGamesInstalled(): Promise<KloudGamesEnsureResult> {
  const before = refreshKloudGamesPaths()
  if (before.exePath) {
    return { success: true, exePath: before.exePath, msiPath: before.msiPath, installedNow: false }
  }

  const msiPath = findKloudGamesMsi()
  if (!msiPath) {
    return {
      success: false,
      msiPath: null,
      error: `KLOUD_GAMES.exe não encontrado e o MSI não está em ${join(getKloudGamesDir(), MSI_NAME)}. Gere-o a partir de kloud-games/ (ver README em resources/programs/kloud-games/).`
    }
  }

  const install = await installMsiElevated(msiPath)
  const exePath = findKloudGamesExe()

  if (install.success && exePath) {
    writeKloudGamesState({
      exePath,
      msiPath,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    return { success: true, exePath, msiPath, installedNow: true }
  }

  // MSI rodou mas o exe não apareceu (ou UAC negado): persiste o que sabemos.
  writeKloudGamesState({
    exePath: null,
    msiPath,
    installedAt: null,
    updatedAt: new Date().toISOString()
  })

  return {
    success: false,
    msiPath,
    error:
      install.error ??
      'O instalador terminou, mas o KLOUD_GAMES.exe não foi encontrado em Program Files.'
  }
}
