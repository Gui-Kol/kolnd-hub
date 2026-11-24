import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  appHandlers: new Map<string, () => void>(),
  getPath: vi.fn(() => 'C:\\hub.exe'),
  send: vi.fn(),
  windowDestroyed: false,
  sendThrows: false,
  currentFpsHelperPaths: vi.fn(() => ({
    outputPath: 'C:\\sink\\fps.ndjson',
    heartbeatPath: 'C:\\sink\\heartbeat',
    stopPath: 'C:\\sink\\stop'
  })),
  parseFpsHelperLine: vi.fn(),
  readFpsChunk: vi.fn(),
  requestFpsHelperStop: vi.fn(async () => undefined),
  requestFpsHelperStopSync: vi.fn(),
  startFpsHelper: vi.fn(),
  takeCompleteLines: vi.fn(),
  touchFpsHeartbeat: vi.fn(async () => undefined),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    once: (event: string, handler: () => void) => mocks.appHandlers.set(event, handler)
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./helper', () => ({
  currentFpsHelperPaths: mocks.currentFpsHelperPaths,
  parseFpsHelperLine: mocks.parseFpsHelperLine,
  readFpsChunk: mocks.readFpsChunk,
  requestFpsHelperStop: mocks.requestFpsHelperStop,
  requestFpsHelperStopSync: mocks.requestFpsHelperStopSync,
  startFpsHelper: mocks.startFpsHelper,
  takeCompleteLines: mocks.takeCompleteLines,
  touchFpsHeartbeat: mocks.touchFpsHeartbeat
}))
vi.mock('../logger', () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  buildFpsUpdate,
  getFpsStatus,
  registerFpsIpc,
  resetFpsMonitorForTests,
  startFpsMonitor,
  stopFpsMonitor
} from './index'
import type { IpcContext } from '../ipc/lifecycle'

const window = {
  isDestroyed: () => mocks.windowDestroyed,
  webContents: {
    send: (...args: unknown[]) => {
      if (mocks.sendThrows) throw new Error('janela fechando')
      mocks.send(...args)
    }
  }
}

const ctx = { getMainWindow: () => window } as unknown as IpcContext

interface QueuedChunk {
  text: string
  truncated?: boolean
}

let chunks: QueuedChunk[]

function sample(overrides: Record<string, unknown> = {}) {
  return {
    type: 'sample',
    foregroundPid: 10,
    foregroundName: 'game.exe',
    pids: [
      { pid: 10, name: 'game.exe', presents: 60, fps: 60.04, frametimeMs: 16.66 },
      { pid: 11, name: 'explorer.exe', presents: 5, fps: 30, frametimeMs: 33 }
    ],
    ...overrides
  }
}

function call(channel: string, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Handler ausente: ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  vi.resetAllMocks()
  resetFpsMonitorForTests()
  vi.useFakeTimers()
  chunks = []
  mocks.windowDestroyed = false
  mocks.sendThrows = false
  mocks.parseFpsHelperLine.mockImplementation((line: string) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  })
  mocks.takeCompleteLines.mockImplementation((buffer: string) => {
    const parts = buffer.split('\n')
    const rest = parts.pop() ?? ''
    return { lines: parts.filter(Boolean), rest }
  })
  mocks.readFpsChunk.mockImplementation(async (_path: string, offset: number) => {
    const next = chunks.shift() ?? { text: '' }
    return {
      offset: offset + next.text.length,
      text: next.text,
      truncated: next.truncated === true
    }
  })
  mocks.startFpsHelper.mockResolvedValue({ ok: true, paths: mocks.currentFpsHelperPaths() })
  mocks.currentFpsHelperPaths.mockReturnValue({
    outputPath: 'C:\\sink\\fps.ndjson',
    heartbeatPath: 'C:\\sink\\heartbeat',
    stopPath: 'C:\\sink\\stop'
  })
  mocks.getPath.mockReturnValue('C:\\hub.exe')
  registerFpsIpc(ctx)
})

function line(value: unknown): string {
  return JSON.stringify(value) + '\n'
}

