import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const GB = 1024 ** 3
const KB = 1024

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  runPowerShellCommand: vi.fn(),
  totalmem: vi.fn(),
  freemem: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./hwmon/powershell', () => ({ runPowerShellCommand: mocks.runPowerShellCommand }))
vi.mock('os', () => ({ totalmem: mocks.totalmem, freemem: mocks.freemem }))

import {
  buildRamCommand,
  collectRamSnapshot,
  parseRamSnapshot,
  parseTopProcesses,
  registerRamMonitorIpc,
  resetRamMonitorForTests
} from './ramMonitor'

const FALLBACK = { totalBytes: 16 * GB, freeBytes: 4 * GB }

interface RawOsMemory {
  TotalVisibleMemorySize?: unknown
  FreePhysicalMemory?: unknown
  AvailableBytes?: unknown
  CacheBytes?: unknown
  StandbyCacheNormalPriorityBytes?: unknown
  StandbyCacheReserveBytes?: unknown
  StandbyCacheCoreBytes?: unknown
  CommittedBytes?: unknown
  Processes?: unknown
}

function json(overrides: RawOsMemory = {}): string {
  return JSON.stringify({
    TotalVisibleMemorySize: (16 * GB) / KB,
    FreePhysicalMemory: (4 * GB) / KB,
    AvailableBytes: 8 * GB,
    CacheBytes: 2 * GB,
    StandbyCacheNormalPriorityBytes: 1 * GB,
    StandbyCacheReserveBytes: 512 * 1024 ** 2,
    StandbyCacheCoreBytes: 128 * 1024 ** 2,
    CommittedBytes: 10 * GB,
    Processes: [
      { Id: 100, ProcessName: 'chrome', WorkingSet64: 2 * GB },
      { Id: 200, ProcessName: 'game', WorkingSet64: 4 * GB }
    ],
    ...overrides
  })
}

beforeEach(() => {
  resetRamMonitorForTests()
  mocks.runPowerShellCommand.mockReset()
  mocks.totalmem.mockReturnValue(16 * GB)
  mocks.freemem.mockReturnValue(4 * GB)
  mocks.handlers.clear()
})

afterEach(() => {
  resetRamMonitorForTests()
})

describe('buildRamCommand', () => {
  it('coleta SO, contadores e processos numa única chamada com JSON compacto', () => {
    const command = buildRamCommand()
    expect(command).toContain('Win32_OperatingSystem')
    expect(command).toContain('Win32_PerfFormattedData_PerfOS_Memory')
    expect(command).toContain('Select-Object -First 10')
    expect(command).toContain('ConvertTo-Json -Compress -Depth 4')
  })
})

describe('parseRamSnapshot', () => {
  it('lê o JSON válido e calcula uso a partir do disponível', () => {
    const snapshot = parseRamSnapshot(json(), FALLBACK)

    expect(snapshot).toMatchObject({
      ok: true,
      source: 'cim',
      totalBytes: 16 * GB,
      freeBytes: 4 * GB,
      availableBytes: 8 * GB,
      cacheBytes: 2 * GB,
      committedBytes: 10 * GB,
      usedBytes: 8 * GB,
      usedPercent: 50
    })
    expect(snapshot.standbyBytes).toBe(1 * GB + 512 * 1024 ** 2 + 128 * 1024 ** 2)
    expect(snapshot.topProcesses.map((p) => p.name)).toEqual(['game', 'chrome'])
  })

  it('mantém campos ausentes como null e usa o disponível do Node no cálculo', () => {
    const snapshot = parseRamSnapshot(
      JSON.stringify({
        TotalVisibleMemorySize: (16 * GB) / KB,
        FreePhysicalMemory: (4 * GB) / KB
      }),
      FALLBACK
    )

    expect(snapshot.ok).toBe(true)
    expect(snapshot.source).toBe('cim')
    expect(snapshot.availableBytes).toBeNull()
    expect(snapshot.cacheBytes).toBeNull()
    expect(snapshot.standbyBytes).toBeNull()
    expect(snapshot.committedBytes).toBeNull()
    expect(snapshot.topProcesses).toEqual([])
    expect(snapshot.usedBytes).toBe(12 * GB)
  })

  it('cai no fallback do Node com JSON inválido', () => {
    const snapshot = parseRamSnapshot('não é json', FALLBACK)

    expect(snapshot).toMatchObject({
      ok: true,
      source: 'os',
      totalBytes: 16 * GB,
      freeBytes: 4 * GB,
      usedBytes: 12 * GB,
      usedPercent: 75,
      availableBytes: null,
      cacheBytes: null,
      standbyBytes: null,
      committedBytes: null,
      topProcesses: []
    })
  })

  it('cai no fallback quando o JSON não é um objeto', () => {
    expect(parseRamSnapshot('[1,2,3]', FALLBACK).source).toBe('os')
    expect(parseRamSnapshot('null', FALLBACK).source).toBe('os')
  })

  it('ignora contadores negativos ou não numéricos sem quebrar', () => {
    const snapshot = parseRamSnapshot(
      json({
        FreePhysicalMemory: -123,
        AvailableBytes: -1,
        CacheBytes: 'abc',
        CommittedBytes: null,
        StandbyCacheNormalPriorityBytes: -5,
        StandbyCacheReserveBytes: 'x',
        StandbyCacheCoreBytes: null
      }),
      FALLBACK
    )

    expect(snapshot.freeBytes).toBe(4 * GB)
    expect(snapshot.availableBytes).toBeNull()
    expect(snapshot.cacheBytes).toBeNull()
    expect(snapshot.committedBytes).toBeNull()
    expect(snapshot.standbyBytes).toBeNull()
    expect(snapshot.usedBytes).toBe(12 * GB)
  })

  it('clampa o percentual entre 0 e 100', () => {
    const cheio = parseRamSnapshot(json({ AvailableBytes: 0 }), FALLBACK)
    expect(cheio.usedPercent).toBe(100)
    expect(cheio.usedBytes).toBe(16 * GB)

    const vazio = parseRamSnapshot(json({ AvailableBytes: 99 * GB }), FALLBACK)
    expect(vazio.usedPercent).toBe(0)
    expect(vazio.usedBytes).toBe(0)
  })

  it('cai no fallback fatal quando nem o total é conhecido', () => {
    const snapshot = parseRamSnapshot('{}', { totalBytes: 0, freeBytes: 0 })

    expect(snapshot.ok).toBe(false)
    expect(snapshot.source).toBe('os')
    expect(snapshot.totalBytes).toBe(0)
    expect(snapshot.error).toBeTruthy()
  })
})

