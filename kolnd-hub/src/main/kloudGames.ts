import { app } from 'electron'
import { spawn, execFile } from 'child_process'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { promisify } from 'util'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

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
  /** Pasta resources\programs\kloud-games do Kolnd Hub (onde ficam o MSI e o exe embutidos; o estado persiste em userData). */
  dir: string
  /** true quando KLOUD_GAMES.exe está em execução no sistema. */
  running: boolean
}

const EXE_NAME = 'KLOUD_GAMES.exe'
const MSI_NAME = 'KLOUD_GAMES.msi'
const STATE_FILE = 'kloud-games.paths.json'
const LOG_FILE = join('logs', 'kloud-games-install.log')
const UNINSTALL_LOG_FILE = join('logs', 'kloud-games-uninstall.log')

/** Caminho do log de instalação em %APPDATA%\\kolnd-hub\\logs\\kloud-games-install.log. */
export function getKloudGamesInstallLogPath(): string {
  return join(app.getPath('userData'), LOG_FILE)
}

/** Caminho do log de desinstalação em %APPDATA%\\kolnd-hub\\logs\\kloud-games-uninstall.log. */
export function getKloudGamesUninstallLogPath(): string {
  return join(app.getPath('userData'), UNINSTALL_LOG_FILE)
}

/** Acrescenta uma entrada carimbada ao log de instalação. Best-effort: nunca lança. */
function appendKloudGamesLog(entry: string): void {
  try {
    const logPath = getKloudGamesInstallLogPath()
    mkdirSync(dirname(logPath), { recursive: true })
    const stamp = new Date().toISOString()
    appendFileSync(logPath, `[${stamp}] ${entry}\n`, 'utf8')
  } catch (err) {
    logger.warn(
      'kloud-games',
      'Não foi possível gravar o log de instalação:',
      err instanceof Error ? err.message : err
    )
  }
}

