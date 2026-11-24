import { app, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { isAbsolute, join } from 'path'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import { isUacCancelled } from '../hwmon/uac'
import { runPowerShellCommand, runProcess, type ProcessResult } from '../hwmon/powershell'
import type {
  FpsAutoActionResult,
  FpsAutoReason,
  FpsAutoSample,
  FpsAutoState,
  FpsAutoStatus,
  FpsUpdate
} from '../../shared/fps'
import { FPS_LEGACY_AGENT_TASK_NAME } from '../../shared/fps'
import {
  buildEnsureProtectedHelperScript,
  encodePowerShell,
  ensureStagedHelper,
  resolveFpsProtectedPaths,
  sha256File,
  type FpsProtectedPaths
} from './helper'
import { resolveFpsSinkDir } from './paths'
import { isIgnoredProcess } from './target'

export { resolveFpsSinkDir } from './paths'

/**
 * FPS automático sem prompt por uso.
 *
 * O Windows só permite abrir uma sessão ETW em tempo real com elevação
 * (verificado: `logman create trace -ets` → acesso negado). Como não existe
 * rota sem elevação, o Hub instala UMA tarefa agendada no logon
 * (`KolndHubFpsAgent`, `schtasks /sc onlogon /rl highest`) que roda o helper já
 * existente em modo `--sink <dir>`. O agent grava `latest.json` (atômico, 1 Hz)
 * em `%ProgramData%\Kolnd Hub\fps`; o Hub apenas LÊ o arquivo — sem privilégio,
 * sem UAC a cada jogo. Amostra com mais de 3 s = stale → a UI mostra "—".
 *
 * Nunca elevamos nada silenciosamente: instalar/remover abre um UAC explícito
 * iniciado por clique na UI, com texto claro. O diretório do sink é
 * configurável por `KOLDND_HUB_FPS_DIR` para os testes E2E.
 */

export const FPS_AUTO_TASK_NAME = FPS_LEGACY_AGENT_TASK_NAME
export const FPS_AUTO_FILE = 'latest.json'
export const FPS_AUTO_STALE_MS = 3_000
const FPS_AUTO_POLL_MS = 1_000
const FPS_AUTO_QUERY_MS = 60_000
const FPS_AUTO_MAX_SAMPLE_BYTES = 64 * 1024
const FPS_AUTO_UAC_TIMEOUT_MS = 120_000

// ── Caminhos e comandos (puros, exportados para teste) ─────────

/** `true` quando há aspas/quebra de linha/caractere de controle (injeção). */
function hasUnsafeChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
    if (value[index] === '"') return true
  }
  return false
}

/** `true` quando o caminho pode entrar no comando da tarefa sem escapes. */
function isSafeCommandPath(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && isAbsolute(value) && !hasUnsafeChars(value)
}

function currentSinkDir(): string {
  return resolveFpsSinkDir(
    process.env.ProgramData ?? 'C:\\ProgramData',
    process.env.KOLDND_HUB_FPS_DIR
  )
}

function currentLatestPath(): string {
  return join(currentSinkDir(), FPS_AUTO_FILE)
}

export interface FpsAgentTaskOptions {
  exePath: string
  sinkDir: string
  taskName?: string
}

/** Ação da tarefa: helper em modo agent, sem heartbeat/limite (roda até sair). */
export function buildFpsAgentTaskAction(options: FpsAgentTaskOptions): string {
  if (!isSafeCommandPath(options.exePath) || !isSafeCommandPath(options.sinkDir)) {
    throw new Error('Caminho inválido para a tarefa de FPS.')
  }
  // `--minutes 0` = sem limite: o agent fica vivo enquanto a sessão do usuário
  // durar; a tarefa é reexecutada no próximo logon.
  return `"${options.exePath}" --sink "${options.sinkDir}" --minutes 0 --session KolndHubFps`
}

/** Argumentos de `schtasks /Create` para a tarefa no logon (elevada). */
export function buildFpsAgentCreateArgs(options: FpsAgentTaskOptions): string[] {
  return [
    '/Create',
    '/TN',
    options.taskName ?? FPS_AUTO_TASK_NAME,
    '/TR',
    buildFpsAgentTaskAction(options),
    '/SC',
    'ONLOGON',
    '/RL',
    'HIGHEST',
    '/F'
  ]
}

