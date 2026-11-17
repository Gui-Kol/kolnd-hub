import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Regressão de estabilidade do benchmark de CPU (v2).
 *
 * O defeito original: a 1ª execução dava score ~178 e a 2ª, na mesma sessão,
 * ~64 (o JS dos workers caía para interpretado). O benchmark agora mede em
 * processos filhos com trabalho fixo + mediana.
 *
 * Este teste roda **3 execuções na mesma sessão** e exige:
 * - cada score dentro de ±15 % da mediana das três (estabilidade real);
 * - CPU do processo main ociosa depois de cada run (< 50 % de um núcleo);
 * - nenhum processo filho do runner remanescente (sem órfãos).
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

/**
 * CPU do processo main no último segundo, em % de **um** núcleo (100 = um
 * núcleo cheio). `process.cpuUsage()` vem em microssegundos.
 */
async function mainCpuPercent(app: ElectronApplication): Promise<number> {
  return app.evaluate(async () => {
    const before = process.cpuUsage()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const after = process.cpuUsage(before)
    return Math.round(((after.user + after.system) / 1_000_000) * 100 * 100) / 100
  })
}

/** Contagem de processos `electron.exe` rodando o runner do benchmark. */
function countRunnerProcesses(): number {
  const script = [
    '$processes = Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'"',
    "$runner = $processes | Where-Object { $_.CommandLine -like '*kolnd-bench-runner.js*' }",
    'Write-Output ($runner | Measure-Object).Count'
  ].join('; ')
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 20_000
      }
    )
    const count = Number.parseInt(output.trim(), 10)
    return Number.isFinite(count) ? count : -1
  } catch {
    return -1
  }
}

interface HistoryEntry {
  single: number
  multi: number
  tests: Array<{ id: string; label: string; single: number; multi: number }>
}

/**
 * Roda o benchmark pela interface e devolve os scores persistidos no histórico
 * (fonte de verdade: o número que o usuário vê vem do mesmo resultado).
 */
async function runBenchmarkOnce(window: Page): Promise<HistoryEntry> {
  const button = window.getByRole('button', { name: 'Executar benchmark' })
  await button.click()

  // Durante o run o botão vira "Cancelar"; o fim devolve o botão de executar.
  await expect(window.getByRole('button', { name: 'Cancelar' })).toBeVisible({ timeout: 20_000 })
  await expect(button).toBeVisible({ timeout: 120_000 })
  await expect(window.getByRole('heading', { name: 'Resultado' })).toBeVisible({
    timeout: 20_000
  })

  const history = await window.evaluate(async () => {
    const api = (
      window as unknown as {
        api: {
          benchmarkHistory: () => Promise<
            Array<{
              single: number
              multi: number
              tests: Array<{ id: string; label: string; single: number; multi: number }>
            }>
          >
        }
      }
    ).api
    return api.benchmarkHistory()
  })
  expect(history.length).toBeGreaterThan(0)
  return history[0]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Dentro de ±15 % da mediana. */
function withinTolerance(value: number, reference: number): boolean {
  return Math.abs(value - reference) / reference <= 0.15
}

test('benchmark de CPU mantém o score estável em 3 execuções na mesma sessão', async () => {
  test.setTimeout(420_000)
  const app = await launchApp()

  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })
    await openBenchmarkTab(window)

    // Nenhum filho do runner antes de começar (estado limpo).
    expect(countRunnerProcesses()).toBe(0)

    const runs: Array<{ scores: HistoryEntry; cpuPercent: number; orphans: number }> = []
    const userDataDir = loadContext().userDataDir
    for (let index = 0; index < 3; index++) {
      const scores = await runBenchmarkOnce(window)
      await window.waitForTimeout(1500)
      const cpuPercent = await mainCpuPercent(app)
      const orphans = countRunnerProcesses()
      runs.push({ scores, cpuPercent, orphans })
      // Evidência objetiva no log do Playwright.
      console.log(
        `[e2e][benchmark] run ${index + 1}: single ${scores.single} · multi ${scores.multi} · cpu main ${cpuPercent}% · runners vivos ${orphans}`
      )
      console.log(
        `[e2e][benchmark] cargas run ${index + 1}: ` +
          scores.tests.map((load) => `${load.id} ${load.single}/${load.multi}`).join(' · ')
      )
    }

    // Diagnóstico das repetições/retries do main (nunca decide o teste).
    try {
      const log = readFileSync(join(userDataDir, 'logs', 'kolnd-hub.log'), 'utf8')
      const lines = log.split(/\r?\n/).filter((line) => line.includes('[benchmark]'))
      console.log(`[e2e][benchmark] log do main:\n${lines.join('\n')}`)
    } catch {
      console.log('[e2e][benchmark] log do main indisponível')
    }

    const singles = runs.map((run) => run.scores.single)
    const multis = runs.map((run) => run.scores.multi)
    const singleMedian = median(singles)
    const multiMedian = median(multis)

    // Números reais no log (e na mensagem de falha) para diagnóstico imediato.
    console.log(
      `[e2e][benchmark] resumo: singles ${JSON.stringify(singles)} · multis ${JSON.stringify(multis)} · medianas ${singleMedian}/${multiMedian}`
    )

    // Estabilidade: nenhum score pode fugir 15 % da mediana das três.
    const singleOff = singles.filter((single) => !withinTolerance(single, singleMedian))
    const multiOff = multis.filter((multi) => !withinTolerance(multi, multiMedian))
    expect(
      singleOff,
      `single fora de ±15% da mediana ${singleMedian}: ${JSON.stringify(singles)}`
    ).toEqual([])
    expect(
      multiOff,
      `multi fora de ±15% da mediana ${multiMedian}: ${JSON.stringify(multis)}`
    ).toEqual([])

    // Sem CPU residual no main e sem filho órfão após cada execução.
    for (const run of runs) {
      expect(run.cpuPercent).toBeLessThan(50)
      expect(run.orphans).toBe(0)
    }

    // Escala nova: os scores precisam ser da ordem do CPU-Z medido (~582/4.700),
    // não dos MOps brutos antigos (~178 com média geométrica).
    expect(singleMedian).toBeGreaterThan(300)
    expect(singleMedian).toBeLessThan(1200)
    expect(multiMedian).toBeGreaterThan(singleMedian * 3)
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
