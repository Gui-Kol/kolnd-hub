import { app, BrowserWindow, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import * as os from 'os'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { logger } from './logger'
import { BENCHMARK_WORKER_SOURCE } from './benchmarkWorkerSource'
import {
  addBenchmarkEntry,
  clearBenchmarkHistory,
  getBenchmarkHistory,
  type BenchmarkTestScore
} from './store'

/**
 * Benchmark de CPU do Kolnd Hub.
 *
 * Regras que explicam o desenho:
 * - Toda a computação roda em `worker_threads`; o main só orquestra e mede o
 *   relógio. Um kernel síncrono no main congelaria IPC, tray e a própria janela.
 * - O worker é criado por string (`eval: true`). Nesta versão do electron-vite
 *   (2.3) não há suporte a `?nodeWorker`, e um caminho relativo dentro do asar
 *   seria frágil no empacotamento. A string é CommonJS autocontida.
 * - A métrica é MOps/s (milhões de operações por segundo) por carga. O score de
 *   cada fase é a média geométrica dos cinco testes; a razão multi/single é
 *   apenas `multi / single`. Nada é normalizado contra banco remoto — não é
 *   comparável ao CPU-Z (a escala deles depende do serviço online).
 * - Execução única por vez: benchmark e estresse são mutuamente exclusivos.
 */

/** Mesma forma persistida em `benchmarkHistory` (fonte em `store.ts`). */
export type { BenchmarkTestScore } from './store'

/** Registro persistido no histórico local (fonte em `store.ts`). */
export type { BenchmarkEntry } from './store'

export type BenchmarkResult =
  | {
      ok: true
      cancelled?: boolean
      single: number
      multi: number
      ratio: number
      cores: number
      model: string
      threads: number
      durationMs: number
      tests: BenchmarkTestScore[]
    }
  | { ok: false; cancelled?: boolean; error: string }

export interface BenchmarkProgress {
  phase: 'single' | 'multi'
  testId: string
  testLabel: string
  testIndex: number
  testCount: number
  /** Percentual global do run (0–100), considerando as duas fases. */
  percent: number
}

export interface StressProgress {
  elapsedMs: number
  threads: number
  checksumOk: boolean
}

export interface StressStartResult {
  ok: boolean
  threads?: number
  error?: string
}

export interface StressStopResult {
  ok: boolean
  elapsedMs?: number
  checksumOk?: boolean
  error?: string
}

/** Cargas executadas em cada fase, na ordem exibida na interface. */
export const BENCHMARK_TESTS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'integers', label: 'Inteiros (ARX)' },
  { id: 'floats', label: 'Ponto flutuante' },
  { id: 'memory', label: 'Memória (strides)' },
  { id: 'aes', label: 'AES-256' },
  { id: 'sha', label: 'SHA-256' }
]

export const DEFAULT_TEST_DURATION_MS = 600
export const MAX_THREADS = 32
const DEFAULT_WARMUP_MS = 80
const SAFETY_TIMEOUT_MS = 10_000
const BUSY_ERROR = 'Já existe um teste em andamento. Aguarde ou pare o teste atual.'
/**
 * Progresso do estresse é agregado no main e enviado num único evento a cada
 * 500 ms — encaminhar uma mensagem por worker (16+) fazia a interface
 * re-renderizar dezenas de vezes por segundo sem ganho de informação.
 */
const STRESS_PROGRESS_INTERVAL_MS = 500
/**
 * Watchdog: se o renderer (que manda `benchmark:stress-ack` a cada 2 s) ficar
 * mudo por mais que isto, a carga é encerrada sozinha. Foi o que faltava no
 * bug "o Hub parou de funcionar durante o teste": sem ack, o único caminho de
 * saída era o usuário conseguir clicar em "Parar".
 */
export const STRESS_ACK_TIMEOUT_MS = 10_000

/** Erros com mensagem já amigável (nunca um stack trace cru para a interface). */
class BenchmarkError extends Error {}

// ── Cálculos puros (testados em benchmark.test.ts) ───────────────

/** Média geométrica dos valores positivos e finitos; lista vazia → 0. */
export function geometricMean(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0)
  if (valid.length === 0) return 0
  const sumLogs = valid.reduce((sum, value) => sum + Math.log(value), 0)
  return Math.exp(sumLogs / valid.length)
}

