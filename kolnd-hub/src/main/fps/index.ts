import { app, ipcMain } from 'electron'
import { basename } from 'path'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import type {
  FpsInactiveReason,
  FpsStartResult,
  FpsState,
  FpsStatusInfo,
  FpsStopResult,
  FpsUpdate
} from '../../shared/fps'
import {
  currentFpsHelperPaths,
  parseFpsHelperLine,
  readFpsChunk,
  requestFpsHelperStop,
  requestFpsHelperStopSync,
  startFpsHelper,
  takeCompleteLines,
  touchFpsHeartbeat,
  type FpsHelperPaths,
  type FpsHelperSample
} from './helper'
import { selectFpsTarget } from './target'

/**
 * Orquestração da medição de FPS/frametime por ETW.
 *
 * O helper é elevado e escreve NDJSON em `<ProgramData>/Kolnd Hub/fps/run/fps.ndjson`
 * (diretório protegido); o main
 * lê só os bytes novos, valida cada linha e publica `fps:update` com o alvo em
 * primeiro plano. O main também escreve o heartbeat que o helper usa para se
 * encerrar sozinho se o app morrer — assim nenhuma sessão ETW fica órfã.
 *
 * Estado é opt-in: `fps:start` só é chamado por clique na UI (UAC explícito).
 */

const POLL_INTERVAL_MS = 500
const READY_TIMEOUT_MS = 20_000
const WATCHDOG_TIMEOUT_MS = 6_000
const HEARTBEAT_INTERVAL_MS = 2_000
const MAX_SANE_FPS = 100_000
const MAX_SANE_FRAMETIME_MS = 60_000

let context: IpcContext | null = null
let state: FpsState = 'off'
let lastUpdate: FpsUpdate | null = null
let lastError: string | undefined
let timer: ReturnType<typeof setInterval> | null = null
let polling = false
let readOffset = 0
let pendingText = ''
let lastMessageAt = 0
let startedAt = 0
let lastHeartbeatAt = 0
let stopRequested = false
let helperPaths: FpsHelperPaths | null = null
let startPromise: Promise<FpsStartResult> | null = null

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Nomes do próprio Hub (dev e empacotado). O Electron em dev é `electron.exe`;
 * na instalação é o executável do app. Ambos são ignorados como alvo para não
 * medir o Chromium do Monitor enquanto o usuário olha o card.
 */
function hubProcessNames(): string[] {
  const names = ['electron.exe']
  try {
    names.push(basename(process.execPath))
  } catch {}
  try {
    names.push(basename(app.getPath('exe')))
  } catch {}
  return names
}

interface UpdateSeed {
  state: FpsState
  active?: boolean
  pid?: number | null
  processName?: string | null
  fps?: number | null
  frametimeMs?: number | null
  reason?: FpsInactiveReason
  error?: string
}

function makeUpdate(seed: UpdateSeed): FpsUpdate {
  return {
    state: seed.state,
    active: seed.active === true,
    pid: seed.pid ?? null,
    processName: seed.processName ?? null,
    fps: seed.fps ?? null,
    frametimeMs: seed.frametimeMs ?? null,
    capturedAt: new Date().toISOString(),
    reason: seed.reason,
    error: seed.error
  }
}

function inactiveUpdate(
  reason: FpsInactiveReason,
  nextState: FpsState = state,
  error?: string
): FpsUpdate {
  return makeUpdate({ state: nextState, reason, error })
}

function sendUpdate(update: FpsUpdate): void {
  lastUpdate = update
  const window = context?.getMainWindow()
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send('fps:update', update)
  } catch {
    // Janela fechando entre a checagem e o envio: o próximo tick não envia.
  }
}

/**
 * Converte a amostra do helper em atualização da UI. Pura (recebe os nomes
 * ignorados), exportada para teste: o alvo é sempre o PID em primeiro plano,
 * nunca "o último jogo que apareceu".
 */