/** Argumentos de `schtasks /Delete`. */
export function buildFpsAgentDeleteArgs(taskName: string = FPS_AUTO_TASK_NAME): string[] {
  return ['/Delete', '/TN', taskName, '/F']
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

function psArgList(values: string[]): string {
  return values.map((value) => `'${psQuote(value)}'`).join(' ')
}

export interface FpsAgentInstallOptions {
  stagingExePath: string
  sha256: string
  protectedPaths: FpsProtectedPaths
  sinkDir: string
  taskName?: string
}

/**
 * Script que roda ELEVADO (UAC único): encerra a instância antiga, copia o
 * helper para `%ProgramData%` com hash conferido e ACL explícita, garante
 * leitura do sink para `Usuários` (S-1-5-32-545) e registra a tarefa no logon
 * com `HIGHEST` — apontando SÓ para a cópia protegida.
 */
export function buildFpsAgentInstallScript(options: FpsAgentInstallOptions): string {
  if (!isSafeCommandPath(options.sinkDir)) {
    throw new Error('Diretório do agent inválido.')
  }
  const taskName = options.taskName ?? FPS_AUTO_TASK_NAME
  const ensureScript = buildEnsureProtectedHelperScript({
    stagingExePath: options.stagingExePath,
    expectedSha256: options.sha256,
    protectedPaths: options.protectedPaths
  })
  return [
    "$ErrorActionPreference = 'Stop'",
    // Best-effort: encerra a instância antiga antes de trocar o binário.
    `& schtasks.exe /End /TN '${psQuote(taskName)}' 2>$null | Out-Null`,
    ensureScript,
    `New-Item -ItemType Directory -Force -Path '${psQuote(options.sinkDir)}' | Out-Null`,
    `& icacls.exe '${psQuote(options.sinkDir)}' /grant '*S-1-5-32-545:(OI)(CI)RX' /T /C | Out-Null`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    `& schtasks.exe ${psArgList(
      buildFpsAgentCreateArgs({
        exePath: options.protectedPaths.exePath,
        sinkDir: options.sinkDir,
        taskName
      })
    )}`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    'exit 0'
  ].join('\r\n')
}

/** Script elevado de remoção: encerra a instância, apaga a tarefa e a amostra. */
export function buildFpsAgentRemoveScript(
  sinkDir: string,
  taskName: string = FPS_AUTO_TASK_NAME
): string {
  if (!isSafeCommandPath(sinkDir)) {
    throw new Error('Diretório do agent inválido.')
  }
  return [
    "$ErrorActionPreference = 'Continue'",
    `& schtasks.exe /End /TN '${psQuote(taskName)}' 2>$null | Out-Null`,
    `& schtasks.exe ${psArgList(buildFpsAgentDeleteArgs(taskName))}`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(join(sinkDir, FPS_AUTO_FILE))}'`,
    'exit 0'
  ].join('\r\n')
}

/**
 * Comando que PEDE O UAC e executa o script elevado. O script vai por
 * `-EncodedCommand` (UTF-16LE/base64) — nada é gravado em disco antes do UAC,
 * então não existe `.ps1` em `%APPDATA%` para ser trocado entre a gravação e o
 * clique. O PowerShell externo espera o processo elevado (`-Wait`) para o main
 * saber o código real.
 */
export function buildFpsAgentElevationCommand(script: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encodePowerShell(
        script
      )}') -Verb RunAs -Wait -PassThru`,
    'exit $p.ExitCode'
  ].join('; ')
}

/**
 * Interpreta `schtasks /Query`. `true` = tarefa existe, `false` = não existe,
 * `null` = não deu para saber (timeout/erro inesperado) — nunca inventamos
 * "instalado" a partir de saída vazia.
 */
export function interpretFpsAgentQuery(result: ProcessResult): boolean | null {
  if (result.timedOut) return null
  const output = `${result.stdout}\n${result.stderr}`
  if (result.code === 0) {
    return /TaskName:\s*\\?KolndHubFpsAgent/i.test(output) ? true : null
  }
  if (
    /cannot find|does not exist|n[ãa]o (?:é|e|foi )?poss[íi]vel encontrar|n[ãa]o pode (?:ser )?encontrar|n[ãa]o existe/i.test(
      output
    )
  ) {
    return false
  }
  return null
}

// ── Amostra `latest.json` (pura, exportada para teste) ─────────