/** Converte operações contadas em MOps/s. */
export function opsToMops(ops: number, elapsedMs: number): number {
  if (!Number.isFinite(ops) || !Number.isFinite(elapsedMs) || ops <= 0 || elapsedMs <= 0) return 0
  return ops / (elapsedMs / 1000) / 1_000_000
}

/**
 * Agregação da fase multi: soma das operações de todos os workers dividida pelo
 * tempo decorrido da fase (o maior `elapsedMs`, já que rodaram em paralelo).
 */
export function aggregateMops(samples: ReadonlyArray<{ ops: number; elapsedMs: number }>): number {
  if (samples.length === 0) return 0
  const totalOps = samples.reduce((sum, sample) => sum + sample.ops, 0)
  const elapsedMs = Math.max(...samples.map((sample) => sample.elapsedMs))
  return opsToMops(totalOps, elapsedMs)
}

/** Razão multi/single; single inválido → 0 (a interface exibe "—"). */
export function computeRatio(multi: number, single: number): number {
  if (!Number.isFinite(multi) || !Number.isFinite(single) || single <= 0 || multi < 0) return 0
  return multi / single
}

/**
 * Regra do watchdog do estresse: o renderer precisa dar sinal de vida. Puro
 * para poder ser testado sem timers — a decisão depende só dos instantes.
 */
export function shouldStopForMissingAck(
  now: number,
  lastAckAt: number,
  timeoutMs: number = STRESS_ACK_TIMEOUT_MS
): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(lastAckAt)) return false
  return now - lastAckAt > timeoutMs
}

function roundScore(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * 100) / 100
}

function clampThreads(value: number): number {
  const cores = os.cpus().length || 1
  const requested = Number.isFinite(value) ? Math.trunc(value) : cores
  return Math.max(1, Math.min(requested, MAX_THREADS))
}

function clampDuration(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TEST_DURATION_MS
  return Math.max(50, Math.min(10_000, Math.trunc(value as number)))
}

// ── Estado (execução única por vez) ──────────────────────────────

interface BenchmarkSession {
  cancelled: boolean
  workers: Set<Worker>
}

interface WorkerSample {
  ops: number
  elapsedMs: number
}

interface StressSession {
  workers: Worker[]
  startedAt: number
  checksumOk: boolean
  sender: WebContents | null
  progressTimer: NodeJS.Timeout | null
  /** Último sinal de vida do renderer (`benchmark:stress-ack`). */
  lastAckAt: number
}

let activeBenchmark: BenchmarkSession | null = null
let stressSession: StressSession | null = null

/** `true` quando há benchmark ou estresse em andamento. */
export function isBenchmarkBusy(): boolean {
  return activeBenchmark !== null || stressSession !== null
}

/** Informações da CPU para os chips da interface (somente leitura local). */
export function getBenchmarkInfo(): { cores: number; model: string } {
  const cpus = os.cpus()
  return {
    cores: cpus.length,
    model: (cpus[0]?.model ?? 'CPU desconhecida').trim()
  }
}

// ── Execução do benchmark ────────────────────────────────────────

function terminateWorkers(workers: Iterable<Worker>): void {
  for (const worker of workers) {
    // `terminate()` é assíncrono e nunca lança para worker já encerrado.
    void worker.terminate().catch(() => undefined)
  }
}

function terminateSession(session: BenchmarkSession): void {
  terminateWorkers(session.workers)
  session.workers.clear()
}

/**
 * Roda uma carga em um worker e resolve com as operações contadas. Timeout de
 * segurança bem acima da duração pedida: se estourar, o worker é encerrado e o
 * usuário recebe uma mensagem amigável.
 */