describe('parseTopProcesses', () => {
  it('ordena por working set, limita a 10 e descarta linhas inválidas', () => {
    const rows = Array.from({ length: 14 }, (_, index) => ({
      Id: index + 1,
      ProcessName: `proc${index}`,
      WorkingSet64: index * 1024
    }))
    rows.push({ Id: 0, ProcessName: 'invalido', WorkingSet64: 999 } as never)
    rows.push({ Id: 99, ProcessName: '', WorkingSet64: 999 } as never)

    const processes = parseTopProcesses(rows)

    expect(processes).toHaveLength(10)
    expect(processes[0]).toMatchObject({ pid: 14, name: 'proc13', workingSetBytes: 13 * 1024 })
    expect(processes.at(-1)?.pid).toBe(5)
    expect(processes.every((p) => p.workingSetBytes >= 0)).toBe(true)
  })

  it('aceita um único processo como objeto', () => {
    expect(parseTopProcesses({ Id: 7, ProcessName: 'hub', WorkingSet64: 512 })).toEqual([
      { pid: 7, name: 'hub', workingSetBytes: 512 }
    ])
  })
})

describe('collectRamSnapshot', () => {
  it('usa o fallback do Node quando o PowerShell falha', async () => {
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: '',
      stderr: 'falhou',
      code: 1,
      timedOut: false
    })

    const snapshot = await collectRamSnapshot()
    expect(snapshot.source).toBe('os')
    expect(snapshot.totalBytes).toBe(16 * GB)
    expect(snapshot.freeBytes).toBe(4 * GB)
    expect(snapshot.ok).toBe(true)
  })

  it('usa o fallback quando o PowerShell devolve JSON inválido', async () => {
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: '{quebrado',
      stderr: '',
      code: 0,
      timedOut: false
    })

    const snapshot = await collectRamSnapshot()
    expect(snapshot.source).toBe('os')
  })

  it('faz cache curto e de-duplica chamadas em voo', async () => {
    let resolveRun: (value: unknown) => void = () => {}
    mocks.runPowerShellCommand.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve
      })
    )

    const first = collectRamSnapshot()
    const second = collectRamSnapshot()
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(1)

    resolveRun({ stdout: json(), stderr: '', code: 0, timedOut: false })
    const [a, b] = await Promise.all([first, second])
    expect(a.totalBytes).toBe(16 * GB)
    expect(b).toBe(a)

    await collectRamSnapshot()
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(1)
  })

  it('force ignora o cache (medição antes/depois)', async () => {
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: json(),
      stderr: '',
      code: 0,
      timedOut: false
    })

    await collectRamSnapshot()
    await collectRamSnapshot(true)
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(2)
  })
})

describe('registerRamMonitorIpc', () => {
  it('registra ram:info e devolve o snapshot', async () => {
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: json(),
      stderr: '',
      code: 0,
      timedOut: false
    })

    registerRamMonitorIpc()
    const handler = mocks.handlers.get('ram:info')
    expect(handler).toBeTypeOf('function')

    const snapshot = (await handler?.({})) as { totalBytes: number }
    expect(snapshot.totalBytes).toBe(16 * GB)
  })
})
