import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  appHandlers: new Map<string, () => void>(),
  send: vi.fn(),
  windowDestroyed: false,
  sendThrows: false,
  stat: vi.fn(),
  readFile: vi.fn(),
  ensureStagedHelper: vi.fn(),
  sha256File: vi.fn(async () => 'abc123'),
  resolveFpsProtectedPaths: vi.fn((): Record<string, string> => ({
    root: 'C:\\run',
    binDir: 'C:\\run\\bin',
    runDir: 'C:\\run\\run',
    exePath: 'C:\\run\\bin\\fps-helper.exe'
  })),
  buildEnsureProtectedHelperScript: vi.fn(() => 'script'),
  encodePowerShell: vi.fn(() => 'encoded'),
  runPowerShellCommand: vi.fn(),
  runProcess: vi.fn(),
  isUacCancelled: vi.fn((text: string) => /1223|cancelad/i.test(text)),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\hub.exe',
    once: (event: string, handler: () => void) => mocks.appHandlers.set(event, handler)
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('fs', () => ({
  promises: { stat: mocks.stat, readFile: mocks.readFile }
}))
vi.mock('./helper', () => ({
  buildEnsureProtectedHelperScript: mocks.buildEnsureProtectedHelperScript,
  encodePowerShell: mocks.encodePowerShell,
  ensureStagedHelper: mocks.ensureStagedHelper,
  resolveFpsProtectedPaths: mocks.resolveFpsProtectedPaths,
  sha256File: mocks.sha256File
}))
vi.mock('../hwmon/uac', () => ({ isUacCancelled: mocks.isUacCancelled }))
vi.mock('../hwmon/powershell', () => ({
  runPowerShellCommand: mocks.runPowerShellCommand,
  runProcess: mocks.runProcess
}))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  getFpsAutoStatus,
  getFpsAutoUpdate,
  installFpsAuto,
  isFpsAutoInstalled,
  parseFpsAutoLatest,
  readFpsAutoLatestFile,
  registerFpsAutoIpc,
  removeFpsAuto,
  resetFpsAutoForTests
} from './agent'
import type { IpcContext } from '../ipc/lifecycle'

const SINK = join('C:\\ProgramData', 'Kolnd Hub', 'fps')
const LATEST = join(SINK, 'latest.json')

const window = {
  isDestroyed: () => mocks.windowDestroyed,
  webContents: {
    send: (...args: unknown[]) => {
      if (mocks.sendThrows) throw new Error('fechando')
      mocks.send(...args)
    }
  }
}
const ctx = { getMainWindow: () => window } as unknown as IpcContext

function latest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    pid: 10,
    name: 'game.exe',
    fps: 59.96,
    frametimeMs: 16.67,
    ...overrides
  })
}

function result(overrides: Record<string, unknown> = {}) {
  return { stdout: '', stderr: '', code: 0, timedOut: false, ...overrides }
}

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

let platformValue: NodeJS.Platform = 'win32'
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

function setPlatform(value: NodeJS.Platform): void {
  platformValue = value
  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: true,
    get: () => platformValue
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  resetFpsAutoForTests()
  vi.useFakeTimers()
  setPlatform('win32')
  mocks.windowDestroyed = false
  mocks.sendThrows = false
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 100 })
  mocks.readFile.mockResolvedValue(latest())
  mocks.ensureStagedHelper.mockResolvedValue({ stagingExePath: 'C:\\stage\\agent.exe' })
  mocks.resolveFpsProtectedPaths.mockReturnValue({
    root: 'C:\\ProgramData\\Kolnd Hub\\fps',
    binDir: 'C:\\ProgramData\\Kolnd Hub\\fps\\bin',
    runDir: 'C:\\ProgramData\\Kolnd Hub\\fps\\run',
    exePath: 'C:\\ProgramData\\Kolnd Hub\\fps\\bin\\fps-helper.exe'
  })
  mocks.sha256File.mockResolvedValue('abc123')
  mocks.isUacCancelled.mockImplementation((text: string) => /1223|cancelad/i.test(text))
  mocks.runPowerShellCommand.mockResolvedValue(result())
  mocks.runProcess.mockResolvedValue(result({ stdout: 'TaskName: KolndHubFpsAgent' }))
  delete process.env.KOLDND_HUB_FPS_DIR
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
})

