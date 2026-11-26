import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

// Harness manual: sem a flag, skipped -- nao pesa no `npm run test:e2e`.
test.skip(process.env.KOLDND_HUB_PERF !== '1', 'harness de medicao: rode com KOLDND_HUB_PERF=1')

/**
 * Harness de medicao (task 00) -- linha do tempo de abertura.
 *
 * NAO entra no CI (roda junto com `perf-*.spec.ts`, invocado a mao). Mede FCP e
 * marcos de navegacao por Playwright (`performance.getEntriesByType`), sem
 * `performance.mark` no codigo de producao, em 3 execucoes (a primeira e
 * descartada como warm-up, como manda o plano).
 *
 * O segundo teste cobre o cenario B7: abrir com o HUD ligado, medir o primeiro
 * `hud:update` no renderer da sobreposicao e os processos criados nos primeiros
 * 10 s (count-spawns.ps1).
 *
 * Saidas brutas em `out/perf/` (ignorado pelo git).
 */

const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')
const OUT_DIR = join(process.cwd(), 'out', 'perf')
const SPAWN_SCRIPT = join(process.cwd(), 'scripts', 'perf', 'count-spawns.ps1')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

/** userData isolado por execucao: o HUD persistido de um teste nao vaza no outro. */
function seedUserData(hudVisible: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'kolnd-perf-startup-'))
  writeFileSync(join(dir, 'first-run-complete.flag'), '1', 'utf8')
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify(
      {
        // Mesmo formato do big-picture-games.spec: migracoes pendentes sao
        // aplicadas e o `hud` semeado (incluindo visible) e preservado.
        projectVersion: '1.4.0',
        hud: {
          shortcut: 'Shift+Insert',
          visible: hudVisible,
          width: 300,
          scale: 'normal'
        },
        hwmonIntervalMs: 500
      },
      null,
      2
    ),
    'utf8'
  )
  return dir
}

function launchEnv(userDataDir: string, stubsDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: userDataDir,
    PATH: `${stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
  // O build de producao precisa ser o alvo: dev server no ambiente do shell
  // carregaria o Vite e mediria outra coisa.
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_ENV
  return env
}

interface StartupMetrics {
  fcpMs: number | null
  firstPaintMs: number | null
  domContentLoadedMs: number | null
  loadEventEndMs: number | null
  responseEndMs: number | null
  timeOrigin: number
  wallClockToFirstWindowMs: number
  wallClockToHeadingMs: number
}

async function collectStartupMetrics(
  window: Page,
  launchStartedAt: number,
  firstWindowAt: number,
  headingAt: number
): Promise<StartupMetrics> {
  try {
    await window.waitForFunction(() => performance.getEntriesByType('paint').length > 0, null, {
      timeout: 20_000
    })
  } catch {
    // Sem paint entries: devolvemos nulls e o teste falha de forma legivel.
  }
  const raw = await window.evaluate(() => {
    const paints = performance.getEntriesByType('paint')
    const fcp = paints.find((entry) => entry.name === 'first-contentful-paint')
    const firstPaint = paints.find((entry) => entry.name === 'first-paint')
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined
    return {
      fcp: fcp ? fcp.startTime : null,
      firstPaint: firstPaint ? firstPaint.startTime : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      loadEventEnd: nav ? nav.loadEventEnd : null,
      responseEnd: nav ? nav.responseEnd : null,
      timeOrigin: performance.timeOrigin
    }
  })
  return {
    fcpMs: raw.fcp,
    firstPaintMs: raw.firstPaint,
    domContentLoadedMs: raw.domContentLoaded,
    loadEventEndMs: raw.loadEventEnd,
    responseEndMs: raw.responseEnd,
    timeOrigin: raw.timeOrigin,
    wallClockToFirstWindowMs: firstWindowAt - launchStartedAt,
    wallClockToHeadingMs: headingAt - launchStartedAt
  }
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

/** Executa um script de medicao sem bloquear o event loop do Playwright. */
function runPowerShell(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ...args],
      { cwd: process.cwd(), windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`PowerShell excedeu ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`PowerShell falhou (${code}): ${stderr || stdout}`))
        return
      }
      resolve(stdout)
    })
  })
}

