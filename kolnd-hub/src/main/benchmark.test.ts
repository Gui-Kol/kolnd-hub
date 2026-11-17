import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron e store não existem no ambiente de teste: o benchmark só orquestra.
// O logger é silenciado para não poluir a saída (e não tentar tocar em disco).
vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('electron', () => ({
  app: { once: vi.fn() },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('./store', () => ({
  addBenchmarkEntry: vi.fn(() => true),
  clearBenchmarkHistory: vi.fn(() => true),
  getBenchmarkHistory: vi.fn(() => [])
}))

import {
  BENCHMARK_TESTS,
  aggregateMops,
  cancelBenchmark,
  computeRatio,
  geometricMean,
  getBenchmarkInfo,
  isBenchmarkBusy,
  opsToMops,
  runBenchmark,
  shouldStopForMissingAck,
  startStress,
  stopStress,
  type BenchmarkProgress
} from './benchmark'
import { addBenchmarkEntry } from './store'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  // Nenhum teste pode deixar worker vivo para o próximo.
  cancelBenchmark()
  stopStress()
})

describe('cálculos do benchmark', () => {
  it('média geométrica ignora valores inválidos e lida com lista vazia', () => {
    expect(geometricMean([1, 4, 16])).toBeCloseTo(4, 10)
    expect(geometricMean([2, 8])).toBeCloseTo(4, 10)
    expect(geometricMean([])).toBe(0)
    expect(geometricMean([0, -1, NaN, Infinity])).toBe(0)
    expect(geometricMean([100, 0, 400])).toBeCloseTo(200, 10)
  })

  it('converte operações em MOps/s e agrega a fase multi pela soma/tempo', () => {
    expect(opsToMops(1_000_000, 1000)).toBeCloseTo(1, 10)
    expect(opsToMops(2_000_000, 500)).toBeCloseTo(4, 10)
    expect(opsToMops(1_000_000, 0)).toBe(0)
    // Dois workers em paralelo: soma das ops dividida pelo maior tempo.
    expect(
      aggregateMops([
        { ops: 1_000_000, elapsedMs: 600 },
        { ops: 1_000_000, elapsedMs: 600 }
      ])
    ).toBeCloseTo(3.3333, 3)
    expect(aggregateMops([])).toBe(0)
  })

  it('razão multi/single nunca divide por zero', () => {
    expect(computeRatio(800, 100)).toBe(8)
    expect(computeRatio(123.4, 0)).toBe(0)
    expect(computeRatio(NaN, 10)).toBe(0)
  })

  it('watchdog do estresse só dispara depois do timeout (e nunca com valores inválidos)', () => {
    // Renderer mandou ack agora: não para.
    expect(shouldStopForMissingAck(1000, 1000, 10_000)).toBe(false)
    expect(shouldStopForMissingAck(5000, 1000, 10_000)).toBe(false)
    // Ack velho: para.
    expect(shouldStopForMissingAck(11_001, 1000, 10_000)).toBe(true)
    // Entradas não finitas nunca derrubam a carga.
    expect(shouldStopForMissingAck(NaN, 1000)).toBe(false)
    expect(shouldStopForMissingAck(1000, NaN)).toBe(false)
  })

  it('as cinco cargas estão na ordem exibida na interface', () => {
    expect(BENCHMARK_TESTS.map((test) => test.id)).toEqual([
      'integers',
      'floats',
      'memory',
      'aes',
      'sha'
    ])
  })

  it('benchmarkInfo lê a CPU local', () => {
    const info = getBenchmarkInfo()
    expect(info.cores).toBeGreaterThan(0)
    expect(info.model.length).toBeGreaterThan(0)
  })
})

describe('worker real (eval + worker_threads + node:crypto)', () => {
  it('executa SHA-256 nas duas fases, reporta progresso e persiste o resultado', async () => {
    const progress: BenchmarkProgress[] = []
    const result = await runBenchmark({
      durationMs: 120,
      tests: [{ id: 'sha', label: 'SHA-256' }],
      threads: 1,
      onProgress: (update) => progress.push(update)
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // `sha` só funciona se require('node:crypto') funcionar no worker eval.
    expect(result.tests).toHaveLength(1)
    expect(result.tests[0].single).toBeGreaterThan(0)
    expect(result.tests[0].multi).toBeGreaterThan(0)
    expect(result.single).toBeGreaterThan(0)
    expect(result.multi).toBeGreaterThan(0)
    expect(result.ratio).toBeGreaterThan(0)
    expect(result.threads).toBe(1)
    expect(result.durationMs).toBe(120)

    expect(progress.length).toBeGreaterThanOrEqual(4)
    expect(progress[0].phase).toBe('single')
    expect(progress[progress.length - 1].phase).toBe('multi')
    expect(progress[progress.length - 1].percent).toBe(100)
    expect(vi.mocked(addBenchmarkEntry)).toHaveBeenCalledTimes(1)
    expect(isBenchmarkBusy()).toBe(false)
  }, 8000)
})

describe('teste de estresse', () => {
  it('start → stop resolve rápido e não deixa worker vivo', async () => {
    const startedAt = Date.now()
    const start = startStress(null)
    expect(start.ok).toBe(true)
    expect(start.threads).toBeGreaterThan(0)
    expect(isBenchmarkBusy()).toBe(true)

    await wait(700)

    const stop = stopStress()
    const wallMs = Date.now() - startedAt
    expect(stop.ok).toBe(true)
    expect(typeof stop.checksumOk).toBe('boolean')
    expect(stop.elapsedMs).toBeGreaterThanOrEqual(600)
    expect(wallMs).toBeLessThan(3000)
    expect(isBenchmarkBusy()).toBe(false)

    // Se algum worker tivesse ficado preso, o estado continuaria "ocupado".
    const restart = startStress(null)
    expect(restart.ok).toBe(true)
    expect(stopStress().ok).toBe(true)
  }, 8000)

  it('bloqueia benchmark e um segundo estresse enquanto um teste roda', async () => {
    expect(startStress(null).ok).toBe(true)

    const secondStart = startStress(null)
    expect(secondStart.ok).toBe(false)
    expect(secondStart.error).toContain('Já existe um teste em andamento')

    const busy = await runBenchmark({
      durationMs: 100,
      tests: [{ id: 'integers', label: 'Inteiros' }],
      threads: 1
    })
    expect(busy.ok).toBe(false)
    if (!busy.ok) expect(busy.error).toContain('Já existe um teste em andamento')

    expect(stopStress().ok).toBe(true)
    expect(isBenchmarkBusy()).toBe(false)
  }, 8000)
})

describe('cancelamento do benchmark', () => {
  it('cancela um run em andamento e devolve resultado de cancelamento', async () => {
    const promise = runBenchmark({
      durationMs: 3000,
      tests: [{ id: 'integers', label: 'Inteiros' }],
      threads: 1
    })
    await wait(150)

    const cancel = cancelBenchmark()
    expect(cancel.cancelled).toBe(true)

    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cancelled).toBe(true)
      expect(result.error).toContain('cancelada')
    }
    expect(isBenchmarkBusy()).toBe(false)
  }, 8000)
})