describe('parseFpsAutoLatest', () => {
  it('rejeita formato/idade inválidos', () => {
    expect(parseFpsAutoLatest(null, Date.now())).toMatchObject({ fresh: false })
    expect(parseFpsAutoLatest({}, Date.now())).toMatchObject({ fresh: false })
    expect(parseFpsAutoLatest({ timestamp: 'x' }, Date.now())).toMatchObject({ fresh: false })
    expect(
      parseFpsAutoLatest({ timestamp: new Date(Date.now() - 10_000).toISOString() }, Date.now())
    ).toMatchObject({ fresh: false })
    expect(
      parseFpsAutoLatest({ timestamp: new Date(Date.now() + 10_000).toISOString() }, Date.now())
    ).toMatchObject({ fresh: false })
  })

  it('arquivo fresco sem alvo válido mantém fresh=true e sample=null', () => {
    const now = Date.now()
    const ts = new Date(now).toISOString()
    expect(parseFpsAutoLatest({ timestamp: ts, pid: 0 }, now)).toMatchObject({
      fresh: true,
      sample: null
    })
    expect(parseFpsAutoLatest({ timestamp: ts, pid: 1, name: 'explorer.exe' }, now)).toMatchObject({
      fresh: true,
      sample: null
    })
    expect(
      parseFpsAutoLatest({ timestamp: ts, pid: 1, name: 'x.exe', fps: -1, frametimeMs: 1 }, now)
    ).toMatchObject({ fresh: true, sample: null })
  })

  it('amostra válida é aceita', () => {
    const now = Date.now()
    const parsed = parseFpsAutoLatest(
      {
        timestamp: new Date(now).toISOString(),
        pid: 10,
        name: 'jogo.exe',
        fps: 60,
        frametimeMs: 16
      },
      now
    )
    expect(parsed.sample).toMatchObject({ pid: 10, name: 'jogo.exe', fps: 60 })
  })
})

describe('readFpsAutoLatestFile', () => {
  it('arquivo inválido/ilegível é stale', async () => {
    mocks.stat.mockResolvedValueOnce({ isFile: () => false, size: 1 })
    await expect(readFpsAutoLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })
    mocks.stat.mockResolvedValueOnce({ isFile: () => true, size: 0 })
    await expect(readFpsAutoLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })
    mocks.stat.mockResolvedValueOnce({ isFile: () => true, size: 100 * 1024 })
    await expect(readFpsAutoLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })
    mocks.stat.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(readFpsAutoLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })
    mocks.readFile.mockResolvedValue('não é json')
    await expect(readFpsAutoLatestFile(LATEST, Date.now())).resolves.toMatchObject({
      fresh: false
    })
  })

  it('lê e valida o latest.json', async () => {
    const parsed = await readFpsAutoLatestFile(LATEST, Date.now())
    expect(parsed.sample?.name).toBe('game.exe')
  })
})

describe('isFpsAutoInstalled', () => {
  it('não-Windows é false; Windows consulta schtasks', async () => {
    setPlatform('linux')
    await expect(isFpsAutoInstalled()).resolves.toBe(false)

    setPlatform('win32')
    await isFpsAutoInstalled()
    expect(mocks.runProcess).toHaveBeenCalledWith(
      join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe'),
      ['/Query', '/TN', 'KolndHubFpsAgent', '/FO', 'LIST'],
      null,
      8000
    )
  })
})

describe('polling e status', () => {
  it('registrar o IPC inicia o polling e publica o primeiro status', async () => {
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.send).toHaveBeenCalledWith(
      'fps:auto-update',
      expect.objectContaining({ state: 'running' })
    )
    expect(getFpsAutoStatus()).toMatchObject({ state: 'running', installed: true })
    expect(getFpsAutoUpdate()).toMatchObject({ active: true, fps: 60, frametimeMs: 16.7 })
  })

  it('sem arquivo fresco o status fica stale/off', async () => {
    mocks.stat.mockRejectedValue(new Error('ENOENT'))
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(getFpsAutoStatus().state).toBe('stale')
    expect(getFpsAutoUpdate()).toBeNull()
  })

  it('amostra vencida devolve update nulo', async () => {
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)
    // Para o polling e avança além do TTL: a amostra em memória fica velha.
    mocks.appHandlers.get('will-quit')?.()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(getFpsAutoUpdate()).toBeNull()
  })

  it('janela destruída, send lançando e erro de leitura são tolerados', async () => {
    mocks.windowDestroyed = true
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)

    resetFpsAutoForTests()
    mocks.windowDestroyed = false
    mocks.sendThrows = true
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)

    resetFpsAutoForTests()
    mocks.readFile.mockRejectedValue(new Error('disco'))
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.logWarn).not.toHaveBeenCalled()
  })

  it('will-quit para o polling', async () => {
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)
    mocks.send.mockClear()
    mocks.appHandlers.get('will-quit')?.()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})

