import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => process.env.TEST_USER_DATA ?? 'C:\\userData'),
    once: vi.fn()
  },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./agent')>()
  return {
    ...actual,
    isFpsAgentInstalled: vi.fn(async () => true),
    installFpsAgent: vi.fn(async () => ({ ok: true })),
    removeFpsAgent: vi.fn(),
    isFpsCaptureActive: vi.fn()
  }
})
vi.mock('./engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engine')>()
  return { ...actual, isPresentMonBinary: vi.fn(() => true) }
})

import { installFpsAgent, isFpsAgentInstalled } from './agent'
import {
  FPS_AGENT_SCRIPT_VERSION,
  isPresentMonBinary,
  PRESENTMON_SHA256,
  PRESENTMON_SIZE,
  PRESENTMON_VERSION
} from './engine'
import {
  activateFpsCapture,
  getCachedFpsReading,
  getFpsStatus,
  refreshFpsReading,
  resetFpsForTests,
  startFpsCapture,
  stopFpsCapture,
  writeFpsHeartbeat
} from './index'
import {
  captureManifestPath,
  resolveCaptureDir,
  resolveFpsSinkDir,
  resolveHeartbeatPath
} from './paths'

const ROOT = mkdtempSync(join(tmpdir(), 'kolnd-fps-index-'))
const USER_DATA = join(ROOT, 'userData')
const PROGRAM_DATA = join(ROOT, 'ProgramData')
const SINK_FILE = join(resolveFpsSinkDir('C:\\ProgramData', USER_DATA), 'latest.json')

process.env.KOLDND_HUB_TEST_USERDATA = USER_DATA
process.env.TEST_USER_DATA = USER_DATA
const ORIGINAL_PROGRAM_DATA = process.env.ProgramData
process.env.ProgramData = PROGRAM_DATA

afterAll(() => {
  delete process.env.KOLDND_HUB_TEST_USERDATA
  delete process.env.TEST_USER_DATA
  if (ORIGINAL_PROGRAM_DATA === undefined) delete process.env.ProgramData
  else process.env.ProgramData = ORIGINAL_PROGRAM_DATA
  rmSync(ROOT, { recursive: true, force: true })
})

function writeManifest(overrides: Record<string, unknown> = {}): void {
  const dir = resolveCaptureDir(PROGRAM_DATA)
  mkdirSync(dir, { recursive: true })
  const manifest = {
    schema: 1,
    engine: {
      name: 'PresentMon',
      version: PRESENTMON_VERSION,
      sha256: PRESENTMON_SHA256,
      size: PRESENTMON_SIZE
    },
    scriptVersion: FPS_AGENT_SCRIPT_VERSION,
    generatedAt: '2026-11-26T12:00:00.000Z',
    ...overrides
  }
  writeFileSync(captureManifestPath(dir), JSON.stringify(manifest), 'utf8')
}

function writeSink(overrides: Record<string, unknown> = {}, ageMs = 0): void {
  const sink = {
    schema: 2,
    engine: { name: 'PresentMon', version: '2.6.0' },
    timestamp: new Date(Date.now() - ageMs).toISOString(),
    foregroundPid: 4242,
    foregroundName: 'game.exe',
    windowMs: 1000,
    pids: [{ pid: 4242, name: 'game.exe', presents: 144, frametimeMs: 6.94 }],
    ...overrides
  }
  mkdirSync(join(USER_DATA, 'fps-sink'), { recursive: true })
  writeFileSync(SINK_FILE, JSON.stringify(sink), 'utf8')
}

beforeEach(() => {
  vi.clearAllMocks()
  resetFpsForTests()
  rmSync(SINK_FILE, { force: true })
  rmSync(join(PROGRAM_DATA, 'Kolnd Hub'), { recursive: true, force: true })
  vi.mocked(isFpsAgentInstalled).mockResolvedValue(true)
  vi.mocked(installFpsAgent).mockResolvedValue({ ok: true })
  vi.mocked(isPresentMonBinary).mockReturnValue(true)
})