function runKernelWorker(
  session: BenchmarkSession,
  testId: string,
  durationMs: number
): Promise<WorkerSample> {
  return new Promise<WorkerSample>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(BENCHMARK_WORKER_SOURCE, {
        eval: true,
        workerData: { mode: 'bench', testId, durationMs, warmupMs: DEFAULT_WARMUP_MS }
      })
    } catch {
      reject(new BenchmarkError('Não foi possível iniciar o teste de CPU. Tente novamente.'))
      return
    }

    session.workers.add(worker)
    let settled = false

    const finish = (error: Error | null, sample?: WorkerSample): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      session.workers.delete(worker)
      void worker.terminate().catch(() => undefined)
      if (error) reject(error)
      else resolve(sample as WorkerSample)
    }

    const timeout = setTimeout(() => {
      finish(
        new BenchmarkError(
          'O teste demorou mais que o esperado e foi interrompido. Feche programas pesados e tente novamente.'
        )
      )
    }, durationMs + SAFETY_TIMEOUT_MS)

    // Worker não tem canal de saída visível; só mensagens tipadas entram.
    worker.on('message', (message: unknown) => {
      if (!message || typeof message !== 'object') return
      const data = message as Record<string, unknown>
      if (data.type === 'result') {
        const ops = typeof data.ops === 'number' ? data.ops : NaN
        const elapsedMs = typeof data.elapsedMs === 'number' ? data.elapsedMs : NaN
        if (!Number.isFinite(ops) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
          finish(new BenchmarkError('O teste retornou um resultado inválido. Tente novamente.'))
          return
        }
        finish(null, { ops, elapsedMs })
      } else if (data.type === 'error') {
        finish(new BenchmarkError('Não foi possível executar uma das cargas de CPU.'))
      }
    })

    worker.on('error', () => {
      logger.warn('benchmark', 'worker de benchmark falhou')
      finish(new BenchmarkError('Não foi possível executar uma das cargas de CPU.'))
    })

    worker.on('exit', () => {
      finish(new BenchmarkError('O teste de CPU foi interrompido inesperadamente.'))
    })
  })
}

export interface BenchmarkRunOptions {
  /** Duração por teste em ms. Usado apenas pelos testes automatizados. */
  durationMs?: number
  /** Subconjunto de cargas. Usado apenas pelos testes automatizados. */
  tests?: ReadonlyArray<{ id: string; label: string }>
  /** Workers da fase multi. O IPC sempre usa o número de núcleos. */
  threads?: number
  onProgress?: (progress: BenchmarkProgress) => void
}

function notifyProgress(
  onProgress: BenchmarkRunOptions['onProgress'],
  progress: BenchmarkProgress
): void {
  if (!onProgress) return
  try {
    onProgress(progress)
  } catch {
    // A interface pode ter sido fechada no meio do run — o benchmark continua.
  }
}

/**
 * Executa as duas fases (single e multi) e devolve o resultado agregado.
 * Persiste no histórico apenas quando conclui de verdade (nunca cancelado).
 */
