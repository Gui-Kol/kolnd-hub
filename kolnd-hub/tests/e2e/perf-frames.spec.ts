import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { cpus, tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

// Harness manual: sem a flag, skipped -- nao pesa no `npm run test:e2e`.
test.skip(process.env.KOLDND_HUB_PERF !== '1', 'harness de medicao: rode com KOLDND_HUB_PERF=1')

/**
 * Harness de medicao (task 00) -- frames e long tasks do renderer.
 *
 * Reaproveita a tecnica do benchmark-stress.spec.ts (frame gaps por rAF) e
 * acrescenta p50, gaps > 100 ms e PerformanceObserver('longtask'). Mede 60 s na
 * Dashboard (T4) e 60 s na grade do Big Picture com 40 jogos semeados (B6).
 *
 * Fora do CI: e instrumento de baseline, nao um gate funcional. O criterio duro
 * aqui e "coletou amostras"; o p95 e registrado com a carga da maquina ao lado
 * (maquina carregada -> numero real, nunca inventado).
 */

const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')
const OUT_DIR = join(process.cwd(), 'out', 'perf')
const GAME_COUNT = 40
const PROBE_MS = 60_000

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

interface SystemCpuSample {
  busy: number
  idle: number
}

function systemCpuSample(): SystemCpuSample {
  let busy = 0
  let idle = 0
  for (const cpu of cpus()) {
    busy += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq
    idle += cpu.times.idle
  }
  return { busy, idle }
}

/** Carga da maquina durante a janela (para nao comparar run ociosa com carregada). */
function systemCpuPercentBetween(before: SystemCpuSample, after: SystemCpuSample): number {
  const busy = after.busy - before.busy
  const idle = after.idle - before.idle
  const total = busy + idle
  return total > 0 ? Math.round((busy / total) * 1000) / 10 : 0
}

/** Executaveis reais e distintos do Windows (o store deduplica por exePath). */
function seedExePaths(count: number): string[] {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const dirs = [
    join(systemRoot, 'System32'),
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0')
  ]
  const paths: string[] = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (paths.length >= count) break
      if (!name.toLowerCase().endsWith('.exe')) continue
      const full = join(dir, name)
      if (paths.includes(full)) continue
      paths.push(full)
    }
  }
  return paths
}

function seededGamepad(): Record<string, unknown> {
  return {
    profile: 'xbox',
    controllerId: 'e2e-controller',
    controllerName: 'Controle E2E',
    mapping: {
      confirm: 0,
      back: 1,
      up: 12,
      down: 13,
      left: 14,
      right: 15,
      menu: 9,
      options: 8,
      tab_prev: 4,
      tab_next: 5,
      stick_left: 10,
      stick_right: 11
    },
    autoMapped: true,
    configuredAt: '2026-01-01T00:00:00.000Z'
  }
}

function seedUserData(withGames: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'kolnd-perf-frames-'))
  writeFileSync(join(dir, 'first-run-complete.flag'), '1', 'utf8')
  const config: Record<string, unknown> = {
    projectVersion: '1.4.0',
    hwmonIntervalMs: 500
  }
  if (withGames) {
    const exePaths = seedExePaths(GAME_COUNT)
    expect(exePaths.length, 'System32 precisa ter 40 executaveis distintos').toBe(GAME_COUNT)
    config.games = exePaths.map((exePath, index) => ({
      id: `e2e-game-${index + 1}`,
      name: `Jogo de Teste ${index + 1}`,
      exePath,
      iconPath: null,
      origin: 'custom',
      addedAt: '2026-01-01T00:00:00.000Z'
    }))
    config.gamepad = seededGamepad()
  }
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
  return dir
}

function launchEnv(userDataDir: string, stubsDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: userDataDir,
    PATH: `${stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_ENV
  return env
}

async function launchApp(userDataDir: string, stubsDir: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], env: launchEnv(userDataDir, stubsDir) })
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close().catch(() => {
    try {
      app.process().kill()
    } catch {
      // processo ja encerrado
    }
  })
}

/** Liga a sonda de frames + long tasks no renderer (mesmo padrao do stress). */
async function startFrameProbe(window: Page): Promise<void> {
  await window.evaluate(() => {
    const scope = window as unknown as {
      __frameGaps?: number[]
      __longTasks?: Array<{ start: number; duration: number }>
      __frameStop?: () => void
    }
    const gaps: number[] = []
    const longTasks: Array<{ start: number; duration: number }> = []
    let last = performance.now()
    let raf = 0
    const tick = (): void => {
      const now = performance.now()
      gaps.push(now - last)
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({ start: entry.startTime, duration: entry.duration })
        }
      })
      // buffered: pega tarefas ja concluidas desde a navegacao (sem isso o
      // observer so veria o que acontecesse depois da sonda).
      observer.observe({ type: 'longtask', buffered: true })
    } catch {
      // Chromium sem suporte a longtask: as demais metricas seguem validas.
      observer = null
    }

    scope.__frameGaps = gaps
    scope.__longTasks = longTasks
    scope.__frameStop = () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  })
}

interface FrameStats {
  frames: number
  p50GapMs: number
  p95GapMs: number
  maxGapMs: number
  gapsOver100ms: number
  longTasks: number
  longTaskMaxMs: number
  longTaskTotalMs: number
}

async function stopFrameProbe(window: Page): Promise<FrameStats> {
  return window.evaluate(() => {
    const scope = window as unknown as {
      __frameGaps?: number[]
      __longTasks?: Array<{ start: number; duration: number }>
      __frameStop?: () => void
    }
    scope.__frameStop?.()
    // O primeiro gap e o intervalo entre o start e o primeiro rAF; descartamos.
    const gaps = (scope.__frameGaps ?? []).slice(1).sort((a, b) => a - b)
    const pick = (fraction: number): number =>
      gaps.length === 0 ? 0 : gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * fraction))]
    const longTasks = scope.__longTasks ?? []
    return {
      frames: gaps.length,
      p50GapMs: Math.round(pick(0.5) * 100) / 100,
      p95GapMs: Math.round(pick(0.95) * 100) / 100,
      maxGapMs: Math.round((gaps.length > 0 ? gaps[gaps.length - 1] : 0) * 100) / 100,
      gapsOver100ms: gaps.filter((gap) => gap > 100).length,
      longTasks: longTasks.length,
      longTaskMaxMs:
        Math.round(longTasks.reduce((max, task) => Math.max(max, task.duration), 0) * 100) / 100,
      longTaskTotalMs:
        Math.round(longTasks.reduce((sum, task) => sum + task.duration, 0) * 100) / 100
    }
  })
}

function writeResult(label: string, stats: FrameStats, extra: Record<string, unknown>): void {
  mkdirSync(OUT_DIR, { recursive: true })
  const payload = {
    kind: 'frames',
    label,
    measuredAt: new Date().toISOString(),
    durationMs: PROBE_MS,
    logicalCores: cpus().length,
    stats,
    ...extra
  }
  const file = join(OUT_DIR, `frames-${label}-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`[perf/frames] ${label} saida: ${file}`)
  console.log(`[perf/frames] ${JSON.stringify(payload)}`)
}

