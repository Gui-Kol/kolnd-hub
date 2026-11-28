import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RamSnapshot } from '../shared/ram'

const GB = 1024 ** 3

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  runPowerShellCommand: vi.fn(),
  runPowerShell: vi.fn(),
  collectRamSnapshot: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./hwmon/powershell', () => ({
  runPowerShellCommand: mocks.runPowerShellCommand,
  runPowerShell: mocks.runPowerShell
}))
vi.mock('./ramMonitor', () => ({ collectRamSnapshot: mocks.collectRamSnapshot }))

import {
  CRITICAL_PROCESS_NAMES,
  buildElevatedPurgeArgs,
  buildPurgeScript,
  buildTrimScript,
  computeFreedBytes,
  hubProcessName,
  parsePurgeOutput,
  parseTrimOutput,
  purgeStandbyMemory,
  registerRamOptimizerIpc,
  trimWorkingSets
} from './ramOptimizer'

function snapshot(availableBytes: number | null): RamSnapshot {
  return {
    ok: true,
    totalBytes: 16 * GB,
    usedBytes: 8 * GB,
    usedPercent: 50,
    freeBytes: 4 * GB,
    availableBytes,
    cacheBytes: null,
    standbyBytes: null,
    committedBytes: null,
    topProcesses: [],
    source: 'cim'
  }
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.runPowerShellCommand.mockReset()
  mocks.runPowerShell.mockReset()
  mocks.collectRamSnapshot.mockReset()
})

describe('buildTrimScript', () => {
  it('usa P/Invoke sem elevação e preserva o Hub, o PowerShell e os críticos', () => {
    const script = buildTrimScript(4242, 'Kolnd Hub')

    expect(script).toContain('EmptyWorkingSet')
    expect(script).toContain('OpenProcess')
    expect(script).toContain('0x0400 -bor 0x0100')
    expect(script).toContain('$hubPid = 4242')
    expect(script).toContain("$hubName = 'Kolnd Hub'")
    expect(script).toContain('$p.Id -eq $PID')
    expect(script).toContain('$p.SessionId -eq 0')
    for (const name of CRITICAL_PROCESS_NAMES) {
      expect(script).toContain(`'${name}'`)
    }
    expect(script).not.toContain('-EncodedCommand')
  })

  it('escapa aspas simples do nome do executável', () => {
    expect(buildTrimScript(1, "O'Brien")).toContain("$hubName = 'O''Brien'")
  })
})

describe('buildPurgeScript / buildElevatedPurgeArgs', () => {
  it('habilita o privilégio e chama NtSetSystemInformation(80, 4)', () => {
    const script = buildPurgeScript()
    expect(script).toContain('SeProfileSingleProcessPrivilege')
    expect(script).toContain('NtSetSystemInformation')
    expect(script).toContain('int command = 4')
    expect(script).toContain('NtSetSystemInformation(80, ref command, sizeof(int))')
  })

  it('monta o wrapper RunAs e o script interno por EncodedCommand', () => {
    const args = buildElevatedPurgeArgs()
    expect(args).toContain('-EncodedCommand')
    expect(args).toContain('-NoProfile')

    const encoded = args[args.length - 1]
    const wrapper = Buffer.from(encoded, 'base64').toString('utf16le')
    expect(wrapper).toContain('-Verb RunAs')
    expect(wrapper).toContain('-Wait -PassThru')
    expect(wrapper).toContain('Start-Process')

    const innerMatch = /-EncodedCommand','([^']+)'/.exec(wrapper)
    expect(innerMatch).not.toBeNull()
    const inner = Buffer.from(innerMatch?.[1] ?? '', 'base64').toString('utf16le')
    expect(inner).toContain('NtSetSystemInformation')
  })
})

describe('hubProcessName', () => {
  it('remove a extensão do executável', () => {
    expect(hubProcessName('C:\\Program Files\\Kolnd Hub\\Kolnd Hub.exe')).toBe('Kolnd Hub')
    expect(hubProcessName('C:\\app\\electron.exe')).toBe('electron')
  })
})

describe('parseTrimOutput', () => {
  it('lê contadores válidos e clampa valores inválidos', () => {
    expect(parseTrimOutput(JSON.stringify({ trimmed: 5, skipped: '3', errors: -2 }))).toEqual({
      trimmed: 5,
      skipped: 3,
      errors: 0
    })
    expect(parseTrimOutput('{"trimmed":null}')).toEqual({ trimmed: 0, skipped: 0, errors: 0 })
  })

  it('devolve null para JSON inválido ou sem os campos esperados', () => {
    expect(parseTrimOutput('quebrado')).toBeNull()
    expect(parseTrimOutput('[]')).toBeNull()
    expect(parseTrimOutput('{}')).toBeNull()
    expect(parseTrimOutput('null')).toBeNull()
  })
})

describe('parsePurgeOutput', () => {
  it('só aceita ok:true', () => {
    expect(parsePurgeOutput('{"ok":true,"code":0}')).toBe(true)
    expect(parsePurgeOutput('{"ok":false}')).toBe(false)
    expect(parsePurgeOutput('nada')).toBe(false)
  })
})

describe('computeFreedBytes', () => {
  it('mede o ganho de disponível e nunca devolve negativo', () => {
    expect(computeFreedBytes(snapshot(8 * GB), snapshot(10 * GB))).toBe(2 * GB)
    expect(computeFreedBytes(snapshot(10 * GB), snapshot(9 * GB))).toBe(0)
    expect(computeFreedBytes(snapshot(null), snapshot(10 * GB))).toBe(0)
    expect(computeFreedBytes(snapshot(8 * GB), snapshot(null))).toBe(0)
  })
})

describe('trimWorkingSets', () => {
  it('devolve contadores e o espaço liberado medido', async () => {
    mocks.collectRamSnapshot
      .mockResolvedValueOnce(snapshot(8 * GB))
      .mockResolvedValueOnce(snapshot(10 * GB))
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: JSON.stringify({ trimmed: 7, skipped: 4, errors: 1 }),
      stderr: '',
      code: 0,
      timedOut: false
    })

    const result = await trimWorkingSets()

    expect(result).toMatchObject({
      ok: true,
      mode: 'trim',
      freedBytes: 2 * GB,
      trimmedProcesses: 7,
      skipped: 4,
      errors: 1
    })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(1)
    expect(mocks.runPowerShellCommand.mock.calls[0][0]).toContain('EmptyWorkingSet')
    expect(mocks.collectRamSnapshot).toHaveBeenCalledTimes(2)
  })

  it('não quebra quando o script devolve JSON inválido', async () => {
    mocks.collectRamSnapshot.mockResolvedValue(snapshot(8 * GB))
    mocks.runPowerShellCommand.mockResolvedValue({
      stdout: 'lixo',
      stderr: '',
      code: 1,
      timedOut: false
    })

    const result = await trimWorkingSets()

    expect(result.ok).toBe(false)
    expect(result.mode).toBe('trim')
    expect(result.trimmedProcesses).toBe(0)
    expect(result.errors).toBe(1)
    expect(result.error).toBeTruthy()
  })
})

