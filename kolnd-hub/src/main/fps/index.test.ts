import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FpsHelperSample, FpsHelperPaths } from './helper'

const mocks = vi.hoisted(() => ({
  startFpsHelper: vi.fn(),
  requestFpsHelperStop: vi.fn(),
  requestFpsHelperStopSync: vi.fn(),
  touchFpsHeartbeat: vi.fn(),
  readFpsChunk: vi.fn(),
  parseFpsHelperLine: vi.fn(),
  takeCompleteLines: vi.fn(),
  currentFpsHelperPaths: vi.fn(),
  handle: vi.fn(),
  once: vi.fn(),
  getPath: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  app: { once: mocks.once, getPath: mocks.getPath }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./helper', () => ({
  startFpsHelper: mocks.startFpsHelper,
  requestFpsHelperStop: mocks.requestFpsHelperStop,
  requestFpsHelperStopSync: mocks.requestFpsHelperStopSync,
  touchFpsHeartbeat: mocks.touchFpsHeartbeat,
  readFpsChunk: mocks.readFpsChunk,
  parseFpsHelperLine: mocks.parseFpsHelperLine,
  takeCompleteLines: mocks.takeCompleteLines,
  currentFpsHelperPaths: mocks.currentFpsHelperPaths
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

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

const FAKE_PATHS: FpsHelperPaths = {
  dir: 'C:\\userData\\fps',
  sourcePath: 'C:\\userData\\fps\\KolndFpsEtw.cs',
  stagingExePath: 'C:\\userData\\fps\\KolndFpsEtw.exe',
  runDir: 'C:\\userData\\fps\\run',
  outputPath: 'C:\\ProgramData\\Kolnd Hub\\fps\\run\\fps.ndjson',
  stopPath: 'C:\\userData\\fps\\run\\fps.stop',
  heartbeatPath: 'C:\\userData\\fps\\run\\fps.heartbeat'
}

function createContext(): IpcContext {
  return {
    getMainWindow: () => null,
    processManager: {} as IpcContext['processManager']
  }
}

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`handler ${channel} não registrado`)
  return handler
}

function sample(overrides: Partial<FpsHelperSample> = {}): FpsHelperSample {
  return {
    type: 'sample',
    ts: '2026-11-17T12:00:00.000Z',
    windowMs: 1000,
    foregroundPid: 4321,
    foregroundName: 'game',
    pids: [
      {
        pid: 4321,
        name: 'game',
        presents: 143,
        source: 'dxgi',
        fps: 143.58,
        frametimeMs: 6.965
      }
    ],
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  resetFpsMonitorForTests()

  mocks.handle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  mocks.getPath.mockReturnValue('C:\\Apps\\Kolnd Hub.exe')
  mocks.currentFpsHelperPaths.mockReturnValue(FAKE_PATHS)
  mocks.startFpsHelper.mockResolvedValue({ ok: true, paths: FAKE_PATHS })
  mocks.requestFpsHelperStop.mockResolvedValue(undefined)
  mocks.touchFpsHeartbeat.mockResolvedValue(undefined)
  mocks.readFpsChunk.mockResolvedValue({ text: '', offset: 0, truncated: false })
  mocks.parseFpsHelperLine.mockReturnValue(null)
  mocks.takeCompleteLines.mockReturnValue({ lines: [], rest: '' })
})

describe('buildFpsUpdate', () => {
  it('publica o alvo em primeiro plano com fps/frametime arredondados', () => {
    const update = buildFpsUpdate(sample())
    expect(update).toMatchObject({
      state: 'running',
      active: true,
      pid: 4321,
      processName: 'game.exe',
      fps: 143.6,
      frametimeMs: 7
    })
    expect(Number.isNaN(Date.parse(update.capturedAt))).toBe(false)
  })

  it('sem alvo devolve motivo, sem números', () => {
    const update = buildFpsUpdate(sample({ foregroundPid: null, foregroundName: null }))
    expect(update).toMatchObject({
      state: 'running',
      active: false,
      pid: null,
      fps: null,
      reason: 'no-target'
    })
  })

  it('valor absurdo não vira FPS na tela', () => {
    const update = buildFpsUpdate(
      sample({
        pids: [
          {
            pid: 4321,
            name: 'game',
            presents: 100,
            source: 'dxgi',
            fps: 500_000,
            frametimeMs: 0.002
          }
        ]
      })
    )
    expect(update.active).toBe(false)
    expect(update.reason).toBe('no-presents')
  })
})

describe('registerFpsIpc', () => {
  it('registra os canais e a parada no will-quit', () => {
    registerFpsIpc(createContext())
    expect([...handlers.keys()].sort()).toEqual(['fps:start', 'fps:status', 'fps:stop'])
    expect(mocks.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
  })

  it('fps:status começa desligado e rejeita argumentos', () => {
    registerFpsIpc(createContext())
    expect(getHandler('fps:status')({})).toMatchObject({ state: 'off', last: null })
    expect(() => getHandler('fps:status')({}, 'x')).toThrow('Requisição inválida.')
  })

  it('fps:start delega ao helper uma única vez e entra em starting', async () => {
    registerFpsIpc(createContext())
    const result = (await getHandler('fps:start')({})) as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(mocks.startFpsHelper).toHaveBeenCalledTimes(1)
    expect(getFpsStatus().state).toBe('starting')

    // Segunda chamada enquanto a sessão abre não dispara outro UAC.
    await getHandler('fps:start')({})
    expect(mocks.startFpsHelper).toHaveBeenCalledTimes(1)

    stopFpsMonitor()
  })

  it('fps:start com UAC recusado volta para off com a mensagem', async () => {
    mocks.startFpsHelper.mockResolvedValue({
      ok: false,
      cancelled: true,
      error: 'A permissão de administrador não foi concedida.'
    })
    registerFpsIpc(createContext())

    const result = (await getHandler('fps:start')({})) as {
      ok: boolean
      cancelled: boolean
      error: string
    }
    expect(result).toMatchObject({ ok: false, cancelled: true })
    expect(result.error).toContain('permissão')
    expect(getFpsStatus()).toMatchObject({ state: 'off' })
    expect(getFpsStatus().error).toBeUndefined()
  })

  it('fps:stop é idempotente e sinaliza o helper quando havia sessão', async () => {
    registerFpsIpc(createContext())
    await getHandler('fps:start')({})
    expect(getHandler('fps:stop')({})).toEqual({ ok: true })
    expect(mocks.requestFpsHelperStop).toHaveBeenCalledTimes(1)
    expect(getHandler('fps:stop')({})).toEqual({ ok: true })
    expect(mocks.requestFpsHelperStop).toHaveBeenCalledTimes(1)
    expect(getFpsStatus().state).toBe('off')
  })

  it('will-quit grava o stop síncrono sem depender do event loop', () => {
    registerFpsIpc(createContext())
    const willQuit = mocks.once.mock.calls.find((call) => call[0] === 'will-quit')?.[1] as
      (() => void) | undefined
    expect(willQuit).toBeTypeOf('function')
    willQuit?.()
    expect(mocks.requestFpsHelperStopSync).toHaveBeenCalledWith('quit')
  })
})

describe('startFpsMonitor/stopFpsMonitor', () => {
  it('sem Windows suportado o helper falha e o estado vira erro', async () => {
    mocks.startFpsHelper.mockResolvedValue({ ok: false, error: 'só Windows' })
    const result = await startFpsMonitor()
    expect(result.ok).toBe(false)
    expect(getFpsStatus().state).toBe('error')
    expect(getFpsStatus().error).toBe('só Windows')
  })

  it('polling lê o NDJSON no outputPath protegido devolvido pelo helper', async () => {
    registerFpsIpc(createContext())
    await getHandler('fps:start')({})

    await vi.waitFor(() => {
      expect(mocks.readFpsChunk).toHaveBeenCalledWith(FAKE_PATHS.outputPath, expect.any(Number))
    })
    expect(FAKE_PATHS.outputPath).toContain('ProgramData')
    stopFpsMonitor()
  })

  it('stop sem sessão não escreve stop no disco', () => {
    resetFpsMonitorForTests()
    expect(stopFpsMonitor()).toEqual({ ok: true })
    expect(mocks.requestFpsHelperStop).not.toHaveBeenCalled()
  })
})