export async function runBenchmark(options: BenchmarkRunOptions = {}): Promise<BenchmarkResult> {
  if (isBenchmarkBusy()) return { ok: false, error: BUSY_ERROR }

  const session: BenchmarkSession = { cancelled: false, workers: new Set() }
  activeBenchmark = session

  const tests = options.tests && options.tests.length > 0 ? options.tests : BENCHMARK_TESTS
  const durationMs = clampDuration(options.durationMs)
  const threads = clampThreads(options.threads ?? os.cpus().length)
  const info = getBenchmarkInfo()
  const totalSteps = tests.length * 2
  let step = 0

  try {
    const perTest: BenchmarkTestScore[] = []
    const singleValues: number[] = []
    const multiValues: number[] = []

    for (const phase of ['single', 'multi'] as const) {
      for (let index = 0; index < tests.length; index++) {
        if (session.cancelled) {
          return { ok: false, cancelled: true, error: 'Execução cancelada.' }
        }

        const test = tests[index]
        // Avisa antes de começar: a barra avança em cada teste das duas fases.
        notifyProgress(options.onProgress, {
          phase,
          testId: test.id,
          testLabel: test.label,
          testIndex: index + 1,
          testCount: tests.length,
          percent: Math.round((step / totalSteps) * 100)
        })

        let mops = 0
        if (phase === 'single') {
          const sample = await runKernelWorker(session, test.id, durationMs)
          mops = opsToMops(sample.ops, sample.elapsedMs)
          singleValues.push(mops)
          perTest.push({ id: test.id, label: test.label, single: roundScore(mops), multi: 0 })
        } else {
          // N workers simultâneos para a mesma carga; a soma das operações
          // dividida pelo tempo da fase representa a vazão multi-thread real.
          const samples = await Promise.all(
            Array.from({ length: threads }, () => runKernelWorker(session, test.id, durationMs))
          )
          mops = aggregateMops(samples)
          multiValues.push(mops)
          perTest[index].multi = roundScore(mops)
        }

        if (session.cancelled) {
          return { ok: false, cancelled: true, error: 'Execução cancelada.' }
        }

        step += 1
        notifyProgress(options.onProgress, {
          phase,
          testId: test.id,
          testLabel: test.label,
          testIndex: index + 1,
          testCount: tests.length,
          percent: Math.round((step / totalSteps) * 100)
        })
      }
    }

    const single = roundScore(geometricMean(singleValues))
    const multi = roundScore(geometricMean(multiValues))
    const ratio = Math.round(computeRatio(multi, single) * 100) / 100

    // Persistência é best-effort: falha de disco não invalida a medição.
    try {
      addBenchmarkEntry({
        id: `bench-${Date.now()}-${randomUUID().slice(0, 8)}`,
        at: new Date().toISOString(),
        single,
        multi,
        ratio,
        cores: info.cores,
        model: info.model,
        tests: perTest
      })
    } catch (err) {
      logger.warn('benchmark', 'falha ao salvar o histórico do benchmark:', err)
    }

    logger.info(
      'benchmark',
      `benchmark concluído: single ${single} · multi ${multi} · ${threads} thread(s)`
    )

    return {
      ok: true,
      single,
      multi,
      ratio,
      cores: info.cores,
      model: info.model,
      threads,
      durationMs,
      tests: perTest
    }
  } catch (err) {
    if (session.cancelled) {
      return { ok: false, cancelled: true, error: 'Execução cancelada.' }
    }
    logger.warn('benchmark', 'execução falhou:', err)
    return {
      ok: false,
      error:
        err instanceof BenchmarkError
          ? err.message
          : 'Não foi possível concluir o benchmark. Tente novamente em alguns instantes.'
    }
  } finally {
    terminateSession(session)
    if (activeBenchmark === session) activeBenchmark = null
  }
}

/** Cancela o run ativo (worker encerrado na hora); sem run, não faz nada. */
export function cancelBenchmark(): { ok: boolean; cancelled: boolean } {
  const session = activeBenchmark
  if (!session) return { ok: true, cancelled: false }
  session.cancelled = true
  terminateSession(session)
  logger.info('benchmark', 'benchmark cancelado pelo usuário')
  return { ok: true, cancelled: true }
}

// ── Teste de estresse ────────────────────────────────────────────

function sendStressProgress(session: StressSession): void {
  const sender = session.sender
  if (!sender || sender.isDestroyed()) return
  const progress: StressProgress = {
    elapsedMs: Math.max(0, Date.now() - session.startedAt),
    threads: session.workers.length,
    checksumOk: session.checksumOk
  }
  try {
    sender.send('benchmark:stress-progress', progress)
  } catch {
    // Janela fechada no meio: o teste continua até parar/desmontar/encerrar.
  }
}

