import { app, BrowserWindow, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import * as os from 'os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { logger } from './logger'
import { BENCHMARK_STRESS_SOURCE } from './benchmarkWorkerSource'
import { BENCHMARK_RUNNER_SOURCE } from './benchmarkRunnerSource'
import { runRunner, type RunnerLoadResult } from './benchmarkRunner'
import {
  BENCHMARK_REFERENCES,
  computeRatio,
  hasUnstableLoad,
  isUnstableSpread,
  median,
  multiReps,
  roundScore,
  singleReps,
  spreadRatio,
  weightedPhaseScore
} from './benchmarkScore'
import {
  addBenchmarkEntry,
  clearBenchmarkHistory,
  getBenchmarkHistory,
  type BenchmarkTestScore
} from './store'

/**
 * Benchmark de CPU do Kolnd Hub.
 *
 * Regras que explicam o desenho atual (v2):
 * - A computação roda em **processos filhos** (`process.execPath` +
 *   `ELECTRON_RUN_AS_NODE=1`), nunca em `worker_threads` do main: a partir da
 *   2ª execução na mesma sessão o V8 dos workers caía para interpretado
 *   (medido: inteiros 1021 → 73 MOps, SHA idêntico) e sobrava CPU girando.
 * - Cada filho roda um script CJS autocontido gerado em
 *   `<userData>/benchmark/kolnd-bench-runner.js` — não há caminho confiável
 *   dentro do asar e o script é reescrito só quando o conteúdo muda.
 * - Trabalho **fixo** por carga (não duração fixa): aquecimento descartado,
 *   3 repetições e mediana. O mesmo trabalho em toda execução é o que torna o
 *   resultado comparável entre runs.
 * - Fases `single` (1 filho) e `multi` (N = núcleos lógicos, cap 32) com as
 *   5 cargas; total de 1 + N processos por run.
 * - Nota normalizada por carga e média aritmética ponderada — a escala está
 *   documentada em `benchmarkScore.ts` e no rodapé da interface.
 * - Execução única por vez: benchmark e estresse são mutuamente exclusivos.
 * - Nenhum filho sobrevive ao run: fim, cancelamento, timeout e `will-quit`
 *   matam todos (órfão de benchmark é bug).
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
      /** Tempo total do run (ms) — informativo, não entra em nenhuma nota. */
      durationMs: number
      tests: BenchmarkTestScore[]
      /** Alguma carga continuou com spread > 25 % mesmo após a repetição. */
      unstable: boolean
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

/** Repetições por carga; a nota usa a mediana (o pior/ruído não decide). */
export const BENCHMARK_REPEATS = 3

export const MAX_THREADS = 32

const RUNNER_DIR_NAME = 'benchmark'
const RUNNER_FILE_NAME = 'kolnd-bench-runner.js'

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

// ── Estado (execução única por vez) ──────────────────────────────

interface BenchmarkSession {
  cancelled: boolean
  /** Filhos vivos do run: mortos no fim, no cancelamento, no timeout e no quit. */
  children: Set<ChildProcess>
}

interface LoadMeasurement {
  id: string
  mops: number
  spread: number
  unstable: boolean
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

function clampThreads(value: number): number {
  const cores = os.cpus().length || 1
  const requested = Number.isFinite(value) ? Math.trunc(value) : cores
  return Math.max(1, Math.min(requested, MAX_THREADS))
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

// ── Script do runner (processo filho) ────────────────────────────

/**
 * Grava o runner em `<userData>/benchmark/kolnd-bench-runner.js` e devolve o
 * caminho. Reescreve só quando o conteúdo muda, para não gerar escrita em disco
 * a cada execução.
 *
 * Exceção consciente à regra "config só no store": isto não é configuração, é
 * um artefato de execução gerado pelo app (o caminho dentro do asar não é
 * executável de forma confiável). O conteúdo é uma constante do bundle.
 */
async function ensureRunnerScript(): Promise<string> {
  const directory = path.join(app.getPath('userData'), RUNNER_DIR_NAME)
  const scriptPath = path.join(directory, RUNNER_FILE_NAME)
  await fs.mkdir(directory, { recursive: true })
  const current = await fs.readFile(scriptPath, 'utf8').catch(() => null)
  if (current !== BENCHMARK_RUNNER_SOURCE) {
    await fs.writeFile(scriptPath, BENCHMARK_RUNNER_SOURCE, 'utf8')
  }
  return scriptPath
}

/**
 * Timeout de segurança por filho. Não é o tempo da medição (o trabalho é
 * fixo): cobre inicialização do processo + aquecimentos + repetições com folga
 * de ~2× o pior caso medido com todos os núcleos saturados.
 */
function runnerTimeoutMs(loadCount: number): number {
  return 12_000 + Math.max(1, loadCount) * 9_000
}

// ── Execução do benchmark ────────────────────────────────────────

function killChildren(session: BenchmarkSession): void {
  for (const child of session.children) {
    // `kill()` no Windows encerra o processo na hora; nunca lança para PID morto
    // pelo try/catch porque o filho pode ter fechado entre a iteração e a chamada.
    try {
      child.kill()
    } catch {
      // já encerrado
    }
  }
  session.children.clear()
}

interface MeasureOptions {
  session: BenchmarkSession
  scriptPath: string
  loadIds: ReadonlyArray<string>
  workers: number
  repeats: number
  /** Avisa o início de cada carga (progresso da interface). */
  onLoadStart?: (id: string) => void
}

/**
 * Mede as cargas pedidas com `workers` filhos em paralelo e devolve, por carga,
 * a mediana das repetições e o spread.
 *
 * Fase single: a série é a do único filho (1 amostra por repetição).
 * Fase multi: a série é agregada por repetição (soma das ops dos filhos ÷ maior
 * tempo). O spread é medido na série que produz a nota — medir o spread interno
 * de cada filho só capturaria escalonamento do SO, não a medição da carga.
 */
async function measureLoads(options: MeasureOptions): Promise<Map<string, LoadMeasurement>> {
  const { session, scriptPath, loadIds, workers, repeats } = options

  const results = await Promise.all(
    Array.from({ length: workers }, (_, index) =>
      runRunner({
        scriptPath,
        config: { loads: [...loadIds], repeats },
        timeoutMs: runnerTimeoutMs(loadIds.length),
        onChild: (child) => {
          session.children.add(child)
          child.once('close', () => session.children.delete(child))
        },
        // Só o primeiro filho guia o progresso: 16 filhos reportando a mesma
        // carga gerariam 16 eventos idênticos por passo.
        onEvent:
          index === 0
            ? (event) => {
                if (event.type === 'load') options.onLoadStart?.(event.id)
              }
            : undefined
      })
    )
  )

  const measurements = new Map<string, LoadMeasurement>()
  for (const id of loadIds) {
    const perChild: RunnerLoadResult[] = []
    for (const result of results) {
      const load = result.find((item) => item.id === id)
      if (!load) throw new BenchmarkError('Uma das cargas não retornou resultado. Tente novamente.')
      perChild.push(load)
    }

    const series = workers === 1 ? singleReps(perChild[0]) : multiReps(perChild)
    const spread = spreadRatio(series)
    measurements.set(id, {
      id,
      mops: median(series),
      spread,
      unstable: isUnstableSpread(spread)
    })
  }
  return measurements
}

/**
 * Mede a fase e, se alguma carga vier com spread > 25 %, repete **apenas essas
 * cargas** uma vez (nunca mais que uma: instabilidade persistente vira badge,
 * não retry infinito).
 */
async function measurePhase(
  options: MeasureOptions
): Promise<{ measurements: Map<string, LoadMeasurement>; unstable: boolean }> {
  const first = await measureLoads(options)
  const retryIds = options.loadIds.filter((id) => first.get(id)?.unstable)

  if (retryIds.length === 0) return { measurements: first, unstable: false }

  logger.warn(
    'benchmark',
    `repetindo carga(s) com spread alto (${retryIds.join(', ')}) na fase de ${options.workers} processo(s)`
  )

  // Sem `onLoadStart` na repetição: a barra de progresso já passou desse passo.
  const retried = await measureLoads({ ...options, loadIds: retryIds, onLoadStart: undefined })
  for (const id of retryIds) {
    const replacement = retried.get(id)
    // Se continuar instável, o número é mostrado mesmo assim (nunca esconder).
    if (replacement) first.set(id, replacement)
  }

  return { measurements: first, unstable: hasUnstableLoad([...first.values()]) }
}

export interface BenchmarkRunOptions {
  /** Subconjunto de cargas. Usado apenas pelos testes automatizados. */
  tests?: ReadonlyArray<{ id: string; label: string }>
  /** Processos da fase multi. O IPC sempre usa o número de núcleos. */
  threads?: number
  /** Repetições por carga. Usado apenas pelos testes automatizados. */
  repeats?: number
  /** Caminho do runner. Usado apenas pelos testes automatizados. */
  runnerScriptPath?: string
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

  const session: BenchmarkSession = { cancelled: false, children: new Set() }
  activeBenchmark = session
  const startedAt = Date.now()

  const requested = options.tests && options.tests.length > 0 ? options.tests : BENCHMARK_TESTS
  // Somente cargas conhecidas entram na nota (defesa contra entrada arbitrária).
  const tests = requested.filter((test) => BENCHMARK_REFERENCES[test.id])
  const loads = tests.length > 0 ? tests : [...BENCHMARK_TESTS]
  const threads = clampThreads(options.threads ?? os.cpus().length)
  const repeats = Math.min(5, Math.max(1, Math.trunc(options.repeats ?? BENCHMARK_REPEATS)))
  const info = getBenchmarkInfo()
  const totalSteps = loads.length * 2
  let step = 0

  const emit = (phase: 'single' | 'multi', index: number): void => {
    const test = loads[Math.min(index, loads.length - 1)]
    notifyProgress(options.onProgress, {
      phase,
      testId: test.id,
      testLabel: test.label,
      testIndex: Math.min(index, loads.length - 1) + 1,
      testCount: loads.length,
      percent: Math.round((step / totalSteps) * 100)
    })
  }

  try {
    const scriptPath = options.runnerScriptPath ?? (await ensureRunnerScript())
    if (session.cancelled) {
      return { ok: false, cancelled: true, error: 'Execução cancelada.' }
    }

    // ── Fase single: um único filho roda as 5 cargas ──
    emit('single', 0)
    const singlePhase = await measurePhase({
      session,
      scriptPath,
      loadIds: loads.map((test) => test.id),
      workers: 1,
      repeats,
      onLoadStart: (id) => {
        const index = loads.findIndex((test) => test.id === id)
        if (index < 0) return
        step = index
        emit('single', index)
      }
    })
    if (session.cancelled) return { ok: false, cancelled: true, error: 'Execução cancelada.' }

    step = loads.length
    // ── Fase multi: N filhos em paralelo, cada um com as 5 cargas ──
    emit('multi', 0)
    const multiPhase = await measurePhase({
      session,
      scriptPath,
      loadIds: loads.map((test) => test.id),
      workers: threads,
      repeats,
      onLoadStart: (id) => {
        const index = loads.findIndex((test) => test.id === id)
        if (index < 0) return
        step = loads.length + index
        emit('multi', index)
      }
    })
    if (session.cancelled) return { ok: false, cancelled: true, error: 'Execução cancelada.' }

    step = totalSteps
    emit('multi', loads.length - 1)

    const perTest: BenchmarkTestScore[] = []
    const singleLoads: Array<{ id: string; mops: number }> = []
    const multiLoads: Array<{ id: string; mops: number }> = []

    for (const test of loads) {
      const single = singlePhase.measurements.get(test.id)
      const multi = multiPhase.measurements.get(test.id)
      if (!single || !multi) {
        throw new BenchmarkError('Uma das cargas não retornou resultado. Tente novamente.')
      }
      singleLoads.push({ id: test.id, mops: single.mops })
      multiLoads.push({ id: test.id, mops: multi.mops })
      perTest.push({
        id: test.id,
        label: test.label,
        single: roundScore(single.mops),
        multi: roundScore(multi.mops)
      })
    }

    const single = roundScore(weightedPhaseScore(singleLoads))
    const multi = roundScore(weightedPhaseScore(multiLoads))
    const ratio = Math.round(computeRatio(multi, single) * 100) / 100
    const unstable = singlePhase.unstable || multiPhase.unstable
    const durationMs = Math.max(0, Date.now() - startedAt)

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
      `benchmark concluído: single ${single} · multi ${multi} · ${threads} processo(s)${
        unstable ? ' · instável' : ''
      }`
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
      tests: perTest,
      unstable
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
    killChildren(session)
    if (activeBenchmark === session) activeBenchmark = null
  }
}

/** Cancela o run ativo (filhos mortos na hora); sem run, não faz nada. */
export function cancelBenchmark(): { ok: boolean; cancelled: boolean } {
  const session = activeBenchmark
  if (!session) return { ok: true, cancelled: false }
  session.cancelled = true
  killChildren(session)
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

function terminateWorkers(workers: Iterable<Worker>): void {
  for (const worker of workers) {
    // `terminate()` é assíncrono e nunca lança para worker já encerrado.
    void worker.terminate().catch(() => undefined)
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
      const worker = new Worker(BENCHMARK_STRESS_SOURCE, {
        eval: true
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
    // O handler não aceita parâmetros do renderer: cargas, processos e
    // repetições são decididas aqui — nada do renderer entra na execução.
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

  // Encerrar o app nunca pode deixar um filho/worker de carga girando.
  app.once('will-quit', () => {
    cancelBenchmark()
    stopStress()
  })
}
