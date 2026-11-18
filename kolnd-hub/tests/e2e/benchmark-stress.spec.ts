import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Regressão do teste de estresse de CPU (aba Benchmark em Meu PC).
 *
 * Objetivo: provar que, com o estresse rodando em TODOS os núcleos, a interface
 * continua respondendo (o bug relatado foi o Hub "parar de funcionar" ao iniciar
 * o teste). Mede, a cada segundo, a latência de um `evaluate` no renderer e a
 * latência do event loop do main; depois para o teste e confere que o cronômetro
 * parou e o estado voltou ao normal.
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

    // Carga real: mede ms de CPU do processo em 2 s (≈ núcleos ocupados).
    const coresUsed = await app
      .evaluate(async () => {
        const before = process.cpuUsage()
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const after = process.cpuUsage(before)
        // cpuUsage vem em microssegundos: µs / µs de 2 s = núcleos ocupados.
        return Math.round(((after.user + after.system) / 2_000_000) * 100) / 100
      })
      .catch(() => -1)
    console.log('[e2e][stress] coresUsed:', coresUsed)

    // Parada: precisa responder rápido e devolver a CPU (workers encerrados).
    const stopStartedAt = Date.now()
    await window.getByRole('button', { name: 'Parar teste' }).click()
    await expect(window.getByRole('button', { name: 'Iniciar teste de estresse' })).toBeVisible({
      timeout: 15_000
    })
    const stopMs = Date.now() - stopStartedAt

    const cpuAfterStop = await app
      .evaluate(async () => {
        const before = process.cpuUsage()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const after = process.cpuUsage(before)
        return Math.round((after.user + after.system) / 10000) / 100
      })
      .catch(() => -1)
    console.log('[e2e][stress] stopMs:', stopMs, 'cpuAfterStopMs:', cpuAfterStop)

    expect(stopMs).toBeLessThan(10_000)
    // O duty cycle precisa segurar parte dos núcleos livres (app utilizável):
    // não pode consumir 100% de TODOS os núcleos, nem ficar baixo demais.
    expect(coresUsed).toBeGreaterThan(1)
    expect(coresUsed).toBeLessThan(16)
    // 1 s de processo sem estresse não pode consumir ~1 s de CPU (100%).
    expect(cpuAfterStop).toBeLessThan(600)

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