export function buildFpsUpdate(
  sample: FpsHelperSample,
  extraIgnored: readonly string[] = []
): FpsUpdate {
  const { target, reason } = selectFpsTarget(sample, extraIgnored)
  if (!target) {
    return makeUpdate({ state: 'running', reason: reason ?? 'no-target' })
  }
  if (target.fps > MAX_SANE_FPS || target.frametimeMs > MAX_SANE_FRAMETIME_MS) {
    return makeUpdate({ state: 'running', reason: 'no-presents' })
  }
  return makeUpdate({
    state: 'running',
    active: true,
    pid: target.pid,
    processName: target.processName,
    fps: round1(target.fps),
    frametimeMs: round1(target.frametimeMs)
  })
}

function friendlyHelperError(message: { stage?: string; code?: number; message: string }): string {
  switch (message.stage) {
    case 'start-trace':
      return message.code === 5
        ? 'O Windows negou a sessão de eventos. Confirme a permissão de administrador e tente novamente.'
        : 'Não foi possível abrir a sessão de eventos do Windows.'
    case 'enable-dxgi':
      return 'O Windows não expôs os eventos gráficos (DXGI) nesta máquina.'
    case 'open-trace':
      return 'Não foi possível ler os eventos gráficos em tempo real.'
    case 'process-trace':
      return 'A sessão de eventos foi interrompida pelo Windows. Reinicie a medição.'
    default:
      return 'A medição de FPS falhou. Tente novamente.'
  }
}

function fail(message: string, askStop: boolean): void {
  logger.warn('fps', message)
  state = 'error'
  lastError = message
  stopPolling()
  if (askStop) void requestFpsHelperStop('watchdog')
  sendUpdate(inactiveUpdate('helper-stopped', 'error', message))
}

function handleLine(line: string): void {
  const message = parseFpsHelperLine(line)
  if (!message) return

  if (message.type === 'ready') {
    lastMessageAt = Date.now()
    if (state === 'starting' || state === 'running') {
      state = 'running'
      lastError = undefined
      logger.info('fps', `helper ETW pronto (sessão ${message.session}, dxgk=${message.dxgk})`)
      sendUpdate(inactiveUpdate('no-target', 'running'))
    }
    return
  }

  if (message.type === 'sample') {
    lastMessageAt = Date.now()
    if (state === 'starting') state = 'running'
    if (state === 'running') sendUpdate(buildFpsUpdate(message, hubProcessNames()))
    return
  }

  if (message.type === 'stopped') {
    lastMessageAt = Date.now()
    stopPolling()
    if (stopRequested) {
      state = 'off'
      lastError = undefined
      sendUpdate(inactiveUpdate('helper-stopped', 'off'))
    } else {
      fail('A medição de FPS foi encerrada inesperadamente.', false)
    }
    return
  }

  logger.warn(
    'fps',
    `helper falhou: ${message.stage ?? '?'} (${message.code ?? '?'}) ${message.message}`
  )
  fail(friendlyHelperError(message), false)
}

function enforceTimeouts(): void {
  const now = Date.now()
  if (state === 'starting' && now - startedAt > READY_TIMEOUT_MS) {
    fail('Não foi possível iniciar a medição de FPS a tempo. Tente novamente.', true)
    return
  }
  if (state === 'running' && now - lastMessageAt > WATCHDOG_TIMEOUT_MS) {
    fail('A medição de FPS parou de responder. Reinicie a medição.', true)
  }
}

async function pollOnce(): Promise<void> {
  if (polling) return
  polling = true
  try {
    const paths = helperPaths ?? currentFpsHelperPaths()
    const now = Date.now()
    if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatAt = now
      await touchFpsHeartbeat(paths)
    }

    const chunk = await readFpsChunk(paths.outputPath, readOffset)
    readOffset = chunk.offset
    if (chunk.truncated) pendingText = ''
    if (chunk.text) {
      const { lines, rest } = takeCompleteLines(pendingText + chunk.text)
      pendingText = rest
      for (const line of lines) handleLine(line)
    }

    enforceTimeouts()
  } catch (err) {
    logger.warn('fps', `leitura do helper falhou: ${err instanceof Error ? err.message : err}`)
  } finally {
    polling = false
  }
}

