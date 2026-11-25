import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { cpus, tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Regressão do teste de estresse de CPU (aba Benchmark em Meu PC).
 *
 * Objetivo: provar que o estresse usa **100% da CPU** (um processo por núcleo
 * lógico, como no CPU-Z) e que, mesmo assim, a interface continua respondendo
 * (o bug relatado foi o Hub "parar de funcionar" ao iniciar o teste). Mede, a
 * cada segundo, a latência de um `evaluate` no renderer e a latência do event
 * loop do main; durante a carga, mede a CPU do sistema por núcleo lógico; depois
 * para o teste e confere que o cronômetro parou, os processos morreram e a CPU
 * voltou ao normal.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

async function launchApp(): Promise<ElectronApplication> {
  const ctx = loadContext()
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
      PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
    }
  })
}

/** Abre Meu PC → aba Benchmark. */
async function openBenchmarkTab(window: Page): Promise<void> {
  await window.getByRole('button', { name: 'Meu PC' }).click()
  await expect(window.getByText('Manutenção e inicialização do seu PC')).toBeVisible({
    timeout: 15_000
  })
  await window.getByRole('tab', { name: 'Benchmark' }).click()
  await expect(window.getByRole('heading', { name: 'Benchmark de CPU' })).toBeVisible()
}

/** Latência (ms) de um round-trip renderer; -1 quando estourou o timeout. */
async function rendererPing(window: Page, timeoutMs: number): Promise<number> {
  const startedAt = Date.now()
  try {
    await window.evaluate(() => document.title, null, { timeout: timeoutMs })
    return Date.now() - startedAt
  } catch {
    return -1
  }
}

/** Latência (ms) de um round-trip no processo main; -1 quando estourou. */
async function mainPing(app: ElectronApplication, timeoutMs: number): Promise<number> {
  const startedAt = Date.now()
  try {
    await app.evaluate(() => process.uptime(), null, { timeout: timeoutMs })
    return Date.now() - startedAt
  } catch {
    return -1
  }
}

/** Começa a medir frame gaps (rAF) dentro do renderer — o que o usuário sente. */
async function startFrameProbe(window: Page): Promise<void> {
  await window.evaluate(() => {
    const scope = window as unknown as {
      __frameGaps?: number[]
      __frameStop?: () => void
    }
    const gaps: number[] = []
    let last = performance.now()
    let raf = 0
    const tick = (): void => {
      const now = performance.now()
      gaps.push(now - last)
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    scope.__frameGaps = gaps
    scope.__frameStop = () => cancelAnimationFrame(raf)
  })
}

interface FrameStats {
  frames: number
  maxGapMs: number
  p95GapMs: number
  over200ms: number
}

/** Encerra a sonda e devolve as estatísticas de fluidez. */
async function stopFrameProbe(window: Page): Promise<FrameStats> {
  return window.evaluate(() => {
    const scope = window as unknown as {
      __frameGaps?: number[]
      __frameStop?: () => void
    }
    scope.__frameStop?.()
    const gaps = (scope.__frameGaps ?? []).slice(1).sort((a, b) => a - b)
    const pick = (fraction: number): number =>
      gaps.length === 0 ? 0 : gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * fraction))]
    return {
      frames: gaps.length,
      maxGapMs: Math.round(gaps.length > 0 ? gaps[gaps.length - 1] : 0),
      p95GapMs: Math.round(pick(0.95)),
      over200ms: gaps.filter((gap) => gap > 200).length
    }
  })
}

interface CoreTimes {
  idle: number
  total: number
}

/** Tempos acumulados de cada núcleo lógico (`os.cpus()`), para medir deltas. */
function coreTimes(): CoreTimes[] {
  return cpus().map((cpu) => ({
    idle: cpu.times.idle,
    total: cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq
  }))
}

interface SystemCpu {
  /** Média de ocupação de todos os núcleos lógicos (0–100). */
  avg: number
  /** Quantos núcleos lógicos ficaram ≥ 90% ocupados. */
  coresAt90: number
  cores: number
  perCore: number[]
}

/**
 * Mede a CPU do sistema (todos os processos) num intervalo, por núcleo lógico.
 * `os.cpus()` devolve tempos acumulados: o delta entre duas leituras é a
 * ocupação real da máquina, que é onde os processos filhos do estresse vivem.
 */