interface ProbeRun {
  stats: FrameStats
  systemCpuPercent: number
}

async function runProbe(window: Page): Promise<ProbeRun> {
  const systemBefore = systemCpuSample()
  await startFrameProbe(window)
  await window.waitForTimeout(PROBE_MS)
  const stats = await stopFrameProbe(window)
  const systemAfter = systemCpuSample()
  return { stats, systemCpuPercent: systemCpuPercentBetween(systemBefore, systemAfter) }
}

/**
 * Traz a janela principal para frente pelo main do Electron. `page.bringToFront`
 * sozinho nao tira a janela de tras de um app em tela cheia quando ela nunca
 * recebeu foco; show()+focus()+moveTop() e o caminho que o usuario faria.
 */
async function focusMainWindow(app: ElectronApplication): Promise<void> {
  await app
    .evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.webContents.getURL().includes('#hud')
      )
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.moveTop()
    })
    .catch(() => undefined)
}

/**
 * Visibilidade importa: janela oclusa/minimizada faz o Chromium throttlar rAF
 * para ~1 Hz (59 frames em 60 s ja observados). Isso e medicao invalida, nao
 * regressao do app -- focamos a janela e repetimos UMA vez. Apenas a tentativa
 * valida e gravada em `out/perf/` (as invalidas nao entram no resumo).
 */
async function measureFrames(
  app: ElectronApplication,
  window: Page,
  label: string,
  extra: Record<string, unknown>
): Promise<FrameStats> {
  await focusMainWindow(app)
  await window.bringToFront().catch(() => undefined)
  await window.waitForTimeout(700)
  let accepted = await runProbe(window)
  let attempts = 1
  if (accepted.stats.frames < 300) {
    console.warn(
      `[perf/frames] ${label}: apenas ${accepted.stats.frames} frames em 60 s (janela oclusa?); repetindo`
    )
    await focusMainWindow(app)
    await window.bringToFront().catch(() => undefined)
    await window.waitForTimeout(1000)
    accepted = await runProbe(window)
    attempts = 2
  }
  writeResult(label, accepted.stats, {
    ...extra,
    attempts,
    systemCpuPercent: accepted.systemCpuPercent
  })
  expect(accepted.stats.frames, `a sonda precisa coletar frames (${label})`).toBeGreaterThan(100)
  if (accepted.stats.p95GapMs >= 16.7) {
    console.warn(
      `[perf/frames] p95 ${accepted.stats.p95GapMs} ms acima do orcamento de 16,7 ms -- registrar a carga da maquina no relatorio`
    )
  }
  return accepted.stats
}

test('frames: Dashboard por 60 s', async () => {
  test.setTimeout(300_000)
  const ctx = loadContext()
  const userDataDir = seedUserData(false)
  const app = await launchApp(userDataDir, ctx.stubsDir)
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 60_000
    })
    // Deixa o pos-carregamento (icones/seed) assentar antes do probe.
    await window.waitForTimeout(3000)

    await measureFrames(app, window, 'dashboard', {})
  } finally {
    await closeApp(app)
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
})

test('B6: Big Picture com 40 jogos -- frames/long tasks por 60 s', async () => {
  test.setTimeout(300_000)
  const ctx = loadContext()
  const userDataDir = seedUserData(true)
  const app = await launchApp(userDataDir, ctx.stubsDir)
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 60_000
    })

    await window.getByRole('button', { name: 'Entrar no modo Big Picture' }).click()
    const listbox = window.getByRole('listbox', { name: 'Jogos na sua biblioteca' })
    await expect(listbox).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('40 jogos', { exact: true })).toBeVisible()

    // Grade estavel, sem navegacao: mede o custo de manter o Big Picture vivo.
    await window.waitForTimeout(2000)
    await measureFrames(app, window, 'big-picture', { games: GAME_COUNT })
  } finally {
    await closeApp(app)
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
})