function startPolling(): void {
  if (timer) return
  void pollOnce()
  timer = setInterval(() => {
    void pollOnce()
  }, POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  polling = false
}

function assertNoArguments(args: unknown[]): void {
  if (args.length > 0) throw new Error('Requisição inválida.')
}

export function getFpsStatus(): FpsStatusInfo {
  return { state, last: lastUpdate, error: lastError }
}

export async function startFpsMonitor(): Promise<FpsStartResult> {
  if (state === 'starting' || state === 'running') {
    return { ok: true, status: getFpsStatus() }
  }
  if (startPromise) return startPromise

  startPromise = (async (): Promise<FpsStartResult> => {
    state = 'starting'
    lastError = undefined
    stopRequested = false
    readOffset = 0
    pendingText = ''
    startedAt = Date.now()
    lastMessageAt = startedAt
    lastHeartbeatAt = 0
    sendUpdate(inactiveUpdate('not-started', 'starting'))

    const result = await startFpsHelper()
    if (!result.ok) {
      state = result.cancelled ? 'off' : 'error'
      // Cancelar o UAC não é erro do app: fica como aviso neutro, sem vermelho.
      lastError = result.cancelled ? undefined : result.error
      logger.warn('fps', `início da medição recusado: ${result.error ?? 'sem detalhe'}`)
      sendUpdate(
        inactiveUpdate(result.cancelled ? 'not-started' : 'helper-stopped', state, lastError)
      )
      return {
        ok: false,
        cancelled: result.cancelled,
        error: result.error,
        status: getFpsStatus()
      }
    }

    helperPaths = result.paths ?? currentFpsHelperPaths()
    startPolling()
    return { ok: true, status: getFpsStatus() }
  })()

  try {
    return await startPromise
  } finally {
    startPromise = null
  }
}

/** Para a medição (idempotente). O helper sai pelo arquivo de stop/heartbeat. */
export function stopFpsMonitor(): FpsStopResult {
  stopRequested = true
  stopPolling()
  if (state !== 'off') void requestFpsHelperStop('stop')
  state = 'off'
  lastError = undefined
  readOffset = 0
  pendingText = ''
  sendUpdate(inactiveUpdate('helper-stopped', 'off'))
  return { ok: true }
}

/** `will-quit`: escrita síncrona do stop — depois do quit nada mais roda. */
function stopFpsMonitorForQuit(): void {
  stopRequested = true
  stopPolling()
  requestFpsHelperStopSync('quit')
  state = 'off'
}

/** Registra os canais IPC da medição de FPS por ETW. */
export function registerFpsIpc(ctx: IpcContext): void {
  context = ctx

  ipcMain.handle('fps:status', (_event, ...args: unknown[]): FpsStatusInfo => {
    assertNoArguments(args)
    return getFpsStatus()
  })

  ipcMain.handle('fps:start', async (_event, ...args: unknown[]): Promise<FpsStartResult> => {
    assertNoArguments(args)
    return startFpsMonitor()
  })

  ipcMain.handle('fps:stop', (_event, ...args: unknown[]): FpsStopResult => {
    assertNoArguments(args)
    return stopFpsMonitor()
  })

  app.once('will-quit', stopFpsMonitorForQuit)
}

/** Apenas para testes: zera estado/timer entre casos. */
export function resetFpsMonitorForTests(): void {
  stopPolling()
  context = null
  state = 'off'
  lastUpdate = null
  lastError = undefined
  readOffset = 0
  pendingText = ''
  lastMessageAt = 0
  startedAt = 0
  lastHeartbeatAt = 0
  stopRequested = false
  helperPaths = null
  startPromise = null
}
