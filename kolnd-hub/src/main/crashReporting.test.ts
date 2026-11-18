import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => join(tmpdir(), 'kolnd-hub-crash-test', 'Crashpad')),
    exit: vi.fn(),
    on: vi.fn()
  },
  crashReporter: { start: vi.fn() }
}))

type ProcessHandler = (...args: unknown[]) => void

let dir: string
let logPath: string
let processOnSpy: ProcessOnSpy

/** Forma mínima do spy de process.on usada pelos testes (evita lutar com os overloads). */
interface ProcessOnSpy {
  mock: { calls: Array<[unknown, unknown]> }
  mockRestore(): void
}

/**
 * Reimporta logger + electron + crashReporting no registro atual
 * (vi.resetModules no beforeEach). O caminho de log de teste precisa ser
 * definido na INSTÂNCIA fresca do logger — por isso setLogPathForTests é
 * chamado aqui, não em um import estático.
 */
async function load(): Promise<{
  app: {
    getPath: ReturnType<typeof vi.fn>
    exit: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }
  crashReporter: { start: ReturnType<typeof vi.fn> }
}> {
  const loggerMod = await import('./logger')
  loggerMod.setLogPathForTests(logPath)
  const electron = await import('electron')
  await import('./crashReporting')
  return electron as never
}

function capturedHandler(event: string): ProcessHandler {
  const call = processOnSpy.mock.calls.find((c) => c[0] === event)
  expect(call, `handler '${event}' deveria ter sido registrado`).toBeDefined()
  return call![1] as ProcessHandler
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kolnd-hub-crash-'))
  logPath = join(dir, 'kolnd-hub.log')
  // Silencia o espelho de console do logger.
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // Captura process.on sem registrar de verdade no processo de teste.
  processOnSpy = vi
    .spyOn(process, 'on')
    .mockImplementation((() => process) as unknown as typeof process.on) as unknown as ProcessOnSpy
  vi.resetModules()
})

afterEach(async () => {
  // Desfaz o caminho de teste na instância fresca do logger (mesmo registro do último import).
  const loggerMod = await import('./logger')
  loggerMod.setLogPathForTests(null)
  processOnSpy.mockRestore()
  vi.clearAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('crashReporting', () => {
  it('inicia o crashReporter local com uploadToServer: false (nada sai da máquina)', async () => {
    const { crashReporter } = await load()
    expect(crashReporter.start).toHaveBeenCalledTimes(1)
    expect(crashReporter.start).toHaveBeenCalledWith({
      uploadToServer: false,
      submitURL: '',
      compress: true
    })
  })

  it('loga o caminho efetivo dos minidumps (app.getPath("crashDumps"))', async () => {
    await load()
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('uploadToServer: false')
    expect(content).toContain('Crashpad')
  })

  it('uncaughtException: loga [CRASH] com stack completo e encerra com app.exit(1)', async () => {
    const { app } = await load()
    const handler = capturedHandler('uncaughtException')
    handler(new Error('boom de teste'))
    expect(app.exit).toHaveBeenCalledWith(1)
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('[CRASH]')
    expect(content).toContain('boom de teste')
    expect(content).toMatch(/\n {4}Error: boom de teste/)
  })

  it('uncaughtException: o cleanup de processos filhos roda ANTES de app.exit(1)', async () => {
    const { app } = await load()
    const crashReporting = await import('./crashReporting')
    const order: string[] = []
    crashReporting.registerChildProcessCleanup(() => order.push('cleanup'))
    app.exit.mockImplementation(() => order.push('exit'))

    capturedHandler('uncaughtException')(new Error('boom com cleanup'))

    expect(order).toEqual(['cleanup', 'exit'])
  })

  it('uncaughtException: cleanup que lança não impede o app.exit(1)', async () => {
    const { app } = await load()
    const crashReporting = await import('./crashReporting')
    crashReporting.registerChildProcessCleanup(() => {
      throw new Error('falha simulada na limpeza')
    })

    expect(() =>
      capturedHandler('uncaughtException')(new Error('boom com cleanup quebrado'))
    ).not.toThrow()

    expect(app.exit).toHaveBeenCalledWith(1)
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('Falha ao matar processos filhos')
    expect(content).toContain('falha simulada na limpeza')
  })

  it('unhandledRejection: loga [unhandledRejection] com stack e NÃO encerra o processo', async () => {
    const { app } = await load()
    const handler = capturedHandler('unhandledRejection')
    handler(new Error('rejeição de teste'))
    expect(app.exit).not.toHaveBeenCalled()
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('[unhandledRejection]')
    expect(content).toContain('rejeição de teste')
  })

  it('registra os handlers render-process-gone e child-process-gone no app', async () => {
    const { app } = await load()
    const events = app.on.mock.calls.map((c) => c[0])
    expect(events).toContain('render-process-gone')
    expect(events).toContain('child-process-gone')
  })

  it('render-process-gone/child-process-gone logam details.reason', async () => {
    const { app } = await load()
    const renderGone = app.on.mock.calls.find(
      (c) => c[0] === 'render-process-gone'
    )![1] as ProcessHandler
    const childGone = app.on.mock.calls.find(
      (c) => c[0] === 'child-process-gone'
    )![1] as ProcessHandler
    renderGone({}, {}, { reason: 'crashed', exitCode: 139 })
    childGone({}, { type: 'GPU', reason: 'oom', exitCode: 1, serviceName: 'GPU Service' })
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('render-process-gone: reason=crashed exitCode=139')
    expect(content).toContain(
      'child-process-gone: type=GPU reason=oom exitCode=1 service=GPU Service'
    )
  })

  it('falha no crashReporter.start não lança — loga e o app segue', async () => {
    // Força a falha já na fábrica do mock, antes do import do módulo.
    vi.doMock('electron', () => ({
      app: {
        getPath: vi.fn(() => join(tmpdir(), 'kolnd-hub-crash-test', 'Crashpad')),
        exit: vi.fn(),
        on: vi.fn()
      },
      crashReporter: {
        start: vi.fn(() => {
          throw new Error('falha simulada no start')
        })
      }
    }))
    vi.resetModules()
    const loggerMod = await import('./logger')
    loggerMod.setLogPathForTests(logPath)
    await expect(import('./crashReporting')).resolves.toBeDefined()
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('Falha ao iniciar o crashReporter local')
    expect(content).toContain('falha simulada no start')
  })
})