/** Inicia a carga contínua em todos os núcleos (sem pontuação). */
export function startStress(sender: WebContents | null = null): StressStartResult {
  if (isBenchmarkBusy()) return { ok: false, error: BUSY_ERROR }

  const threads = clampThreads(os.cpus().length)
  const session: StressSession = {
    workers: [],
    startedAt: Date.now(),
    checksumOk: true,
    sender,
    progressTimer: null,
    lastAckAt: Date.now()
  }
  stressSession = session

  try {
    for (let index = 0; index < threads; index++) {
      const worker = new Worker(BENCHMARK_WORKER_SOURCE, {
        eval: true,
        workerData: { mode: 'stress' }
      })
      // Cada worker reporta o próprio checksum; o envio à interface é feito
      // pelo timer agregado abaixo (uma mensagem por sessão, não por worker).
      worker.on('message', (message: unknown) => {
        if (stressSession !== session) return
        if (!message || typeof message !== 'object') return
        const data = message as Record<string, unknown>
        if (data.type !== 'stress') return
        if (data.checksumOk === false) session.checksumOk = false
      })
      worker.on('error', () => {
        if (stressSession !== session) return
        session.checksumOk = false
        logger.warn('benchmark', 'worker do teste de estresse falhou')
      })
      worker.on('exit', () => {
        if (stressSession !== session) return
        session.checksumOk = false
        logger.warn('benchmark', 'worker do teste de estresse encerrou inesperadamente')
      })
      session.workers.push(worker)
    }
  } catch (err) {
    logger.warn('benchmark', 'falha ao iniciar o teste de estresse:', err)
    stressSession = null
    terminateWorkers(session.workers)
    return {
      ok: false,
      error: 'Não foi possível iniciar o teste de estresse. Tente novamente.'
    }
  }

  // Progresso único a cada 500 ms + watchdog de sinal de vida da interface.
  session.progressTimer = setInterval(() => {
    if (stressSession !== session) return
    if (sender) {
      if (sender.isDestroyed()) {
        // Janela fechada de vez: a carga não tem mais dono, encerra.
        stopStress()
        return
      }
      // Watchdog só vale com a janela visível: quando o app está na bandeja o
      // Chromium estrangula os timers do renderer e o ack naturalmente atrasa.
      const window = BrowserWindow.fromWebContents(sender)
      const visible = window ? window.isVisible() : false
      if (visible && shouldStopForMissingAck(Date.now(), session.lastAckAt)) {
        logger.warn(
          'benchmark',
          'interface sem responder durante o teste de estresse — carga encerrada pelo watchdog'
        )
        stopStress()
        return
      }
    }
    sendStressProgress(session)
  }, STRESS_PROGRESS_INTERVAL_MS)

  logger.info('benchmark', `teste de estresse iniciado com ${threads} thread(s)`)
  sendStressProgress(session)
  return { ok: true, threads }
}

/**
 * Sinal de vida do renderer enquanto o estresse roda (a interface chama a cada
 * 2 s). Sem isso o watchdog encerra a carga — ver STRESS_ACK_TIMEOUT_MS.
 */
export function acknowledgeStress(): void {
  if (stressSession) stressSession.lastAckAt = Date.now()
}

/** Para o estresse e encerra todos os workers (nunca deixa worker órfão). */
export function stopStress(): StressStopResult {
  const session = stressSession
  if (!session) return { ok: true, elapsedMs: 0, checksumOk: true }

  stressSession = null
  if (session.progressTimer) clearInterval(session.progressTimer)
  terminateWorkers(session.workers)
  const elapsedMs = Math.max(0, Date.now() - session.startedAt)
  logger.info('benchmark', `teste de estresse parado após ${Math.round(elapsedMs / 1000)} s`)
  return { ok: true, elapsedMs, checksumOk: session.checksumOk }
}

// ── IPC ──────────────────────────────────────────────────────────

function sendBenchmarkProgress(sender: WebContents, progress: BenchmarkProgress): void {
  if (sender.isDestroyed()) return
  try {
    sender.send('benchmark:progress', progress)
  } catch {
    // A janela foi fechada; o run continua e o resultado volta pelo invoke.
  }
}

/** Registra os canais IPC do benchmark e do teste de estresse. */
export function registerBenchmarkIpc(): void {
  ipcMain.handle('benchmark:info', () => getBenchmarkInfo())

  ipcMain.handle('benchmark:run', (event) =>
    // O handler não aceita parâmetros do renderer: duração, cargas e threads
    // são decididas aqui — nada do renderer entra na execução.
    runBenchmark({ onProgress: (progress) => sendBenchmarkProgress(event.sender, progress) })
  )

  ipcMain.handle('benchmark:cancel', () => cancelBenchmark())

  ipcMain.handle('benchmark:history', () => getBenchmarkHistory())

  ipcMain.handle('benchmark:history-clear', () => ({ success: clearBenchmarkHistory() }))

  ipcMain.handle('benchmark:stress-start', (event) => startStress(event.sender))

  ipcMain.handle('benchmark:stress-stop', () => stopStress())

  // Sinal de vida da interface durante o estresse (watchdog).
  ipcMain.handle('benchmark:stress-ack', () => {
    acknowledgeStress()
  })

  // Encerrar o app nunca pode deixar um worker de estresse girando.
  app.once('will-quit', () => {
    cancelBenchmark()
    stopStress()
  })
}