/** Acrescenta uma entrada carimbada ao log de desinstalação. Best-effort: nunca lança. */
export function appendKloudGamesUninstallLog(entry: string): void {
  try {
    const logPath = getKloudGamesUninstallLogPath()
    mkdirSync(dirname(logPath), { recursive: true })
    const stamp = new Date().toISOString()
    appendFileSync(logPath, `[${stamp}] ${entry}\n`, 'utf8')
  } catch (err) {
    logger.warn(
      'kloud-games',
      'Não foi possível gravar o log de desinstalação:',
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

/**
 * Caminho do arquivo JSON onde o Hub persiste os caminhos detectados.
 * Vive em %APPDATA%\\kolnd-hub (userData) — fora da pasta de instalação, para
 * que o estado não dependa de a pasta de recursos ser gravável nem possa ser
 * alterado por terceiros com acesso à árvore de instalação.
 * (O conteúdo antigo em resources/programs/kloud-games é migrado por
 * `migrateLegacyStateIfNeeded()` na primeira leitura/escrita.)
 */
export function getKloudGamesStatePath(): string {
  return join(app.getPath('userData'), STATE_FILE)
}

/** Caminho do estado legado (dentro da pasta de instalação/recursos). Só usado na migração. */
function getLegacyKloudGamesStatePath(): string {
  return join(getKloudGamesDir(), STATE_FILE)
}

/**
 * Migração automática do caminho antigo para o novo (01-1.2): se o arquivo
 * novo não existe e o legado existe, copia o conteúdo para o novo caminho e
 * renomeia o legado para `kloud-games.paths.json.migrated` (nunca apaga —
 * preserva exePath/installedAt/msiPath intactos). Best-effort: qualquer
 * falha é apenas logada; jamais lança nem perde o estado legado.
 */
function migrateLegacyStateIfNeeded(): void {
  try {
    const statePath = getKloudGamesStatePath()
    if (existsSync(statePath)) return // novo já existe — fonte de verdade
    const legacyPath = getLegacyKloudGamesStatePath()
    if (!existsSync(legacyPath)) return

    const raw = readFileSync(legacyPath, 'utf8')
    JSON.parse(raw) // valida antes de copiar — lixo/corrompido não migra

    const dir = dirname(statePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(statePath, raw, 'utf8')

    // Decisão de destino do legado: renomear para .migrated (não apagar).
    try {
      renameSync(legacyPath, `${legacyPath}.migrated`)
      logger.info(
        'kloud-games',
        `Estado migrado de ${legacyPath} para ${statePath} (legado renomeado para .migrated).`
      )
    } catch (renameErr) {
      logger.warn(
        'kloud-games',
        `Estado migrado para ${statePath}, mas não foi possível renomear o legado (${legacyPath}) — mantido como está:`,
        renameErr instanceof Error ? renameErr.message : renameErr
      )
    }
  } catch (err) {
    logger.warn(
      'kloud-games',
      'Falha na migração do kloud-games.paths.json legado — seguindo sem migrar (arquivo legado preservado):',
      err instanceof Error ? err.message : err
    )
  }
}

function emptyState(): KloudGamesPathsState {
  return { exePath: null, msiPath: null, installedAt: null, updatedAt: null }
}

/** Tenta ler o estado do disco. Retorna null quando ausente ou corrompido. */
function tryReadKloudGamesState(): KloudGamesPathsState | null {
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
    return null
  }
}

/** Lê o JSON de estado. Migra o legado se necessário. Tolerante a arquivo ausente/corrompido. */
export function readKloudGamesState(): KloudGamesPathsState {
  migrateLegacyStateIfNeeded()
  return tryReadKloudGamesState() ?? emptyState()
}

/** Compara os campos semânticos de dois estados (ignora `updatedAt`). */
function statesSemanticallyEqual(a: KloudGamesPathsState, b: KloudGamesPathsState): boolean {
  return a.exePath === b.exePath && a.msiPath === b.msiPath && a.installedAt === b.installedAt
}

/**
 * Persiste o JSON de estado em %APPDATA%\\kolnd-hub (userData). Best-effort:
 * falha aqui nunca deve impedir o Hub de abrir/fechar o Kloud Games. Só
 * escreve quando algo mudou de fato (comparação sem `updatedAt`) — chamadas
 * repetidas sem mudança não tocam o disco. Retorna true quando o estado
 * está persistido (ou já estava).
 */
export function writeKloudGamesState(state: KloudGamesPathsState): boolean {
  try {
    migrateLegacyStateIfNeeded()
    const statePath = getKloudGamesStatePath()
    // Só pula a escrita quando o arquivo existe, é parseável e o conteúdo
    // semântico é idêntico (updatedAt não força reescrita). Arquivo corrompido
    // é regravado normalmente.
    const current = tryReadKloudGamesState()
    if (current && statesSemanticallyEqual(current, state)) {
      return true
    }
    const dir = dirname(statePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8')
    return true
  } catch (err) {
    logger.warn(
      'kloud-games',
      `Não foi possível salvar ${getKloudGamesStatePath()}:`,
      err instanceof Error ? err.message : err
    )
    return false
  }
}

/**
 * Zera os campos de instalação do Kloud Games no kloud-games.paths.json (exePath,
 * installedAt) sem apagar o arquivo nem o msiPath — usado após a desinstalação para
 * que o fluxo de 1ª execução (`ensureKloudGamesInstalled`) possa reinstalar normalmente.
 * Retorna true quando conseguiu gravar.
 */
export function resetKloudGamesState(): boolean {
  try {
    // Estado zerado (exePath: null, installedAt: null) é o que garante que,
    // após uma desinstalação, ensureKloudGamesInstalled() reinstale o MSI
    // normalmente na próxima abertura do Hub. Nenhum fluxo de desinstalação
    // pode deixar restos que impeçam a reinstalação — apenas zera os campos.
    invalidateKloudGamesRunningCache()
    const state: KloudGamesPathsState = {
      exePath: null,
      msiPath: findKloudGamesMsi(),
      installedAt: null,
      updatedAt: new Date().toISOString()
    }
    return writeKloudGamesState(state)
  } catch {
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
 * Revalida todos os caminhos (exe/msi), atualiza o kloud-games.paths.json em
 * userData (somente quando algo mudou) e retorna o que foi encontrado.
 * Chamado pelo handler de status; escritas idênticas são elididas por
 * writeKloudGamesState.
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

/** TTL do cache do resultado de `isKloudGamesRunning()` (~2 s). */
const RUNNING_CACHE_TTL_MS = 2000

let runningCache: { value: boolean; at: number } | null = null

/**
 * Invalida o cache de execução. Chamado pelos fluxos de launch/stop/ensure
 * do Hub (e pela desinstalação), para que a próxima consulta ao status
 * reflita o processo real em vez do valor cacheado.
 */
export function invalidateKloudGamesRunningCache(): void {
  runningCache = null
}

/**
 * Verifica (via `tasklist`, com argumentos em array e sem shell) se o
 * KLOUD_GAMES.exe está em execução — independente de quem o abriu (Hub ou
 * manualmente). Assíncrono: não bloqueia o event loop do main. O resultado
 * fica cacheado por ~2 s (hits consecutivos não spawnam); em qualquer
 * falha retorna false para nunca impedir o Hub de abrir. A saída do
 * tasklist é localizada, então a checagem apenas procura o nome da imagem
 * (case-insensitive), sem depender de mensagens do sistema.
 */
export async function isKloudGamesRunning(): Promise<boolean> {
  const now = Date.now()
  if (runningCache && now - runningCache.at < RUNNING_CACHE_TTL_MS) {
    return runningCache.value
  }

  let value: boolean
  try {
    const { stdout } = await execFileAsync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${RUNNING_PROCESS_NAME}`, '/FO', 'CSV', '/NH'],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024
      }
    )
    value = String(stdout).toLowerCase().includes(RUNNING_PROCESS_NAME.toLowerCase())
  } catch {
    value = false
  }

  runningCache = { value, at: Date.now() }
  return value
}

/** Status consumido pelo renderer (tela de abrir do Hub). */
export async function getKloudGamesStatus(): Promise<KloudGamesStatus> {
  const { exePath, msiPath } = refreshKloudGamesPaths()
  return {
    installed: Boolean(exePath),
    exePath,
    msiPath,
    dir: getKloudGamesDir(),
    running: await isKloudGamesRunning()
  }
}

interface MsiInstallOutcome {
  success: boolean
  /** Código de saída do processo elevado (null quando nem chegou a iniciar). */
  exitCode: number | null
  error?: string
}

/** Detecta cancelamento do UAC a partir da saída do PowerShell (pt-BR/en, código 1223). */
export function looksLikeUacDenied(output: string): boolean {
  return /cancelad|cancelled|canceled|1223|operation was canceled|operação foi cancelada/i.test(
    output
  )
}

/** Códigos de saída do msiexec/Windows Installer tratados com mensagem própria. */
const MSIEXEC_USER_CANCEL = 1602 // ERROR_INSTALL_USEREXIT (assistente fechado/cancelado)
const MSIEXEC_OTHER_INSTALL_IN_PROGRESS = new Set([1500, 1618]) // outra instalação em andamento
const MSIEXEC_SUSPENDED_INSTALL = new Set([1704, 1705]) // instalação suspensa/pendente

/** Calcula o SHA-256 de um arquivo via stream (não bloqueia o event loop). */
function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Registra no log o SHA-256 do MSI embutido antes da instalação elevada.
 * Best-effort: qualquer falha é apenas logada e a instalação segue — a
 * verificação é informativa até a assinatura de código (tarefa 02-2.4).
 * Nunca bloqueia nem altera o fluxo da instalação.
 */
async function logMsiSha256BestEffort(msiPath: string): Promise<void> {
  try {
    const hash = await sha256File(msiPath)
    logger.info('kloud-games', `SHA-256 do MSI embutido: ${hash}`)
  } catch (err) {
    logger.info(
      'kloud-games',
      'Não foi possível calcular o SHA-256 do MSI (seguindo mesmo assim):',
      err instanceof Error ? err.message : err
    )
  }
}

/**
 * Abre o assistente de instalação do MSI de forma visível (a pessoa instala
 * manualmente). Elevamos via PowerShell (RunAs) e aguardamos o fim.
 * A saída do processo e o resultado ficam em %APPDATA%\\kolnd-hub\\logs\\kloud-games-install.log.
 */
async function launchInstallerElevated(msiPath: string): Promise<MsiInstallOutcome> {
  await logMsiSha256BestEffort(msiPath)

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
          error:
            'Instalação do Kloud Games cancelada no assistente. Você pode tentar de novo quando quiser.'
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
 *  4. Persiste tudo em %APPDATA%\\kolnd-hub\\kloud-games.paths.json (userData).
 */
export async function ensureKloudGamesInstalled(): Promise<KloudGamesEnsureResult> {
  // O fluxo pode mudar a instalação em disco — força reconsulta do tasklist.
  invalidateKloudGamesRunningCache()

  // Pular reinstalação: valida paths.json e/ou varre Program Files antes de instalar.
  const alreadyInstalled = findKloudGamesExe()
  if (alreadyInstalled) {
    const msiPath = findKloudGamesMsi()
    logger.info('kloud-games', 'já instalado — pulando')
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
  invalidateKloudGamesRunningCache()

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

/** Saída de uma ação elevada (abrir/parar) sobre o Kloud Games. */
export interface ElevatedKloudGamesOutcome {
  success: boolean
  error?: string
}

/**
 * Monta um literal de string do PowerShell. Aspas simples são escapadas por
 * duplicação — é o único escape que um literal `'...'` aceita, e ele evita que
 * um caminho com `$`/crases seja interpolado pelo PowerShell.
 */
export function psStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Roda um comando do PowerShell que dispara a elevação (UAC) e espera o shell
 * terminar. O processo elevado NÃO vira filho do Hub — por isso o estado do
 * Kloud Games é acompanhado por `tasklist` (ver `isKloudGamesRunning`).
 */
function runElevatedPowerShell(command: string): Promise<ElevatedKloudGamesOutcome> {
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

    child.on('error', (err) => {
      resolve({
        success: false,
        error: `Não foi possível chamar o PowerShell para elevar o Kloud Games: ${err.message}`
      })
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
        return
      }

      if (code === 1223 || looksLikeUacDenied(output)) {
        resolve({
          success: false,
          error:
            'Permissão negada (UAC). O Kloud Games precisa ser aberto como administrador — aceite o pedido do Windows e tente de novo.'
        })
        return
      }

      const detail = output.trim()
      resolve({
        success: false,
        error: `A elevação do Kloud Games falhou (código ${code ?? 'desconhecido'}).${
          detail ? ` Detalhes: ${detail}` : ''
        }`
      })
    })
  })
}

/**
 * Abre o KLOUD_GAMES **sempre elevado** (UAC), para qualquer conta do Windows.
 *
 * Motivo: o MSI instala em `C:\Program Files\KLOUD_GAMES` e o app guarda todo o
 * estado em `config\` lá dentro (log, `apps.json`, certificados em
 * `config\credentials`). O `migrate-config.bat` protege `credentials` de modo
 * que usuários comuns não conseguem nem ler os `.pem`; sem elevação o app morre
 * em `use_certificate_chain_file: Acesso negado` ao subir o HTTPS. Elevar em
 * toda abertura mantém o comportamento idêntico para usuários novos.
 */
export function launchKloudGamesElevated(exePath: string): Promise<ElevatedKloudGamesOutcome> {
  const exe = exePath.trim()
  if (!exe) {
    return Promise.resolve({ success: false, error: 'Caminho do Kloud Games vazio.' })
  }

  // `-ErrorAction Stop` faz o cancelamento do UAC virar exceção; o catch sai
  // com 1223 (ERROR_CANCELLED) para o Hub reconhecer o cancelamento.
  const command =
    `try { Start-Process -FilePath ${psStringLiteral(exe)} ` +
    `-WorkingDirectory ${psStringLiteral(dirname(exe))} -Verb RunAs -ErrorAction Stop } ` +
    `catch { Write-Error $_.Exception.Message; exit 1223 }`

  return runElevatedPowerShell(command)
}

/**
 * Encerra o KLOUD_GAMES elevado. O Hub não é elevado e não pode matar um
 * processo de alta integridade; o `taskkill` roda via UAC. Só é chamado quando
 * `processManager.stop()` não conseguiu (processo não rastreado pelo Hub).
 */
export async function stopKloudGamesElevated(): Promise<ElevatedKloudGamesOutcome> {
  if (!(await isKloudGamesRunning())) {
    return { success: false, error: 'Processo não está em execução' }
  }

  // taskkill /F /T derruba também os filhos (encoders, mDNS, tray).
  const command =
    `try { $p = Start-Process -FilePath 'taskkill.exe' ` +
    `-ArgumentList '/F','/T','/IM',${psStringLiteral(RUNNING_PROCESS_NAME)} ` +
    `-Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } ` +
    `catch { Write-Error $_.Exception.Message; exit 1223 }`

  const outcome = await runElevatedPowerShell(command)
  if (outcome.success) {
    invalidateKloudGamesRunningCache()
  }
  return outcome
}