export interface ParsedFpsAutoLatest {
  /** Arquivo existe, parseou e o timestamp está dentro de 3 s. */
  fresh: boolean
  /** Alvo válido (não ignorado) — `null` quando não há jogo em primeiro plano. */
  sample: FpsAutoSample | null
  /** Epoch ms do timestamp do agent (null quando ilegível). */
  capturedAtMs: number | null
  /** Timestamp válido, mas fora da janela de 3 s. */
  stale?: boolean
  /** Motivo publicado pelo coletor quando não havia alvo (`no-target`/`no-presents`). */
  reason?: FpsAutoReason
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return false
}

function readSampleName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 260 || hasControlChars(trimmed)) return null
  return trimmed
}

function finiteInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < min || value > max) return null
  return value
}

/**
 * Valida a amostra do agent. O renderer/main não confiam no arquivo: qualquer
 * campo fora do contrato invalida a amostra (nunca exibimos número inventado).
 */
export function parseFpsAutoLatest(input: unknown, nowMs: number): ParsedFpsAutoLatest {
  const empty: ParsedFpsAutoLatest = { fresh: false, sample: null, capturedAtMs: null }
  if (!isRecord(input)) return empty
  if (typeof input.timestamp !== 'string') return empty
  const capturedAtMs = Date.parse(input.timestamp)
  if (!Number.isFinite(capturedAtMs)) return empty
  // Toleramos até 5 s no futuro (clock/rounding); velho/ausente é stale.
  const age = nowMs - capturedAtMs
  if (age > FPS_AUTO_STALE_MS || age < -5_000) {
    return { fresh: false, sample: null, capturedAtMs, stale: true }
  }

  const pid =
    typeof input.pid === 'number' && Number.isSafeInteger(input.pid) && input.pid > 0
      ? input.pid
      : null
  const name = readSampleName(input.name)
  const fps = finiteInRange(input.fps, 0, 100_000)
  const frametimeMs = finiteInRange(input.frametimeMs, 0, 60_000)
  const reason =
    input.reason === 'no-target' || input.reason === 'no-presents' ? input.reason : undefined

  // Arquivo fresco sem alvo é um estado válido (desktop/Explorer em primeiro
  // plano) — mantém `fresh: true` para a UI distinguir de "agent parado".
  if (pid === null || !name || fps === null || frametimeMs === null) {
    return { fresh: true, sample: null, capturedAtMs, reason: reason ?? 'no-target' }
  }
  if (isIgnoredProcess(name)) {
    return { fresh: true, sample: null, capturedAtMs, reason: reason ?? 'no-target' }
  }

  return {
    fresh: true,
    sample: { pid, name, fps, frametimeMs, timestamp: input.timestamp },
    capturedAtMs
  }
}

/** Lê e valida o `latest.json`; arquivo ausente/ilegível = stale. */
export async function readFpsAutoLatestFile(
  path: string,
  nowMs: number
): Promise<ParsedFpsAutoLatest> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > FPS_AUTO_MAX_SAMPLE_BYTES) {
      return { fresh: false, sample: null, capturedAtMs: null }
    }
    const text = await fs.readFile(path, 'utf8')
    return parseFpsAutoLatest(JSON.parse(text) as unknown, nowMs)
  } catch {
    return { fresh: false, sample: null, capturedAtMs: null }
  }
}

// ── Estado (polling de 1 s) ────────────────────────────────────

let context: IpcContext | null = null
let timer: ReturnType<typeof setInterval> | null = null
let pollBusy = false
let installed: boolean | null = null
let installing = false
let removing = false
let lastError: string | undefined
let lastParsed: ParsedFpsAutoLatest = { fresh: false, sample: null, capturedAtMs: null }
let lastSignature = ''
let lastQueryAt = 0
let started = false

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Traduz a amostra em estado + motivo do "—". Pura e exportada para teste: a
 * UI distingue "fonte parada" de "amostra velha" e de "sem alvo" sem inventar
 * FPS. `installed` é a tarefa LEGADA: quando ela ainda existe e não há arquivo,
 * o estado é `stale` (o agente deveria publicar e não publica).
 */
export function deriveFpsAutoStatus(
  parsed: ParsedFpsAutoLatest,
  installedNow: boolean | null
): { state: FpsAutoState; reason?: FpsAutoReason } {
  if (parsed.fresh) {
    if (parsed.sample) return { state: 'running' }
    return { state: 'running', reason: parsed.reason ?? 'no-target' }
  }
  if (parsed.stale || parsed.capturedAtMs !== null || installedNow === true) {
    return { state: 'stale', reason: 'stale' }
  }
  return { state: 'off', reason: 'source-stopped' }
}

