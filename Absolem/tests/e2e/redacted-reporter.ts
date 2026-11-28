import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep
} from '@playwright/test/reporter'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, relative, resolve } from 'path'

/**
 * Relatório local do E2E fake.
 *
 * Grava somente metadados: arquivo do repositório, título do teste, fase
 * (`test.step`), duração, estado e uma categoria de erro derivada de padrões.
 * Mensagem crua, stack, payload, prompt, resposta, áudio, imagem, URL, caminho
 * pessoal, chave e token nunca entram no arquivo.
 */

interface StepReport {
  phase: string
  status: 'passed' | 'failed'
  durationMs: number
}

interface TestReport {
  file: string
  title: string
  status: TestResult['status']
  durationMs: number
  retry: number
  steps: StepReport[]
  errorCategory?: string
  failedPhase?: string
}

interface Report {
  schema: 1
  generatedBy: string
  contentPolicy: string
  startedAt: string
  durationMs: number
  status: FullResult['status']
  totals: {
    total: number
    passed: number
    failed: number
    skipped: number
    interrupted: number
  }
  tests: TestReport[]
}

interface ReporterOptions {
  outputFile?: string
}

const DEFAULT_OUTPUT = 'test-results/e2e-report.json'

function safeFile(file: string): string {
  const rel = relative(process.cwd(), file)
  if (!rel || rel.startsWith('..')) return file.split(/[\\/]/).pop() ?? 'test'
  return rel.replace(/\\/g, '/')
}

function category(result: TestResult): string | undefined {
  if (result.status !== 'failed' && result.status !== 'timedOut') return undefined
  if (result.status === 'timedOut') return 'timeout'
  const message = result.errors.map((error) => error.message ?? '').join(' ')
  if (/timeout|timed out/i.test(message)) return 'timeout'
  if (/ipc|channel|sender/i.test(message)) return 'ipc'
  if (/electron|browserwindow|launch|process/i.test(message)) return 'electron'
  if (/expect|tohave|toequal|tobe|assert/i.test(message)) return 'assertion'
  return 'unknown'
}

function stepReports(step: TestStep): StepReport[] {
  if (step.category !== 'test.step') return []
  const own: StepReport = {
    phase: step.title,
    status: step.error ? 'failed' : 'passed',
    durationMs: Math.round(step.duration)
  }
  return [own, ...step.steps.flatMap(stepReports)]
}

function failedPhase(steps: TestStep[]): string | undefined {
  for (const step of steps) {
    if (step.category === 'test.step' && step.error) return step.title
    const nested = failedPhase(step.steps)
    if (nested) return nested
  }
  return undefined
}

export default class RedactedReporter implements Reporter {
  private readonly outputFile: string
  private startedAt = Date.now()
  private readonly tests: TestReport[] = []

  constructor(options: ReporterOptions = {}) {
    this.outputFile = resolve(process.cwd(), options.outputFile ?? DEFAULT_OUTPUT)
  }

  onBegin(_config: FullConfig, _suite: unknown): void {
    this.startedAt = Date.now()
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const steps = result.steps.flatMap(stepReports)
    const failed = failedPhase(result.steps)
    this.tests.push({
      file: safeFile(test.location.file),
      title: test.title,
      status: result.status,
      durationMs: Math.round(result.duration),
      retry: result.retry,
      steps,
      ...(category(result) ? { errorCategory: category(result) } : {}),
      ...(failed ? { failedPhase: failed } : {})
    })
  }

  onEnd(result: FullResult): void {
    const totals = { total: this.tests.length, passed: 0, failed: 0, skipped: 0, interrupted: 0 }
    for (const test of this.tests) {
      if (test.status === 'passed') totals.passed += 1
      else if (test.status === 'skipped') totals.skipped += 1
      else if (test.status === 'interrupted') totals.interrupted += 1
      else totals.failed += 1
    }

    const report: Report = {
      schema: 1,
      generatedBy: 'tests/e2e/redacted-reporter.ts',
      contentPolicy:
        'somente arquivo, título, fase, duração, estado e categoria de erro; sem payload, prompt, resposta, áudio, imagem, URL, caminho pessoal, chave ou token',
      startedAt: new Date(this.startedAt).toISOString(),
      durationMs: Math.round(result.duration),
      status: result.status,
      totals,
      tests: this.tests
    }

    mkdirSync(dirname(this.outputFile), { recursive: true })
    writeFileSync(this.outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
}
