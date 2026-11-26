import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { cpus, tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

// Harness manual: sem a flag, skipped -- nao pesa no `npm run test:e2e`.
test.skip(process.env.KOLDND_HUB_PERF !== '1', 'harness de medicao: rode com KOLDND_HUB_PERF=1')

/**
 * Harness de medicao (task 00) -- cenarios B1..B5 do baseline.
 *
 * Cada teste abre o app com userData isolado, monta o cenario e roda os scripts
 * PowerShell:
 *   - measure-process.ps1: CPU/RAM da arvore de processos (60 s);
 *   - count-spawns.ps1: PIDs novos por nome (30 s, DEPOIS da medicao de CPU --
 *     a consulta CIM a cada ~100 ms pesa e distorceria o CPU medido).
 *
 * Saidas brutas em `out/perf/` (ignorado pelo git). NAO roda no CI.
 */

const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')
const OUT_DIR = join(process.cwd(), 'out', 'perf')
const MEASURE_SCRIPT = join(process.cwd(), 'scripts', 'perf', 'measure-process.ps1')
const SPAWN_SCRIPT = join(process.cwd(), 'scripts', 'perf', 'count-spawns.ps1')

const CPU_SECONDS = 60
const SPAWN_SECONDS = 30

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

function seedUserData(options: { hudVisible?: boolean; hwmonIntervalMs?: number }): string {
  const dir = mkdtempSync(join(tmpdir(), 'kolnd-perf-scenario-'))
  writeFileSync(join(dir, 'first-run-complete.flag'), '1', 'utf8')
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify(
      {
        projectVersion: '1.4.0',
        hud: {
          shortcut: 'Shift+Insert',
          visible: options.hudVisible === true,
          width: 300,
          scale: 'normal'
        },
        hwmonIntervalMs: options.hwmonIntervalMs ?? 500
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
  delete env.ELECTRON_RENDERER_URL
  delete env.NODE_ENV
  return env
}

/** Executa um script de medicao sem bloquear o event loop do Playwright. */
function runPowerShell(args: string[], timeoutMs = 180_000): Promise<string> {
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

function parseKeyValues(line: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of line.split(',').slice(1)) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    result[part.slice(0, separator)] = part.slice(separator + 1)
  }
  return result
}

interface MeasureSummary {
  csv: string
  samples: number
  cores: number
  avgCpuPercent: number
  p95CpuPercent: number
  maxCpuPercent: number
  avgCpuPercentOfMachine: number
  avgWorkingSetMb: number
  p95WorkingSetMb: number
  avgPrivateMb: number
  p95PrivateMb: number
  /** Carga da MAQUINA durante a janela -- indispensavel para comparar runs. */
  systemCpuPercent: number
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

function systemCpuPercentBetween(before: SystemCpuSample, after: SystemCpuSample): number {
  const busy = after.busy - before.busy
  const idle = after.idle - before.idle
  const total = busy + idle
  return total > 0 ? Math.round((busy / total) * 1000) / 10 : 0
}

async function measureCpuRam(label: string, pid: number, seconds: number): Promise<MeasureSummary> {
  mkdirSync(OUT_DIR, { recursive: true })
  const csv = join(OUT_DIR, `${label}-cpu-${Date.now()}.csv`)
  const systemBefore = systemCpuSample()
  const stdout = await runPowerShell([
    MEASURE_SCRIPT,
    '-RootPid',
    String(pid),
    '-Seconds',
    String(seconds),
    '-OutFile',
    csv,
    '-Label',
    label
  ])
  const systemAfter = systemCpuSample()
  const line = (stdout || readFileSync(csv, 'utf8'))
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith('#SUMMARY,'))
  if (!line) throw new Error(`resumo ausente em ${csv}`)
  const fields = parseKeyValues(line)
  return {
    csv,
    samples: Number(fields.samples ?? 0),
    cores: Number(fields.cores ?? 0),
    avgCpuPercent: Number(fields.avgCpuPercent ?? 0),
    p95CpuPercent: Number(fields.p95CpuPercent ?? 0),
    maxCpuPercent: Number(fields.maxCpuPercent ?? 0),
    avgCpuPercentOfMachine: Number(fields.avgCpuPercentOfMachine ?? 0),
    avgWorkingSetMb: Number(fields.avgWorkingSetMb ?? 0),
    p95WorkingSetMb: Number(fields.p95WorkingSetMb ?? 0),
    avgPrivateMb: Number(fields.avgPrivateMb ?? 0),
    p95PrivateMb: Number(fields.p95PrivateMb ?? 0),
    systemCpuPercent: systemCpuPercentBetween(systemBefore, systemAfter)
  }
}

interface SpawnEvent {
  timestamp: string
  name: string
  pid: number
}

interface SpawnResult {
  csv: string
  seconds: number
  total: number
  perMinute: number
  byName: Record<string, { count: number; perMinute: number }>
  events: SpawnEvent[]
}

async function countSpawns(label: string, pid: number, seconds: number): Promise<SpawnResult> {
  mkdirSync(OUT_DIR, { recursive: true })
  const csv = join(OUT_DIR, `${label}-spawns-${Date.now()}.csv`)
  await runPowerShell([
    SPAWN_SCRIPT,
    '-RootPid',
    String(pid),
    '-Seconds',
    String(seconds),
    '-OutFile',
    csv
  ])
  const text = readFileSync(csv, 'utf8')
  let total = 0
  let perMinute = 0
  let measuredSeconds = seconds
  const byName: Record<string, { count: number; perMinute: number }> = {}
  const events: SpawnEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#SPAWN,')) {
      const [, timestamp, name, eventPid] = line.split(',')
      events.push({ timestamp, name, pid: Number(eventPid) })
      continue
    }
    if (line.startsWith('# count-spawns:')) {
      const match = /seconds=(\d+)/.exec(line)
      if (match) measuredSeconds = Number(match[1])
      continue
    }
    const parts = line.split(',')
    if (parts.length !== 3 || parts[0] === 'name') continue
    const count = Number(parts[1])
    const rate = Number(parts[2])
    if (!Number.isFinite(count)) continue
    if (parts[0] === 'TOTAL') {
      total = count
      perMinute = rate
    } else {
      byName[parts[0]] = { count, perMinute: rate }
    }
  }
  return { csv, seconds: measuredSeconds, total, perMinute, byName, events }
}

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  return sorted[index]
}