async function measureSystemCpu(window: Page, durationMs: number): Promise<SystemCpu> {
  const before = coreTimes()
  await window.waitForTimeout(durationMs)
  const after = coreTimes()
  const cores = Math.min(before.length, after.length)
  let totalBusy = 0
  let coresAt90 = 0
  const perCore: number[] = []
  for (let index = 0; index < cores; index++) {
    const total = after[index].total - before[index].total
    const idle = after[index].idle - before[index].idle
    const busy = total > 0 ? (total - idle) / total : 0
    totalBusy += busy
    if (busy >= 0.9) coresAt90 += 1
    perCore.push(Math.round(busy * 1000) / 10)
  }
  return {
    avg: cores > 0 ? Math.round((totalBusy / cores) * 1000) / 10 : 0,
    coresAt90,
    cores,
    perCore
  }
}

test('estresse de CPU não deixa o Hub sem responder', async () => {
  test.setTimeout(180_000)
  const app = await launchApp()

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })
    await openBenchmarkTab(window)

    const startButton = window.getByRole('button', { name: 'Iniciar teste de estresse' })
    await startButton.click()
    await expect(window.getByRole('button', { name: 'Parar teste' })).toBeVisible({
      timeout: 15_000
    })

    const samples: Array<{ t: number; renderer: number; main: number; rssMb: number }> = []
    await startFrameProbe(window)
    for (let i = 0; i < 20; i++) {
      const renderer = await rendererPing(window, 5000)
      const main = await mainPing(app, 5000)
      const rss = await app
        .evaluate(() => Math.round(process.memoryUsage().rss / (1024 * 1024)))
        .catch(() => -1)
      samples.push({ t: i, renderer, main, rssMb: rss })
      await window.waitForTimeout(1000)
    }
    // Evidência objetiva do comportamento observado.
    const frameStats = await stopFrameProbe(window)
    console.log('[e2e][stress] samples:', JSON.stringify(samples))
    console.log('[e2e][stress] frames:', JSON.stringify(frameStats))

    // O renderer nunca pode ficar mudo (timeout de 5 s) durante o estresse.
    expect(samples.filter((s) => s.renderer === -1)).toEqual([])

    // E o cronômetro precisa continuar andando (prova de que a UI não congelou).
    const clockBefore = await window.locator('span.tabular-nums').first().innerText()
    await window.waitForTimeout(2500)
    const clockAfter = await window.locator('span.tabular-nums').first().innerText()
    expect(clockAfter).not.toBe(clockBefore)

    // Carga real: 5 s de CPU do sistema por núcleo lógico (os processos filhos
    // do estresse não pertencem ao main, então medir `process.cpuUsage()` ali
    // diria zero — o alvo é a máquina).
    const cpu = await measureSystemCpu(window, 5000)
    console.log('[e2e][stress] cpu:', JSON.stringify(cpu))

    // Integridade reportada pelos próprios filhos durante a carga.
    await expect(window.getByText('Integridade OK')).toBeVisible({ timeout: 10_000 })

    // Parada: precisa responder rápido e devolver a CPU (filhos encerrados).
    const stopStartedAt = Date.now()
    await window.getByRole('button', { name: 'Parar teste' }).click()
    await expect(window.getByRole('button', { name: 'Iniciar teste de estresse' })).toBeVisible({
      timeout: 15_000
    })
    const stopMs = Date.now() - stopStartedAt

    const cpuAfterStop = await measureSystemCpu(window, 1500)
    console.log('[e2e][stress] stopMs:', stopMs, 'cpuAfterStop:', JSON.stringify(cpuAfterStop))

    // A interface nunca pode ficar muda (timeout de 5 s) durante o estresse.
    expect(samples.filter((s) => s.renderer === -1)).toEqual([])

    // Fluidez: a interface pode pular frames, não travar por segundos.
    expect(frameStats.maxGapMs).toBeLessThan(200)
    expect(frameStats.p95GapMs).toBeLessThan(50)

    // Carga real: 100% da CPU (a mecânica do CPU-Z), sem duty cycle.
    expect(cpu.avg).toBeGreaterThanOrEqual(95)
    // Pelo menos 90% dos núcleos lógicos a ≥ 90%.
    expect(cpu.coresAt90).toBeGreaterThanOrEqual(Math.ceil(cpu.cores * 0.9))

    // Parada rápida e sem carga residual (nenhum filho órfão girando).
    expect(stopMs).toBeLessThan(1000)
    expect(cpuAfterStop.avg).toBeLessThan(50)

    // App continua vivo e navegável depois de parar.
    const pcName = (await window.locator('.title-bar [title]').first().innerText()).trim()
    await expect(window.getByRole('heading', { name: pcName, exact: true })).toBeVisible({
      timeout: 15_000
    })
  } finally {
    await app.close().catch(() => {
      try {
        app.process().kill()
      } catch {
        // já encerrado
      }
    })
  }
})