describe('buildFpsUpdate', () => {
  it('converte o alvo em fps arredondado', () => {
    expect(buildFpsUpdate(sample() as never)).toMatchObject({
      state: 'running',
      active: true,
      pid: 10,
      processName: 'game.exe',
      fps: 60,
      frametimeMs: 16.7
    })
  })

  it('sem alvo/sem presents/fps insano devolvem motivo', () => {
    expect(buildFpsUpdate({ foregroundPid: null } as never)).toMatchObject({
      active: false,
      reason: 'no-target'
    })
    expect(
      buildFpsUpdate({ foregroundPid: 1, foregroundName: 'a.exe', pids: [] } as never)
    ).toMatchObject({ reason: 'no-presents' })
    expect(
      buildFpsUpdate(
        sample({ pids: [{ pid: 10, name: 'game.exe', presents: 1, fps: 200_000 }] }) as never
      )
    ).toMatchObject({ reason: 'no-presents' })
  })
})

describe('start/stop/status', () => {
  it('status inicial é off', () => {
    expect(getFpsStatus()).toEqual({ state: 'off', last: null, error: undefined })
  })

  it('start liga o poller e publica ready + amostra', async () => {
    chunks = [{ text: line({ type: 'ready', session: 's1', dxgk: true }) + line(sample()) }]

    await expect(startFpsMonitor()).resolves.toMatchObject({ ok: true })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)

    expect(getFpsStatus().state).toBe('running')
    expect(mocks.send).toHaveBeenCalledWith('fps:update', expect.objectContaining({ active: true }))
    expect(mocks.touchFpsHeartbeat).toHaveBeenCalled()
  })

  it('start recusado (erro e cancelamento)', async () => {
    mocks.startFpsHelper.mockResolvedValueOnce({ ok: false, error: 'UAC negado' })
    await expect(startFpsMonitor()).resolves.toMatchObject({ ok: false, error: 'UAC negado' })
    expect(getFpsStatus().state).toBe('error')

    resetFpsMonitorForTests()
    mocks.startFpsHelper.mockResolvedValueOnce({ ok: false, cancelled: true, error: 'cancelled' })
    await expect(startFpsMonitor()).resolves.toMatchObject({ ok: false, cancelled: true })
    expect(getFpsStatus().state).toBe('off')
  })

  it('start concorrente compartilha a mesma promise', async () => {
    let release!: (value: unknown) => void
    mocks.startFpsHelper.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const first = startFpsMonitor()
    const second = startFpsMonitor()
    release({ ok: true, paths: mocks.currentFpsHelperPaths() })
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(second).resolves.toMatchObject({ ok: true })
    expect(mocks.startFpsHelper).toHaveBeenCalledTimes(1)
  })

  it('start já rodando devolve ok sem reabrir o helper', async () => {
    await startFpsMonitor()
    await expect(startFpsMonitor()).resolves.toMatchObject({ ok: true })
    expect(mocks.startFpsHelper).toHaveBeenCalledTimes(1)
  })

  it('stop desliga, pede parada e reseta o estado', async () => {
    await startFpsMonitor()
    expect(stopFpsMonitor()).toEqual({ ok: true })
    expect(mocks.requestFpsHelperStop).toHaveBeenCalledWith('stop')
    expect(getFpsStatus().state).toBe('off')

    mocks.requestFpsHelperStop.mockClear()
    stopFpsMonitor()
    expect(mocks.requestFpsHelperStop).not.toHaveBeenCalled()
  })

  it('will-quit encerra de forma síncrona', () => {
    mocks.appHandlers.get('will-quit')?.()
    expect(mocks.requestFpsHelperStopSync).toHaveBeenCalledWith('quit')
    expect(getFpsStatus().state).toBe('off')
  })
})