/** Le o CSV do count-spawns e devolve total + contagem por nome. */
function parseSpawnCsv(file: string): { total: number; byName: Record<string, number> } {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const byName: Record<string, number> = {}
  let total = 0
  for (const line of lines) {
    const parts = line.split(',')
    if (parts.length !== 3) continue
    if (parts[0] === 'name') continue
    const count = Number(parts[1])
    if (!Number.isFinite(count)) continue
    if (parts[0] === 'TOTAL') {
      total = count
    } else {
      byName[parts[0]] = count
    }
  }
  return { total, byName }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

async function launchForStartup(hudVisible: boolean): Promise<{
  app: ElectronApplication
  window: Page
  userDataDir: string
  launchStartedAt: number
  firstWindowAt: number
  headingAt: number
}> {
  const ctx = loadContext()
  const userDataDir = seedUserData(hudVisible)
  const launchStartedAt = Date.now()
  const app = await electron.launch({
    args: ['.'],
    env: launchEnv(userDataDir, ctx.stubsDir)
  })
  // Com o HUD visivel, a janela da sobreposicao nasce ANTES da principal:
  // `firstWindow()` poderia devolver a rota #hud. Escolhemos explicitamente a
  // janela sem hash (a que tem o Dashboard).
  const window = await waitForMainWindow(app)
  const firstWindowAt = Date.now()
  await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
    timeout: 60_000
  })
  return { app, window, userDataDir, launchStartedAt, firstWindowAt, headingAt: Date.now() }
}

async function waitForMainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (!page.url().includes('#hud')) return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('janela principal nao apareceu em 60 s')
}

test('abertura: FCP e marcos de navegacao em 3 execucoes (1 warm-up descartado)', async () => {
  test.setTimeout(300_000)
  mkdirSync(OUT_DIR, { recursive: true })

  const results: StartupMetrics[] = []

  // Warm-up: disco frio/caches vazios nao entram na amostra (risco do plano).
  const warmup = await launchForStartup(false)
  await closeApp(warmup.app)
  try {
    rmSync(warmup.userDataDir, { recursive: true, force: true })
  } catch {
    // Arquivo preso (log/crashpad): o SO limpa o tmp depois.
  }

  for (let run = 1; run <= 3; run += 1) {
    const launched = await launchForStartup(false)
    try {
      const metrics = await collectStartupMetrics(
        launched.window,
        launched.launchStartedAt,
        launched.firstWindowAt,
        launched.headingAt
      )
      results.push(metrics)
      console.log(`[perf/startup] run=${run} ${JSON.stringify(metrics)}`)
    } finally {
      await closeApp(launched.app)
      try {
        rmSync(launched.userDataDir, { recursive: true, force: true })
      } catch {
        // best-effort
      }
    }
  }

  const payload = {
    kind: 'startup',
    measuredAt: new Date().toISOString(),
    runs: results
  }
  const outFile = join(OUT_DIR, `startup-${Date.now()}.json`)
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`[perf/startup] saida: ${outFile}`)
  console.log(`[perf/startup] ${JSON.stringify(payload)}`)

  const fcps = results.map((run) => run.fcpMs).filter((value): value is number => value !== null)
  expect(fcps, 'FCP precisa existir nas 3 execucoes').toHaveLength(3)
  expect(results.every((run) => (run.domContentLoadedMs ?? 0) > 0)).toBe(true)
  expect(results.every((run) => (run.loadEventEndMs ?? 0) > 0)).toBe(true)

  const center = median(fcps)
  const worstDeviation = Math.max(...fcps.map((value) => Math.abs(value - center) / center))
  console.log(
    `[perf/startup] FCPs=${JSON.stringify(fcps)} mediana=${center.toFixed(1)} ms desvioMax=${(worstDeviation * 100).toFixed(1)}%`
  )
  // Criterio T3: FCP dentro de +/-15%. Se a maquina estiver carregada, o teste
  // falha com o numero real no log -- nao ha valor "inventado".
  expect(worstDeviation, `FCP fora de +/-15% (${fcps.join(', ')} ms)`).toBeLessThanOrEqual(0.15)
})