describe('refreshFpsReading', () => {
  it('sink fresco vira leitura live com o PID em primeiro plano', async () => {
    writeSink()
    const reading = await refreshFpsReading()
    expect(reading).toEqual({
      state: 'live',
      fps: 144,
      frametimeMs: 6.94,
      processName: 'game'
    })
    expect(getCachedFpsReading()).toEqual(reading)
  })

  it('Hub em foco vira self-focus sem número', async () => {
    writeSink({ foregroundPid: process.pid, foregroundName: 'electron.exe' })
    const reading = await refreshFpsReading()
    expect(reading).toMatchObject({ state: 'no-target', reason: 'self-focus' })
    expect(reading.fps).toBeNull()
    expect(reading.processName).toBeNull()
  })

  it('sink velho vira unavailable/stale (não repete o número)', async () => {
    writeSink({}, 10_000)
    const reading = await refreshFpsReading()
    expect(reading).toMatchObject({ state: 'unavailable', reason: 'stale' })
    expect(reading.fps).toBeNull()
  })

  it('sem tarefa e com motor embutido = not-activated', async () => {
    vi.mocked(isFpsAgentInstalled).mockResolvedValue(false)
    const reading = await refreshFpsReading()
    expect(reading).toMatchObject({ state: 'not-activated', reason: 'not-activated' })
    expect(isPresentMonBinary).toHaveBeenCalled()
  })

  it('sem tarefa e sem o motor embutido = engine-missing', async () => {
    vi.mocked(isFpsAgentInstalled).mockResolvedValue(false)
    vi.mocked(isPresentMonBinary).mockReturnValue(false)
    const reading = await refreshFpsReading()
    expect(reading).toMatchObject({ state: 'unavailable', reason: 'engine-missing' })
  })

  it('instalada sem sink ainda = warming (primeira janela fecha em ~1 s)', async () => {
    vi.mocked(isFpsAgentInstalled).mockResolvedValue(true)
    const reading = await refreshFpsReading()
    expect(reading).toMatchObject({ state: 'warming', reason: 'warming' })
  })

  it('manifesto atual evita spawn de schtasks e fica warming', async () => {
    writeManifest()
    const reading = await refreshFpsReading()
    expect(reading).toMatchObject({ state: 'warming', reason: 'warming' })
    expect(isFpsAgentInstalled).not.toHaveBeenCalled()
  })

  it('manifesto divergente = outdated sem consultar schtasks', async () => {
    writeManifest({
      engine: {
        name: 'PresentMon',
        version: '2.5.0',
        sha256: PRESENTMON_SHA256,
        size: PRESENTMON_SIZE
      }
    })
    const reading = await refreshFpsReading()
    expect(reading).toMatchObject({ state: 'outdated', reason: 'outdated' })
    expect(isFpsAgentInstalled).not.toHaveBeenCalled()
  })

  it('sink fresco tem prioridade sobre o manifesto', async () => {
    writeSink()
    writeManifest({
      engine: {
        name: 'PresentMon',
        version: '2.5.0',
        sha256: PRESENTMON_SHA256,
        size: PRESENTMON_SIZE
      }
    })
    const reading = await refreshFpsReading()
    expect(reading.state).toBe('live')
  })

  it('sem manifesto, a consulta real de schtasks respeita o TTL de 60 s', async () => {
    vi.mocked(isFpsAgentInstalled).mockResolvedValue(false)
    await refreshFpsReading()
    await refreshFpsReading()
    expect(isFpsAgentInstalled).toHaveBeenCalledTimes(1)
  })
})

describe('getFpsStatus', () => {
  it('devolve tarefa instalada, captura ativa e a leitura', async () => {
    writeSink()
    const status = await getFpsStatus()
    expect(status.installed).toBe(true)
    expect(status.active).toBe(true)
    expect(status.reading.state).toBe('live')
    expect(isFpsAgentInstalled).toHaveBeenCalledTimes(1)
  })
})

describe('activateFpsCapture', () => {
  it('com a tarefa instalada não pede UAC nem reinstala', async () => {
    writeSink()
    const result = await activateFpsCapture()
    expect(result.ok).toBe(true)
    expect(result.reading.state).toBe('live')
    expect(installFpsAgent).not.toHaveBeenCalled()
  })

  it('recusa marca not-activated e não reabre o UAC na sessão', async () => {
    vi.mocked(isFpsAgentInstalled).mockResolvedValue(false)
    vi.mocked(installFpsAgent).mockResolvedValue({
      ok: false,
      cancelled: true,
      error: 'recusado'
    })

    const first = await activateFpsCapture()
    expect(first.cancelled).toBe(true)
    expect(first.reading.state).toBe('not-activated')
    expect(installFpsAgent).toHaveBeenCalledTimes(1)

    const second = await activateFpsCapture()
    expect(second.cancelled).toBe(true)
    expect(second.reading.state).toBe('not-activated')
    // Uma tentativa por sessão: o segundo atalho não reabre o UAC.
    expect(installFpsAgent).toHaveBeenCalledTimes(1)
  })

  it('retry explícito (force) do Monitor pode pedir o UAC de novo', async () => {
    vi.mocked(isFpsAgentInstalled).mockResolvedValue(false)
    vi.mocked(installFpsAgent).mockResolvedValue({ ok: false, cancelled: true })

    await activateFpsCapture()
    await activateFpsCapture({ force: true })
    expect(installFpsAgent).toHaveBeenCalledTimes(2)
  })
})

describe('heartbeat', () => {
  it('escreve e remove o heartbeat do userData', async () => {
    const path = resolveHeartbeatPath(USER_DATA)
    await writeFpsHeartbeat(path, 123)
    expect(existsSync(path)).toBe(true)

    startFpsCapture()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(existsSync(path)).toBe(true)
    stopFpsCapture()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(existsSync(path)).toBe(false)
  })
})