describe('linhas do helper', () => {
  it('alvo ignorado pelo próprio Hub (foreground) fica sem alvo', async () => {
    chunks = [
      {
        text:
          line({ type: 'ready', session: 's', dxgk: true }) +
          line(sample({ foregroundPid: 99, foregroundName: 'electron.exe', pids: [] }))
      }
    ]
    await startFpsMonitor()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.send).toHaveBeenLastCalledWith(
      'fps:update',
      expect.objectContaining({ active: false, reason: 'no-target' })
    )
  })

  it('stop inesperado vira erro; stop pedido vira off', async () => {
    await startFpsMonitor()
    chunks = [{ text: line({ type: 'stopped' }) }]
    await vi.advanceTimersByTimeAsync(500)
    expect(getFpsStatus().state).toBe('error')

    resetFpsMonitorForTests()
    await startFpsMonitor()
    stopFpsMonitor()
    resetFpsMonitorForTests()
    await startFpsMonitor()
    chunks = [{ text: line({ type: 'stopped' }) }]
    // Marca stopRequested sem zerar o estado: simula o helper saindo após o pedido.
    stopFpsMonitor()
    chunks = [{ text: line({ type: 'stopped' }) }]
    await vi.advanceTimersByTimeAsync(500)
    expect(getFpsStatus().state).toBe('off')
  })

  it.each([
    [{ stage: 'start-trace', code: 5, message: 'x' }, 'permissão de administrador'],
    [{ stage: 'start-trace', code: 1, message: 'x' }, 'sessão de eventos'],
    [{ stage: 'enable-dxgi', message: 'x' }, 'eventos gráficos'],
    [{ stage: 'open-trace', message: 'x' }, 'tempo real'],
    [{ stage: 'process-trace', message: 'x' }, 'interrompida'],
    [{ stage: 'outro', message: 'x' }, 'medição de FPS falhou']
  ])('falha do helper (%j) vira mensagem amigável', async (_message, expected) => {
    await startFpsMonitor()
    chunks = [{ text: line({ type: 'error', ...(_message as object) }) }]
    await vi.advanceTimersByTimeAsync(500)
    expect(getFpsStatus().error).toContain(expected)
    expect(getFpsStatus().state).toBe('error')
  })

  it('linha inválida é ignorada', async () => {
    await startFpsMonitor()
    chunks = [{ text: 'lixo\n' }]
    await vi.advanceTimersByTimeAsync(500)
    expect(getFpsStatus().state).toBe('starting')
  })
})

describe('timeouts e leitura', () => {
  it('ready não chega a tempo → erro com pedido de parada', async () => {
    await startFpsMonitor()
    await vi.advanceTimersByTimeAsync(21_000)
    expect(getFpsStatus().error).toContain('a tempo')
    expect(mocks.requestFpsHelperStop).toHaveBeenCalledWith('watchdog')
  })

  it('sem mensagens após running → watchdog', async () => {
    chunks = [{ text: line({ type: 'ready', session: 's', dxgk: true }) }]
    await startFpsMonitor()
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(7_000)
    expect(getFpsStatus().error).toContain('parou de responder')
  })

  it('chunk truncado limpa o buffer e erro de leitura é logado', async () => {
    await startFpsMonitor()
    chunks = [{ text: 'linha sem fim', truncated: true }]
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.logWarn).not.toHaveBeenCalled()

    mocks.readFpsChunk.mockRejectedValueOnce(new Error('disco'))
    await vi.advanceTimersByTimeAsync(500)
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'fps',
      expect.stringContaining('leitura do helper falhou')
    )
  })

  it('janela destruída ou send lançando não quebra o poller', async () => {
    mocks.windowDestroyed = true
    await startFpsMonitor()
    await vi.advanceTimersByTimeAsync(0)

    resetFpsMonitorForTests()
    mocks.windowDestroyed = false
    mocks.sendThrows = true
    await startFpsMonitor()
    await vi.advanceTimersByTimeAsync(0)
    expect(getFpsStatus().state).toBe('starting')
  })

  it('falha ao obter o caminho do executável do app é tolerada', async () => {
    mocks.getPath.mockImplementation(() => {
      throw new Error('sem app')
    })
    chunks = [{ text: line({ type: 'ready', session: 's', dxgk: true }) + line(sample()) }]
    await startFpsMonitor()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(getFpsStatus().state).toBe('running')
  })
})

describe('IPC', () => {
  it('registra status/start/stop e recusa argumentos', async () => {
    expect(call('fps:status')).toMatchObject({ state: 'off' })
    expect(() => call('fps:status', 1)).toThrow('Requisição inválida.')

    await expect(call('fps:start')).resolves.toMatchObject({ ok: true })
    await expect(call('fps:start', {})).rejects.toThrow('Requisição inválida.')
    expect(call('fps:stop')).toEqual({ ok: true })
    expect(() => call('fps:stop', true)).toThrow('Requisição inválida.')
  })
})
