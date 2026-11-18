import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunnerLoadResult } from './benchmarkRunner'

/**
 * Orquestração do benchmark (fases, retry, agregação, progresso) sem spawn real.
 *
 * O `runRunner` é mockado para produzir séries controladas: é a única forma de
 * exercitar a guarda de estabilidade (spread > 25 %) de forma determinística —
 * o runner real, num computador saudável, sempre devolve séries estáveis.
 */
const state = vi.hoisted(() => ({
  queue: [] as Array<Array<{ id: string; ops: number[]; ms: number[] }>>,
  calls: [] as Array<{ loads: string[]; repeats: number }>
}))

vi.mock('./benchmarkRunner', () => ({
  runRunner: vi.fn(async (options: { config: { loads: string[]; repeats: number } }) => {
    state.calls.push({ loads: [...options.config.loads], repeats: options.config.repeats })
    const next = state.queue.shift()
    if (!next) throw new Error('fila de resultados do teste esgotada')
    return next.map((load) => ({ ...load, guard: 'teste' }))
  })
}))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('electron', () => ({
  app: { once: vi.fn(), getPath: vi.fn(() => 'C:/tmp') },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('./store', () => ({
  addBenchmarkEntry: vi.fn(() => true),
  clearBenchmarkHistory: vi.fn(() => true),
  getBenchmarkHistory: vi.fn(() => [])
}))

import { runBenchmark } from './benchmark'

const RUNNER = 'C:/tmp/kolnd-bench-runner.js'

function series(id: string, ops: number[], ms: number[]): RunnerLoadResult[] {
  return [{ id, ops, ms, guard: 'teste' }]
}

beforeEach(() => {
  state.queue = []
  state.calls = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('guarda de estabilidade e retry', () => {
  it('repete só a carga instável uma vez e usa a mediana nova', async () => {
    // Single instável (spread 2×), retry estável; multi estável nas duas.
    state.queue = [
      series('integers', [1_000_000, 1_000_000, 3_000_000], [100, 100, 100]),
      series('integers', [1_000_000, 1_000_000, 1_000_000], [100, 100, 100]),
      series('integers', [1_000_000, 1_000_000, 1_000_000], [100, 100, 100])
    ]

    const result = await runBenchmark({
      tests: [{ id: 'integers', label: 'Inteiros' }],
      threads: 1,
      repeats: 3,
      runnerScriptPath: RUNNER
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.unstable).toBe(false)
    // Retry pediu apenas a carga instável, com as mesmas repetições.
    expect(state.calls).toHaveLength(3)
    expect(state.calls[1]).toEqual({ loads: ['integers'], repeats: 3 })
    // Mediana da série nova: 1M ops / 100 ms = 10 MOps/s.
    expect(result.tests[0].single).toBe(10)
  })

  it('instabilidade persistente vira badge e o número continua sendo exibido', async () => {
    state.queue = [
      series('integers', [1_000_000, 1_000_000, 3_000_000], [100, 100, 100]),
      series('integers', [1_000_000, 1_000_000, 3_000_000], [100, 100, 100]),
      series('integers', [1_000_000, 1_000_000, 1_000_000], [100, 100, 100])
    ]

    const result = await runBenchmark({
      tests: [{ id: 'integers', label: 'Inteiros' }],
      threads: 1,
      repeats: 3,
      runnerScriptPath: RUNNER
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.unstable).toBe(true)
    // Nunca um retry infinito: uma repetição por fase, no máximo.
    expect(state.calls).toHaveLength(3)
    expect(result.tests[0].single).toBeGreaterThan(0)
  })
})

describe('agregação e contrato de progresso', () => {
  it('multi soma as operações e divide pelo maior tempo de cada passo', async () => {
    state.queue = [
      // Single: 1M ops / 100 ms.
      series('integers', [1_000_000], [100]),
      // Dois filhos: 1M/100ms e 1M/200ms ⇒ (2M) / 200 ms = 10 MOps/s.
      series('integers', [1_000_000], [100]),
      series('integers', [1_000_000], [200])
    ]

    const result = await runBenchmark({
      tests: [{ id: 'integers', label: 'Inteiros' }],
      threads: 2,
      repeats: 1,
      runnerScriptPath: RUNNER
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.threads).toBe(2)
    expect(result.tests[0].single).toBe(10)
    expect(result.tests[0].multi).toBe(10)
    // A fase multi só termina quando os DOIS filhos respondem.
    expect(state.calls).toHaveLength(3)
  })

  it('progresso cobre as duas fases e termina em 100 %', async () => {
    state.queue = [series('sha', [100], [100]), series('sha', [100], [100])]
    const updates: Array<{ phase: string; percent: number; testIndex: number }> = []

    const result = await runBenchmark({
      tests: [{ id: 'sha', label: 'SHA-256' }],
      threads: 1,
      repeats: 1,
      runnerScriptPath: RUNNER,
      onProgress: (update) =>
        updates.push({ phase: update.phase, percent: update.percent, testIndex: update.testIndex })
    })

    expect(result.ok).toBe(true)
    expect(updates[0].phase).toBe('single')
    expect(updates[0].percent).toBe(0)
    expect(updates.some((update) => update.phase === 'multi')).toBe(true)
    expect(updates[updates.length - 1].percent).toBe(100)
    expect(updates[updates.length - 1].testIndex).toBe(1)
  })
})