/** Intervalos (ms) entre eventos consecutivos de um nome (ex.: nvidia-smi/tick). */
function gapsFor(events: SpawnEvent[], name: string): number[] {
  const times = events
    .filter((event) => event.name === name)
    .map((event) => Date.parse(event.timestamp))
    .filter((value) => Number.isFinite(value))
  const gaps: number[] = []
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1])
  return gaps
}

function summarizeGaps(gaps: number[]): {
  samples: number
  meanMs: number
  p95Ms: number
  maxMs: number
} {
  if (gaps.length === 0) return { samples: 0, meanMs: 0, p95Ms: 0, maxMs: 0 }
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
  return {
    samples: gaps.length,
    meanMs: Math.round(mean),
    p95Ms: Math.round(quantile(gaps, 0.95)),
    maxMs: Math.round(Math.max(...gaps))
  }
}

interface Launched {
  app: ElectronApplication
  window: Page
  userDataDir: string
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

async function launchScenario(options: { hudVisible?: boolean } = {}): Promise<Launched> {
  const ctx = loadContext()
  const userDataDir = seedUserData(options)
  const app = await electron.launch({
    args: ['.'],
    env: launchEnv(userDataDir, ctx.stubsDir)
  })
  const window = await waitForMainWindow(app)
  await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
    timeout: 60_000
  })
  return { app, window, userDataDir }
}

async function finish(launched: Launched): Promise<void> {
  await launched.app.close().catch(() => {
    try {
      launched.app.process().kill()
    } catch {
      // processo ja encerrado
    }
  })
  try {
    rmSync(launched.userDataDir, { recursive: true, force: true })
  } catch {
    // Arquivo preso (log/crashpad): o SO limpa o tmp depois.
  }
}

/** Fecha a janela principal pelo X -- o handler do main oculta para a bandeja. */
async function closeToTray(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.webContents.getURL().includes('#hud')
    )
    main?.close()
  })
  await expect
    .poll(
      async () =>
        app.evaluate(({ BrowserWindow }) => {
          const main = BrowserWindow.getAllWindows().find(
            (candidate) => !candidate.webContents.getURL().includes('#hud')
          )
          return main ? main.isVisible() : false
        }),
      { timeout: 15_000 }
    )
    .toBe(false)
}