describe('purgeStandbyMemory', () => {
  it('mapeia UAC cancelado para cancelled:true sem erro técnico', async () => {
    mocks.collectRamSnapshot.mockResolvedValueOnce(snapshot(8 * GB))
    mocks.runPowerShell.mockResolvedValue({
      stdout: '',
      stderr: 'The operation was canceled by the user. (1223)',
      code: 1,
      timedOut: false
    })

    const result = await purgeStandbyMemory()

    expect(result).toMatchObject({
      ok: false,
      cancelled: true,
      mode: 'purge',
      freedBytes: 0,
      errors: 0
    })
    expect(result.error).toContain('cancelada')
  })

  it('devolve o espaço liberado quando o script elevado conclui', async () => {
    mocks.collectRamSnapshot
      .mockResolvedValueOnce(snapshot(8 * GB))
      .mockResolvedValueOnce(snapshot(12 * GB))
    mocks.runPowerShell.mockResolvedValue({
      stdout: '{"ok":true,"code":0}',
      stderr: '',
      code: 0,
      timedOut: false
    })

    const result = await purgeStandbyMemory()

    expect(result).toMatchObject({ ok: true, mode: 'purge', freedBytes: 4 * GB, errors: 0 })
  })

  it('aceita o sucesso pelo código de saída quando o console elevado não devolve stdout', async () => {
    mocks.collectRamSnapshot
      .mockResolvedValueOnce(snapshot(8 * GB))
      .mockResolvedValueOnce(snapshot(9 * GB))
    mocks.runPowerShell.mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
      timedOut: false
    })

    const result = await purgeStandbyMemory()

    expect(result).toMatchObject({ ok: true, mode: 'purge', freedBytes: 1 * GB })
  })

  it('devolve falha amigável quando a saída elevada é inválida', async () => {
    mocks.collectRamSnapshot.mockResolvedValue(snapshot(8 * GB))
    mocks.runPowerShell.mockResolvedValue({
      stdout: 'nada',
      stderr: '',
      code: 1,
      timedOut: false
    })

    const result = await purgeStandbyMemory()

    expect(result.ok).toBe(false)
    expect(result.cancelled).toBeUndefined()
    expect(result.errors).toBe(1)
    expect(result.error).toBeTruthy()
  })
})

describe('registerRamOptimizerIpc', () => {
  it('registra os dois canais', () => {
    registerRamOptimizerIpc()
    expect(mocks.handlers.has('ram:optimize')).toBe(true)
    expect(mocks.handlers.has('ram:purge-standby')).toBe(true)
  })
})