describe('installFpsAuto', () => {
  it('recusa fora do Windows', async () => {
    setPlatform('linux')
    await expect(installFpsAuto()).resolves.toMatchObject({ ok: false })
  })

  it('recusa operação simultânea', async () => {
    let release!: (value: unknown) => void
    mocks.ensureStagedHelper.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const first = installFpsAuto()
    await expect(installFpsAuto()).resolves.toMatchObject({
      ok: false,
      error: 'Já existe uma operação em andamento.'
    })
    release({ stagingExePath: 'C:\\agent.exe' })
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('UAC cancelado, timeout e código de erro', async () => {
    mocks.runPowerShellCommand.mockResolvedValueOnce(result({ stdout: 'cancelado', code: 1 }))
    await expect(installFpsAuto()).resolves.toMatchObject({ ok: false, cancelled: true })

    mocks.runPowerShellCommand.mockResolvedValueOnce(result({ timedOut: true }))
    await expect(installFpsAuto()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('demorou demais')
    })

    mocks.runPowerShellCommand.mockResolvedValueOnce(result({ code: 1, stderr: 'erro' }))
    await expect(installFpsAuto()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Não foi possível agendar')
    })
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('sucesso marca instalado e atualiza o status', async () => {
    await expect(installFpsAuto()).resolves.toMatchObject({ ok: true })
    expect(mocks.runPowerShellCommand).toHaveBeenCalled()
    expect(mocks.logInfo).toHaveBeenCalled()
    expect(getFpsAutoStatus().installed).toBe(true)
  })

  it('exceção inesperada vira erro', async () => {
    mocks.ensureStagedHelper.mockRejectedValue(new Error('sem stage'))
    await expect(installFpsAuto()).resolves.toMatchObject({
      ok: false,
      error: 'sem stage'
    })
  })
})

describe('removeFpsAuto', () => {
  it('recusa fora do Windows e operação simultânea', async () => {
    setPlatform('linux')
    await expect(removeFpsAuto()).resolves.toMatchObject({ ok: false })

    setPlatform('win32')
    let release!: (value: unknown) => void
    mocks.runPowerShellCommand.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const first = removeFpsAuto()
    await expect(removeFpsAuto()).resolves.toMatchObject({
      ok: false,
      error: 'Já existe uma operação em andamento.'
    })
    release(result())
    await expect(first).resolves.toMatchObject({ ok: true })
  })

  it('cancelamento, timeout e código de erro', async () => {
    mocks.runPowerShellCommand.mockResolvedValueOnce(result({ stdout: '1223', code: 1 }))
    await expect(removeFpsAuto()).resolves.toMatchObject({ ok: false, cancelled: true })

    mocks.runPowerShellCommand.mockResolvedValueOnce(result({ timedOut: true }))
    await expect(removeFpsAuto()).resolves.toMatchObject({ ok: false })

    mocks.runPowerShellCommand.mockResolvedValueOnce(result({ code: 2 }))
    await expect(removeFpsAuto()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('Não foi possível remover')
    })
  })

  it('sucesso limpa a amostra', async () => {
    registerFpsAutoIpc(ctx)
    await vi.advanceTimersByTimeAsync(0)
    await expect(removeFpsAuto()).resolves.toMatchObject({ ok: true })
    expect(getFpsAutoUpdate()).toBeNull()
  })

  it('exceção vira erro amigável', async () => {
    mocks.runPowerShellCommand.mockRejectedValue(new Error('boom'))
    await expect(removeFpsAuto()).resolves.toMatchObject({ ok: false, error: 'boom' })
  })
})

describe('IPC fps:auto-*', () => {
  it('status, install e remove encaminham e validam argumentos', async () => {
    registerFpsAutoIpc(ctx)
    expect(call('fps:auto-status')).toMatchObject({ state: expect.any(String) })
    expect(() => call('fps:auto-status', 1)).toThrow('Requisição inválida.')

    await expect(call('fps:auto-install')).resolves.toMatchObject({ ok: true })
    await expect(call('fps:auto-install', 1)).rejects.toThrow('Requisição inválida.')
    await expect(call('fps:auto-remove')).resolves.toMatchObject({ ok: true })
    await expect(call('fps:auto-remove', 1)).rejects.toThrow('Requisição inválida.')
  })
})