test('B7: abrir com HUD ligado -- FCP, primeiro hud:update e spawns nos primeiros 10 s', async () => {
  test.setTimeout(300_000)
  mkdirSync(OUT_DIR, { recursive: true })

  // Launch proprio (nao usa launchForStartup): com HUD visivel, a sobreposicao
  // nasce antes da janela principal e precisamos anexar a sonda ANTES de
  // esperar o heading -- senao o "primeiro hud:update" ja teria passado.
  const ctx = loadContext()
  const userDataDir = seedUserData(true)
  const launchStartedAt = Date.now()
  const app = await electron.launch({
    args: ['.'],
    env: launchEnv(userDataDir, ctx.stubsDir)
  })
  const spawnOut = join(OUT_DIR, `b7-spawns-${Date.now()}.csv`)
  // Preenchidos depois de achar a janela principal; ficam no escopo do teste
  // para entrar no payload final sem depender do bloco interno.
  let firstWindowAt: number
  let headingAt: number

  try {
    const pid = app.process().pid
    expect(pid, 'PID do processo main do Electron').toBeTruthy()

    // O contador comeca junto com a abertura e roda enquanto esperamos o FCP.
    const spawnsPromise = runPowerShell([
      SPAWN_SCRIPT,
      '-RootPid',
      String(pid),
      '-Seconds',
      '10',
      '-OutFile',
      spawnOut
    ])

    // A janela do HUD nasce no bootstrap (visible=true persistido). Anexa a
    // sonda o quanto antes; o `capturedAt` do primeiro update, emitido pelo
    // main, e comparado com o instante do launch (nao depende de quando a
    // sonda anexou).
    const hudPage = await waitForHudPage(app)
    await hudPage.waitForFunction(
      () => Boolean((window as unknown as { api?: unknown }).api),
      null,
      {
        timeout: 30_000
      }
    )
    await hudPage.evaluate(() => {
      const scope = window as unknown as {
        __hudFirstUpdate?: { at: number; capturedAt: string } | null
        __hudStop?: () => void
      }
      scope.__hudFirstUpdate = null
      scope.__hudStop = window.api.onHudUpdate((update) => {
        if (!scope.__hudFirstUpdate) {
          scope.__hudFirstUpdate = { at: performance.now(), capturedAt: update.capturedAt }
        }
      })
    })

    const window = await waitForMainWindow(app)
    firstWindowAt = Date.now()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 60_000
    })
    headingAt = Date.now()

    const metrics = await collectStartupMetrics(window, launchStartedAt, firstWindowAt, headingAt)

    await hudPage.waitForFunction(
      () =>
        (window as unknown as { __hudFirstUpdate?: unknown }).__hudFirstUpdate !== null &&
        (window as unknown as { __hudFirstUpdate?: unknown }).__hudFirstUpdate !== undefined,
      null,
      { timeout: 15_000 }
    )
    const hudFirst = await hudPage.evaluate(
      () =>
        (
          window as unknown as {
            __hudFirstUpdate?: { at: number; capturedAt: string } | null
            __hudStop?: () => void
          }
        ).__hudFirstUpdate ?? null
    )
    await hudPage.evaluate(() => {
      ;(window as unknown as { __hudStop?: () => void }).__hudStop?.()
    })

    const spawnsText = await spawnsPromise
    const spawns = parseSpawnCsv(spawnOut)
    const firstHudUpdateMsSinceLaunch = hudFirst
      ? Date.parse(hudFirst.capturedAt) - launchStartedAt
      : null

    const payload = {
      kind: 'b7-startup-with-hud',
      measuredAt: new Date().toISOString(),
      startup: metrics,
      firstHudUpdateMsSinceLaunch,
      hudCaptureAt: hudFirst?.capturedAt ?? null,
      spawnsFirst10s: spawns,
      spawnsRaw: spawnsText.trim()
    }
    const outFile = join(OUT_DIR, `b7-${Date.now()}.json`)
    writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8')
    console.log(`[perf/b7] saida: ${outFile}`)
    console.log(`[perf/b7] ${JSON.stringify(payload)}`)

    expect(metrics.fcpMs).not.toBeNull()
    expect(firstHudUpdateMsSinceLaunch).not.toBeNull()
    expect(firstHudUpdateMsSinceLaunch ?? -1).toBeGreaterThan(0)
    expect(spawns.total).toBeGreaterThan(0)
  } finally {
    await closeApp(app)
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
})

async function waitForHudPage(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (page.url().includes('#hud')) return page
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('janela do HUD (#hud) nao apareceu em 30 s')
}