function autoStatus(): Pick<FpsAutoStatus, 'state' | 'reason'> {
  const derived = deriveFpsAutoStatus(lastParsed, installed)
  if (installing) return { state: 'installing' }
  if (lastError) return { state: 'error' }
  return derived
}

function currentStatus(): FpsAutoStatus {
  const derived = autoStatus()
  const status: FpsAutoStatus = {
    state: derived.state,
    installed: installed === true,
    sample: lastParsed.sample,
    sinkDir: currentSinkDir(),
    fresh: lastParsed.fresh
  }
  if (derived.reason) status.reason = derived.reason
  if (lastError) status.error = lastError
  return status
}

function sendStatus(force = false): void {
  const status = currentStatus()
  const signature = [
    status.state,
    status.reason ?? '',
    status.fresh ? '1' : '0',
    status.installed ? '1' : '0',
    status.sample?.pid ?? 0,
    status.sample?.timestamp ?? '',
    status.sample?.fps ?? '',
    status.error ?? ''
  ].join('|')
  if (!force && signature === lastSignature) return
  lastSignature = signature
  const window = context?.getMainWindow()
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send('fps:auto-update', status)
  } catch {
    // Janela fechando entre a checagem e o envio: o próximo tick não envia.
  }
}

async function queryTask(force = false): Promise<void> {
  const now = Date.now()
  if (!force && now - lastQueryAt < FPS_AUTO_QUERY_MS) return
  lastQueryAt = now
  installed = await isFpsAutoInstalled()
}

/**
 * Consulta a tarefa no Windows sem elevação. `null` = não deu para saber
 * (timeout/saída inesperada) — quem chama decide; nunca inventamos "instalado".
 */
export async function isFpsAutoInstalled(): Promise<boolean | null> {
  if (process.platform !== 'win32') return false
  const result = await runProcess(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe'),
    ['/Query', '/TN', FPS_AUTO_TASK_NAME, '/FO', 'LIST'],
    null,
    8_000
  )
  return interpretFpsAgentQuery(result)
}

async function refresh(force = false): Promise<void> {
  if (pollBusy) return
  pollBusy = true
  try {
    if (started) await queryTask(force)
    const parsed = await readFpsAutoLatestFile(currentLatestPath(), Date.now())
    lastParsed = parsed
    sendStatus(force)
  } catch (err) {
    logger.warn(
      'fps',
      `leitura do agent de FPS falhou: ${err instanceof Error ? err.message : err}`
    )
  } finally {
    pollBusy = false
  }
}

function startPolling(): void {
  if (timer) return
  started = true
  void refresh(true)
  timer = setInterval(() => {
    void refresh()
  }, FPS_AUTO_POLL_MS)
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  started = false
  pollBusy = false
}

/** Atualização pronta para o HUD; `null` = sem amostra fresca (mostra "—"). */
export function getFpsAutoUpdate(): FpsUpdate | null {
  const sample = lastParsed.sample
  if (!lastParsed.fresh || !sample || lastParsed.capturedAtMs === null) return null
  if (Date.now() - lastParsed.capturedAtMs > FPS_AUTO_STALE_MS) return null
  return {
    state: 'running',
    active: true,
    pid: sample.pid,
    processName: sample.name,
    fps: round1(sample.fps),
    frametimeMs: round1(sample.frametimeMs),
    capturedAt: sample.timestamp
  }
}

/** Estado para a aba Monitor (IPC `fps:auto-status`). */
export function getFpsAutoStatus(): FpsAutoStatus {
  return currentStatus()
}

async function runElevated(script: string): Promise<ProcessResult> {
  return runPowerShellCommand(buildFpsAgentElevationCommand(script), FPS_AUTO_UAC_TIMEOUT_MS)
}