function writeScenario(label: string, data: Record<string, unknown>): void {
  mkdirSync(OUT_DIR, { recursive: true })
  const payload = {
    kind: 'scenario',
    label,
    measuredAt: new Date().toISOString(),
    cpuSeconds: CPU_SECONDS,
    spawnSeconds: SPAWN_SECONDS,
    ...data
  }
  const file = join(OUT_DIR, `scenario-${label}-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`[perf/${label}] saida: ${file}`)
  console.log(`[perf/${label}] ${JSON.stringify(payload)}`)
}

test('B1: Dashboard visivel -- CPU/RAM 60 s + spawns 30 s', async () => {
  test.setTimeout(300_000)
  const launched = await launchScenario()
  try {
    const pid = launched.app.process().pid
    expect(pid).toBeTruthy()
    // Deixa o reparo de icones/seed terminar para nao medir a abertura.
    await launched.window.waitForTimeout(3000)
    const cpu = await measureCpuRam('b1-dashboard', pid as number, CPU_SECONDS)
    const spawns = await countSpawns('b1-dashboard', pid as number, SPAWN_SECONDS)
    writeScenario('b1-dashboard', { cpu, spawns })
    expect(cpu.samples).toBeGreaterThanOrEqual(CPU_SECONDS - 1)
  } finally {
    await finish(launched)
  }
})

test('B2: bandeja com HUD desligado -- CPU/RAM 60 s + spawns 30 s', async () => {
  test.setTimeout(300_000)
  const launched = await launchScenario()
  try {
    const pid = launched.app.process().pid
    expect(pid).toBeTruthy()
    await closeToTray(launched.app)
    await launched.window.waitForTimeout(3000)
    const cpu = await measureCpuRam('b2-tray-hud-off', pid as number, CPU_SECONDS)
    const spawns = await countSpawns('b2-tray-hud-off', pid as number, SPAWN_SECONDS)
    writeScenario('b2-tray-hud-off', { cpu, spawns })
    expect(cpu.samples).toBeGreaterThanOrEqual(CPU_SECONDS - 1)
  } finally {
    await finish(launched)
  }
})

test('B3: bandeja com HUD ligado -- CPU/RAM 60 s + spawns 30 s', async () => {
  test.setTimeout(300_000)
  const launched = await launchScenario()
  try {
    const pid = launched.app.process().pid
    expect(pid).toBeTruthy()
    // Liga o HUD pelo renderer (mesmo caminho do atalho global/IPC).
    const status = await launched.window.evaluate(() => window.api.hudSetVisible(true))
    expect(status.config.visible).toBe(true)
    await expect
      .poll(
        () =>
          launched.app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().some(
              (candidate) =>
                candidate.webContents.getURL().includes('#hud') && candidate.isVisible()
            )
          ),
        { timeout: 20_000 }
      )
      .toBe(true)
    // O polling do hwmon sobe com a sobreposicao: deixa o primeiro ciclo assentar.
    await launched.window.waitForTimeout(5000)
    await closeToTray(launched.app)
    const cpu = await measureCpuRam('b3-tray-hud-on', pid as number, CPU_SECONDS)
    const spawns = await countSpawns('b3-tray-hud-on', pid as number, SPAWN_SECONDS)
    writeScenario('b3-tray-hud-on', { cpu, spawns, hud: status })
    expect(cpu.samples).toBeGreaterThanOrEqual(CPU_SECONDS - 1)
  } finally {
    await finish(launched)
  }
})

test('B4: aba Monitor a 0,5 s -- CPU/RAM 60 s, cadencia do hwmon e spawns 30 s', async () => {
  test.setTimeout(300_000)
  const launched = await launchScenario()
  const window = launched.window
  try {
    const pid = launched.app.process().pid
    expect(pid).toBeTruthy()
    await window.getByRole('button', { name: 'Meu PC' }).click()
    await expect(window.getByText('Manutenção e inicialização do seu PC')).toBeVisible({
      timeout: 15_000
    })
    await window.getByRole('tab', { name: 'Monitor' }).click()
    await expect(window.getByRole('heading', { name: 'Monitor de hardware' })).toBeVisible()
    const interval = await window.evaluate(() => window.api.hwmonSetInterval(500))
    expect(interval.intervalMs).toBe(500)

    // Cadencia efetiva dos pushes do hwmon (o tick real pode ser maior que o
    // intervalo pedido; sem instrumentar producao, este e o numero observavel).
    await window.evaluate(() => {
      const scope = window as unknown as { __hwTicks?: number[]; __hwStop?: () => void }
      scope.__hwTicks = []
      scope.__hwStop = window.api.onHwMonitorUpdate(() => {
        scope.__hwTicks?.push(performance.now())
      })
    })
    await window.waitForTimeout(3000)

    const cpu = await measureCpuRam('b4-monitor', pid as number, CPU_SECONDS)
    const ticks = await window.evaluate(() => {
      const scope = window as unknown as { __hwTicks?: number[]; __hwStop?: () => void }
      scope.__hwStop?.()
      const times = scope.__hwTicks ?? []
      const gaps: number[] = []
      for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1])
      const sorted = [...gaps].sort((a, b) => a - b)
      const pick = (fraction: number): number =>
        sorted.length === 0
          ? 0
          : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
      return {
        updates: times.length,
        meanGapMs: gaps.length > 0 ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0,
        p95GapMs: Math.round(pick(0.95)),
        maxGapMs: Math.round(sorted.length > 0 ? sorted[sorted.length - 1] : 0)
      }
    })

    const spawns = await countSpawns('b4-monitor', pid as number, SPAWN_SECONDS)
    const nvidiaGaps = summarizeGaps(gapsFor(spawns.events, 'nvidia-smi'))
    const powershellGaps = summarizeGaps(gapsFor(spawns.events, 'powershell'))
    writeScenario('b4-monitor', {
      cpu,
      spawns,
      hwmonPushes: ticks,
      nvidiaSmiCadence: nvidiaGaps,
      powershellCadence: powershellGaps
    })
    expect(cpu.samples).toBeGreaterThanOrEqual(CPU_SECONDS - 1)
  } finally {
    await finish(launched)
  }
})

test('B5: aba Atualizacoes em 2 ativacoes -- invocacoes de winget', async () => {
  test.setTimeout(300_000)
  const ctx = loadContext()
  const launched = await launchScenario()
  try {
    const window = launched.window
    const wingetLines = (): string[] => {
      if (!existsSync(ctx.stubsLog)) return []
      return readFileSync(ctx.stubsLog, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('winget '))
    }
    const countWinget = (): number => wingetLines().length

    const openPc = async (): Promise<void> => {
      await window.getByRole('button', { name: 'Meu PC' }).click()
      await expect(window.getByText('Manutenção e inicialização do seu PC')).toBeVisible({
        timeout: 15_000
      })
    }
    const openUpdatesTab = async (): Promise<void> => {
      await window.getByRole('tab', { name: 'Atualizações' }).click()
      await expect(window.getByRole('tab', { name: 'Atualizações' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      // O stub de winget responde na hora; 3 s cobrem o IPC + parse.
      await window.waitForTimeout(3000)
    }

    await openPc()
    const beforeFirst = countWinget()
    const linesBeforeFirst = wingetLines()
    await openUpdatesTab()
    const afterFirst = countWinget()
    const firstActivationLines = wingetLines().slice(linesBeforeFirst.length)

    // Sai de Meu PC (desmonta Inicializacao) e volta: a aba Atualizacoes e
    // montada de novo -- e o cenario do achado A5.
    await window.getByRole('button', { name: 'Ferramentas' }).click()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 15_000
    })
    await openPc()
    const beforeSecond = countWinget()
    const linesBeforeSecond = wingetLines()
    await openUpdatesTab()
    const afterSecond = countWinget()
    const secondActivationLines = wingetLines().slice(linesBeforeSecond.length)

    const result = {
      wingetTotalBeforeFirst: beforeFirst,
      wingetAfterFirstActivation: afterFirst,
      wingetFirstActivationDelta: afterFirst - beforeFirst,
      wingetBeforeSecondActivation: beforeSecond,
      wingetAfterSecondActivation: afterSecond,
      wingetSecondActivationDelta: afterSecond - beforeSecond,
      firstActivationLines,
      secondActivationLines,
      stubsLog: ctx.stubsLog
    }
    writeScenario('b5-updates', result)
    // Baseline: registra o numero real. O achado A5 (1 winget por ativacao)
    // e confirmado/refutado no relatorio; nao ha assert de "deveria ser 0".
    expect(afterFirst).toBeGreaterThanOrEqual(beforeFirst)
    expect(afterSecond).toBeGreaterThanOrEqual(beforeSecond)
  } finally {
    await finish(launched)
  }
})
