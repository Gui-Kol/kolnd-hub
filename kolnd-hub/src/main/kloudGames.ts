import { app } from 'electron'
import { spawn, execFileSync } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
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
  /** true quando KLOUD_GAMES.exe está em execução no sistema. */
  running: boolean
}

const EXE_NAME = 'KLOUD_GAMES.exe'
const MSI_NAME = 'KLOUD_GAMES.msi'
const STATE_FILE = 'kloud-games.paths.json'
const LOG_FILE = join('logs', 'kloud-games-install.log')

/** Caminho do log de instalação em %APPDATA%\\kolnd-hub\\logs\\kloud-games-install.log. */
export function getKloudGamesInstallLogPath(): string {
  return join(app.getPath('userData'), LOG_FILE)
}

/** Acrescenta uma entrada carimbada ao log de instalação. Best-effort: nunca lança. */
function appendKloudGamesLog(entry: string): void {
  try {
    const logPath = getKloudGamesInstallLogPath()
    mkdirSync(dirname(logPath), { recursive: true })
    const stamp = new Date().toISOString()
    appendFileSync(logPath, `[${stamp}] ${entry}\n`, 'utf8')
  } catch (err) {
    console.warn(
      '[kloud-games] Não foi possível gravar o log de instalação:',
      err instanceof Error ? err.message : err
    )
  }
}

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
    if (entry.isDirectory() && !['node_modules', '_internal'].includes(entry.name.toLowerCase())) {
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

/** Pastas-raiz onde varrer por KLOUD_GAMES.exe (profundidade ≤ 3). */
function programFilesScanDirs(): string[] {
  const dirs: string[] = []
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const programW6432 = process.env['ProgramW6432']

  dirs.push(join(programFiles, 'KLOUD_GAMES'))
  // Visão 32-bit gravada em disco sob a pasta de 64 bits (equivalente ao WOW6432Node).
  dirs.push(join(programFiles, 'WOW6432Node', 'KLOUD_GAMES'))
  if (programW6432) dirs.push(join(programW6432, 'KLOUD_GAMES'))
  if (programFilesX86) dirs.push(join(programFilesX86, 'KLOUD_GAMES'))

  return dirs
}

/** Localiza o KLOUD_GAMES.exe. Ordem: estado salvo → pasta do Hub → Program Files → varredura (profundidade ≤ 3). */
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

  // 3) Varredura limitada (profundidade ≤ 3) nas pastas do MSI.
  for (const dir of programFilesScanDirs()) {
    const found = walkForExe(dir)
    if (found) {
      return found
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

/** Nome do processo do jogo no Gerenciador de Tarefas. */
const RUNNING_PROCESS_NAME = 'KLOUD_GAMES.exe'

/**
 * Verifica (via `tasklist`, com argumentos em array e sem shell) se o
 * KLOUD_GAMES.exe está em execução — independente de quem o abriu (Hub ou
 * manualmente). Síncrono e barato; em qualquer falha retorna false para
 * nunca impedir o Hub de abrir. A saída do tasklist é localizada, então a
 * checagem apenas procura o nome da imagem (case-insensitive), sem depender
 * de mensagens do sistema.
 */
export function isKloudGamesRunning(): boolean {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${RUNNING_PROCESS_NAME}`, '/FO', 'CSV', '/NH'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024
      }
    )
    return out.toLowerCase().includes(RUNNING_PROCESS_NAME.toLowerCase())
  } catch {
    return false
  }
}

/** Status consumido pelo renderer (tela de abrir do Hub). */
export function getKloudGamesStatus(): KloudGamesStatus {
  const { exePath, msiPath } = refreshKloudGamesPaths()
  return {
    installed: Boolean(exePath),
    exePath,
    msiPath,
    dir: getKloudGamesDir(),
    running: isKloudGamesRunning()
  }
}

interface MsiInstallOutcome {
  success: boolean
  /** Código de saída do processo elevado (null quando nem chegou a iniciar). */
  exitCode: number | null
  error?: string
}

/** Detecta cancelamento do UAC a partir da saída do PowerShell (pt-BR/en, código 1223). */
function looksLikeUacDenied(output: string): boolean {
  return /cancelad|cancelled|canceled|1223|operation was canceled|operação foi cancelada/i.test(
    output
  )
}

/** Códigos de saída do msiexec/Windows Installer tratados com mensagem própria. */
const MSIEXEC_USER_CANCEL = 1602 // ERROR_INSTALL_USEREXIT (assistente fechado/cancelado)
const MSIEXEC_OTHER_INSTALL_IN_PROGRESS = new Set([1500, 1618]) // outra instalação em andamento
const MSIEXEC_SUSPENDED_INSTALL = new Set([1704, 1705]) // instalação suspensa/pendente

/**
 * Abre o assistente de instalação do MSI de forma visível (a pessoa instala
 * manualmente). Elevamos via PowerShell (RunAs) e aguardamos o fim.
 * A saída do processo e o resultado ficam em %APPDATA%\\kolnd-hub\\logs\\kloud-games-install.log.
 */
function launchInstallerElevated(msiPath: string): Promise<MsiInstallOutcome> {
  const logPath = getKloudGamesInstallLogPath()
  // O MSI é per-machine: sem privilégios administrativos, o Windows abre o
  // prompt do UAC. Aqui NÃO usamos /quiet — a pessoa vê e conclui o assistente.
  const escapedMsi = msiPath.replace(/'/g, "''")
  const command = `$p = Start-Process msiexec.exe -ArgumentList '/i "${escapedMsi}" /norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`

  appendKloudGamesLog(
    `Início da instalação do Kloud Games\nMSI: ${msiPath}\nComando: powershell.exe -NoProfile -Command ${command}`
  )

  return new Promise((resolve) => {
    let output = ''
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      output += chunk.toString()
    })

    child.on('close', (code) => {
      const exitCode = code ?? null
      appendKloudGamesLog(
        `Código de saída do processo elevado: ${exitCode ?? 'desconhecido'}\nSaída:\n${
          output.trim() || '(sem saída)'
        }`
      )

      if (code === 0) {
        resolve({ success: true, exitCode })
        return
      }

      // UAC negado pelo usuário: o Start-Process -Verb RunAs falha com 1223/cancelado.
      if (looksLikeUacDenied(output)) {
        appendKloudGamesLog('Motivo: permissão negada (UAC cancelado pelo usuário).')
        resolve({
          success: false,
          exitCode,
          error:
            'Permissão negada (UAC). A instalação do Kloud Games foi pulada; você pode ativá-la depois tentando de novo.'
        })
        return
      }

      // Assistente cancelado pelo usuário (fechou a janela / clicou em Cancelar).
      if (exitCode === MSIEXEC_USER_CANCEL) {
        appendKloudGamesLog('Motivo: instalação cancelada pelo usuário no assistente.')
        resolve({
          success: false,
          exitCode,
          error: 'Instalação do Kloud Games cancelada no assistente. Você pode tentar de novo quando quiser.'
        })
        return
      }

      if (exitCode !== null && MSIEXEC_OTHER_INSTALL_IN_PROGRESS.has(exitCode)) {
        appendKloudGamesLog('Motivo: outra instalação do Windows em andamento.')
        resolve({
          success: false,
          exitCode,
          error: `Outra instalação do Windows está em andamento (código ${exitCode}). Aguarde-a terminar (ou reinicie o PC) e tente de novo. Veja o log em ${logPath}.`
        })
        return
      }

      if (exitCode !== null && MSIEXEC_SUSPENDED_INSTALL.has(exitCode)) {
        appendKloudGamesLog('Motivo: instalação do Kloud Games suspensa/pendente.')
        resolve({
          success: false,
          exitCode,
          error: `Há uma instalação do Kloud Games pendente/suspensa (código ${exitCode}). Abra o assistente manualmente e clique em desfazer, ou reinicie o PC e tente de novo. Veja o log em ${logPath}.`
        })
        return
      }

      resolve({
        success: false,
        exitCode,
        error: `A instalação do Kloud Games falhou (msiexec saiu com código ${
          exitCode ?? 'desconhecido'
        }). Veja o log em ${logPath}.`
      })
    })

    child.on('error', (err) => {
      appendKloudGamesLog(`Falha ao iniciar o processo elevado: ${err.message}`)
      resolve({
        success: false,
        exitCode: null,
        error: `Não foi possível iniciar a instalação elevada: ${err.message}. Veja o log em ${logPath}.`
      })
    })
  })
}

/**
 * Garante que o Kloud Games esteja instalado:
 *  1. Procura o .exe (estado salvo → pasta do Hub → Program Files → varredura ≤ 3);
 *     se encontrar, não reinstala — registra "[kloud-games] já instalado — pulando";
 *  2. Se não achar, abre o MSI embutido para instalação (UAC);
 *  3. Após instalar, confirma a existência real do .exe antes de reportar sucesso;
 *  4. Persiste tudo em resources/programs/kloud-games/kloud-games.paths.json.
 */
export async function ensureKloudGamesInstalled(): Promise<KloudGamesEnsureResult> {
  // Pular reinstalação: valida paths.json e/ou varre Program Files antes de instalar.
  const alreadyInstalled = findKloudGamesExe()
  if (alreadyInstalled) {
    const msiPath = findKloudGamesMsi()
    console.log('[kloud-games] já instalado — pulando')
    appendKloudGamesLog(`Já instalado em ${alreadyInstalled} — instalação pulada.`)
    writeKloudGamesState({
      exePath: alreadyInstalled,
      msiPath,
      installedAt: readKloudGamesState().installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    return { success: true, exePath: alreadyInstalled, msiPath, installedNow: false }
  }

  const msiPath = findKloudGamesMsi()
  if (!msiPath) {
    const expected = join(getKloudGamesDir(), MSI_NAME)
    const error = `O MSI do Kloud Games está ausente no instalador (${expected}). Gere-o a partir de kloud-games/ (ver README em resources/programs/kloud-games/).`
    appendKloudGamesLog(`MSI ausente: ${expected}`)
    return {
      success: false,
      msiPath: null,
      error
    }
  }

  const install = await launchInstallerElevated(msiPath)

  // Verificação pós-instalação: estado salvo → Program Files → varredura ≤ 3.
  const exePath = findKloudGamesExe()

  if (exePath) {
    writeKloudGamesState({
      exePath,
      msiPath,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    if (!install.success) {
      appendKloudGamesLog(
        `msiexec retornou código ${install.exitCode ?? 'desconhecido'}, mas o exe foi detectado — considerando instalado.`
      )
    }
    return { success: true, exePath, msiPath, installedNow: true }
  }

  const logPath = getKloudGamesInstallLogPath()
  const error =
    install.error ??
    `O instalador terminou, mas o KLOUD_GAMES.exe não foi encontrado (verificados paths.json, Program Files e varredura de profundidade ≤ 3). Veja o log em ${logPath}.`

  appendKloudGamesLog(`Falha na verificação pós-instalação: ${error}`)

  // MSI rodou (ou não), mas o exe não apareceu (ou UAC negado): persiste o que sabemos.
  writeKloudGamesState({
    exePath: null,
    msiPath,
    installedAt: null,
    updatedAt: new Date().toISOString()
  })

  return {
    success: false,
    msiPath,
    error
  }
}