/** Instala a tarefa (UAC único explícito). Nunca lança. */
export async function installFpsAuto(): Promise<FpsAutoActionResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      error: 'O FPS automático só é suportado no Windows.',
      status: currentStatus()
    }
  }
  if (installing || removing) {
    return { ok: false, error: 'Já existe uma operação em andamento.', status: currentStatus() }
  }

  installing = true
  lastError = undefined
  sendStatus(true)
  try {
    const staging = await ensureStagedHelper()
    const protectedPaths = resolveFpsProtectedPaths(process.env.ProgramData ?? 'C:\\ProgramData')
    const sha256 = await sha256File(staging.stagingExePath)
    const sinkDir = currentSinkDir()
    const script = buildFpsAgentInstallScript({
      stagingExePath: staging.stagingExePath,
      sha256,
      protectedPaths,
      sinkDir
    })
    const result = await runElevated(script)
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelled(combined)) {
      lastError = undefined
      return {
        ok: false,
        cancelled: true,
        error: 'A permissão de administrador não foi concedida. Nada foi alterado.',
        status: currentStatus()
      }
    }
    if (result.timedOut) {
      lastError = 'A instalação demorou demais para responder. Tente novamente.'
      return { ok: false, error: lastError, status: currentStatus() }
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      lastError = 'Não foi possível agendar o FPS automático no Windows.'
      logger.warn(
        'fps',
        `instalação do agent de FPS falhou (código ${result.code})${detail ? `: ${detail}` : ''}`
      )
      return { ok: false, error: lastError, status: currentStatus() }
    }

    installed = true
    lastError = undefined
    lastQueryAt = Date.now()
    logger.info('fps', `tarefa ${FPS_AUTO_TASK_NAME} instalada (sink ${sinkDir})`)
    await refresh(true)
    sendStatus(true)
    return { ok: true, status: currentStatus() }
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'Não foi possível instalar o FPS automático.'
    logger.warn('fps', `falha ao instalar o agent de FPS: ${lastError}`)
    return { ok: false, error: lastError, status: currentStatus() }
  } finally {
    installing = false
    sendStatus(true)
  }
}

/** Remove a tarefa e a amostra (UAC explícito; idempotente do ponto de vista da UI). */
export async function removeFpsAuto(): Promise<FpsAutoActionResult> {
  if (process.platform !== 'win32') {
    return {
      ok: false,
      error: 'O FPS automático só é suportado no Windows.',
      status: currentStatus()
    }
  }
  if (installing || removing) {
    return { ok: false, error: 'Já existe uma operação em andamento.', status: currentStatus() }
  }

  removing = true
  lastError = undefined
  sendStatus(true)
  try {
    const sinkDir = currentSinkDir()
    const script = buildFpsAgentRemoveScript(sinkDir)
    const result = await runElevated(script)
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelled(combined)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A permissão de administrador não foi concedida. Nada foi alterado.',
        status: currentStatus()
      }
    }
    if (result.timedOut || result.code !== 0) {
      lastError = 'Não foi possível remover a tarefa do FPS automático.'
      logger.warn('fps', `remoção do agent de FPS falhou (código ${result.code ?? 'timeout'})`)
      return { ok: false, error: lastError, status: currentStatus() }
    }

    installed = false
    lastError = undefined
    lastParsed = { fresh: false, sample: null, capturedAtMs: null }
    lastQueryAt = Date.now()
    logger.info('fps', `tarefa ${FPS_AUTO_TASK_NAME} removida`)
    sendStatus(true)
    return { ok: true, status: currentStatus() }
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'Não foi possível remover o FPS automático.'
    logger.warn('fps', `falha ao remover o agent de FPS: ${lastError}`)
    return { ok: false, error: lastError, status: currentStatus() }
  } finally {
    removing = false
    sendStatus(true)
  }
}

function assertNoArguments(args: unknown[]): void {
  if (args.length > 0) throw new Error('Requisição inválida.')
}

/** Registra o polling e os canais IPC `fps:auto-*`. */
export function registerFpsAutoIpc(ctx: IpcContext): void {
  context = ctx

  ipcMain.handle('fps:auto-status', (_event, ...args: unknown[]): FpsAutoStatus => {
    assertNoArguments(args)
    return getFpsAutoStatus()
  })

  ipcMain.handle(
    'fps:auto-install',
    async (_event, ...args: unknown[]): Promise<FpsAutoActionResult> => {
      assertNoArguments(args)
      return installFpsAuto()
    }
  )

  ipcMain.handle(
    'fps:auto-remove',
    async (_event, ...args: unknown[]): Promise<FpsAutoActionResult> => {
      assertNoArguments(args)
      return removeFpsAuto()
    }
  )

  startPolling()
  app.once('will-quit', stopPolling)
}

/** Apenas para testes: zera estado/timer entre casos. */
export function resetFpsAutoForTests(): void {
  stopPolling()
  context = null
  installed = null
  installing = false
  removing = false
  lastError = undefined
  lastParsed = { fresh: false, sample: null, capturedAtMs: null }
  lastSignature = ''
  lastQueryAt = 0
}
