import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Electron e store não existem no ambiente de teste: o benchmark só orquestra.
// O logger é silenciado para não poluir a saída (e não tentar tocar em disco).
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

import {
  BENCHMARK_TESTS,
  cancelBenchmark,
  getBenchmarkInfo,
  isBenchmarkBusy,
  runBenchmark,
  shouldStopForMissingAck,
  startStress,
  stopStress,
  type BenchmarkProgress
} from './benchmark'
import { BENCHMARK_RUNNER_SOURCE } from './benchmarkRunnerSource'
import { computeRatio } from './benchmarkScore'
import { addBenchmarkEntry } from './store'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isAlive(pid: number): boolean {
  try {
    // Sinal 0 só testa existência; no Windows o Node mapeia para OpenProcess.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntilDead(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await wait(50)
  }
  return !isAlive(pid)
}

/** Runner real, gravado em um diretório temporário (nunca no repositório). */
const runnerDir = mkdtempSync(join(tmpdir(), 'kolnd-benchmark-'))
const runnerScriptPath = join(runnerDir, 'kolnd-bench-runner.js')

beforeAll(() => {
  writeFileSync(runnerScriptPath, BENCHMARK_RUNNER_SOURCE, 'utf8')
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  // Nenhum teste pode deixar filho/worker vivo para o próximo.
  cancelBenchmark()
  stopStress()
})

describe('cálculos do benchmark', () => {
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

describe('runner real em processo filho', () => {
  it('executa SHA-256 nas duas fases, reporta progresso e persiste o resultado', async () => {
    const progress: BenchmarkProgress[] = []
    const result = await runBenchmark({
      tests: [{ id: 'sha', label: 'SHA-256' }],
      threads: 2,
      repeats: 1,
      runnerScriptPath,
      onProgress: (update) => progress.push(update)
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // `sha` só funciona se o runner conseguir usar `node:crypto` no filho.
    expect(result.tests).toHaveLength(1)
    expect(result.tests[0].single).toBeGreaterThan(0)
    expect(result.tests[0].multi).toBeGreaterThan(0)
    expect(result.single).toBeGreaterThan(0)
    expect(result.multi).toBeGreaterThan(0)
    expect(result.ratio).toBeGreaterThan(0)
    expect(result.threads).toBe(2)
    expect(result.durationMs).toBeGreaterThan(0)
    expect(typeof result.unstable).toBe('boolean')

    expect(progress.length).toBeGreaterThanOrEqual(4)
    expect(progress[0].phase).toBe('single')
    expect(progress[progress.length - 1].phase).toBe('multi')
    expect(progress[progress.length - 1].percent).toBe(100)
    expect(vi.mocked(addBenchmarkEntry)).toHaveBeenCalledTimes(1)
    expect(isBenchmarkBusy()).toBe(false)
  }, 60_000)
})

describe('teste de estresse', () => {
  it('start → stop resolve rápido e não deixa processo vivo', async () => {
    const startedAt = Date.now()
    const start = await startStress(null, { threads: 2, runnerScriptPath })
    expect(start.ok).toBe(true)
    expect(start.threads).toBe(2)
    expect(isBenchmarkBusy()).toBe(true)

    await wait(700)

    const stop = stopStress()
    const wallMs = Date.now() - startedAt
    expect(stop.ok).toBe(true)
    expect(typeof stop.checksumOk).toBe('boolean')
    expect(stop.elapsedMs).toBeGreaterThanOrEqual(600)
    expect(wallMs).toBeLessThan(3000)
    expect(isBenchmarkBusy()).toBe(false)

    // Se algum filho tivesse ficado preso, o estado continuaria "ocupado".
    const restart = await startStress(null, { threads: 1, runnerScriptPath })
    expect(restart.ok).toBe(true)
    expect(stopStress().ok).toBe(true)
  }, 15_000)

  it('bloqueia benchmark e um segundo estresse enquanto um teste roda', async () => {
    expect((await startStress(null, { threads: 1, runnerScriptPath })).ok).toBe(true)

    const secondStart = await startStress(null, { threads: 1, runnerScriptPath })
    expect(secondStart.ok).toBe(false)
    expect(secondStart.error).toContain('Já existe um teste em andamento')

    const busy = await runBenchmark({
      tests: [{ id: 'integers', label: 'Inteiros' }],
      threads: 1,
      repeats: 1,
      runnerScriptPath
    })
    expect(busy.ok).toBe(false)
    if (!busy.ok) expect(busy.error).toContain('Já existe um teste em andamento')

    expect(stopStress().ok).toBe(true)
    expect(isBenchmarkBusy()).toBe(false)
  }, 15_000)

  it('roda em processos filhos, agrega a integridade e não deixa órfãos', async () => {
    const pids: number[] = []
    const start = await startStress(null, {
      threads: 2,
      runnerScriptPath,
      onChild: (child) => {
        if (child.pid) pids.push(child.pid)
      }
    })
    expect(start.ok).toBe(true)
    expect(start.threads).toBe(2)
    expect(pids).toHaveLength(2)

    // Tempo para os filhos reportarem o checksum periódico (~500 ms).
    await wait(1200)

    const stop = stopStress()
    expect(stop.ok).toBe(true)
    expect(stop.checksumOk).toBe(true)

    for (const pid of pids) {
      expect(await waitUntilDead(pid)).toBe(true)
    }
  }, 15_000)

  it('marca falha de integridade quando um filho reporta checksum inválido', async () => {
    // Filho de mentira: só reporta uma amostra com checksum falso e fica vivo
    // até o stop (o teste de estresse não tem resultado final).
    const fake = join(runnerDir, 'fake-stress.js')
    writeFileSync(
      fake,
      [
        'process.stdout.write(\'{"type":"ready"}\\n\')',
        'setInterval(function () {',
        '  process.stdout.write(\'{"type":"stress","elapsedMs":500,"checksumOk":false}\\n\')',
        '}, 100)'
      ].join('\n'),
      'utf8'
    )

    const start = await startStress(null, { threads: 1, runnerScriptPath: fake })
    expect(start.ok).toBe(true)
    await wait(400)
    const stop = stopStress()
    expect(stop.ok).toBe(true)
    expect(stop.checksumOk).toBe(false)
  }, 15_000)
})

describe('cancelamento do benchmark', () => {
  it('cancela um run em andamento, mata o filho e devolve resultado de cancelamento', async () => {
    const promise = runBenchmark({
      tests: [{ id: 'sha', label: 'SHA-256' }],
      threads: 1,
      repeats: 5,
      runnerScriptPath
    })
    await wait(400)

    const cancel = cancelBenchmark()
    expect(cancel.cancelled).toBe(true)

    const result = await promise
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.cancelled).toBe(true)
      expect(result.error).toContain('cancelada')
    }
    expect(isBenchmarkBusy()).toBe(false)
  }, 20_000)
})

afterAll(() => {
  rmSync(runnerDir, { recursive: true, force: true })
})
