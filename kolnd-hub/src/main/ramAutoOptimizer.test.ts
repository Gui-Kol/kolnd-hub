import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RamAutoPrefs, RamOptimizeResult } from '../shared/ram'

const MINUTE_MS = 60_000

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getRamAutoPrefs: vi.fn(),
  setRamAutoPrefs: vi.fn(),
  trimWorkingSets: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
  }
}))
vi.mock('./store', () => ({
  getRamAutoPrefs: mocks.getRamAutoPrefs,
  setRamAutoPrefs: mocks.setRamAutoPrefs
}))
vi.mock('./ramOptimizer', () => ({
  trimWorkingSets: mocks.trimWorkingSets
}))

import {
  applyRamAutoPrefs,
  registerRamAutoIpc,
  resetRamAutoOptimizerForTests,
  startRamAutoOptimizer,
  stopRamAutoOptimizer
} from './ramAutoOptimizer'

function prefs(enabled: boolean, intervalMinutes = 10): RamAutoPrefs {
  return { enabled, intervalMinutes }
}

function trimOk(): RamOptimizeResult {
  return {
    ok: true,
    mode: 'trim',
    freedBytes: 1024,
    trimmedProcesses: 3,
    skipped: 2,
    errors: 0
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.handlers.clear()
  mocks.getRamAutoPrefs.mockReset()
  mocks.setRamAutoPrefs.mockReset()
  mocks.trimWorkingSets.mockReset()
  mocks.getRamAutoPrefs.mockReturnValue(prefs(false))
  mocks.setRamAutoPrefs.mockReturnValue({ success: true })
  mocks.trimWorkingSets.mockResolvedValue(trimOk())
  resetRamAutoOptimizerForTests()
})

afterEach(() => {
  resetRamAutoOptimizerForTests()
  vi.useRealTimers()
})

describe('applyRamAutoPrefs', () => {
  it('desligado não agenda nada', async () => {
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(120 * MINUTE_MS)
    expect(mocks.trimWorkingSets).not.toHaveBeenCalled()
  })

  it('ligado só executa depois do intervalo completo e reagenda', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 10))
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(9 * MINUTE_MS + 59_000)
    expect(mocks.trimWorkingSets).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(2)
  })

  it('usa somente o trim (nunca o purge com UAC)', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 1))
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)
    // O módulo só importa trimWorkingSets; nenhum canal de purge é registrado.
    expect(mocks.handlers.size).toBe(0)
  })

  it('um tick sobreposto não dispara um segundo trim', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 1))
    let finishTrim!: (result: RamOptimizeResult) => void
    mocks.trimWorkingSets.mockReturnValueOnce(
      new Promise<RamOptimizeResult>((resolve) => {
        finishTrim = resolve
      })
    )
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)

    // Reaplica a preferência com o trim ainda em andamento: o próximo tick
    // encontra a execução pendente e apenas reagenda.
    applyRamAutoPrefs()
    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)

    finishTrim(trimOk())
    await vi.advanceTimersByTimeAsync(0)
  })

  it('reagenda lendo a preferência de novo depois do trim', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 1))
    let finishTrim!: (result: RamOptimizeResult) => void
    mocks.trimWorkingSets.mockReturnValueOnce(
      new Promise<RamOptimizeResult>((resolve) => {
        finishTrim = resolve
      })
    )
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)

    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 5))
    finishTrim(trimOk())
    await vi.advanceTimersByTimeAsync(0)

    // O próximo disparo segue o intervalo novo (5 min), não o antigo (1 min).
    await vi.advanceTimersByTimeAsync(4 * MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(2)
  })

  it('mudar o intervalo reagenda sem deixar o timer antigo disparar', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 5))
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(4 * MINUTE_MS)
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 10))
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(1 * MINUTE_MS)
    expect(mocks.trimWorkingSets).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(9 * MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)
  })

  it('desligar cancela o timer pendente', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 1))
    applyRamAutoPrefs()
    await vi.advanceTimersByTimeAsync(30_000)

    mocks.getRamAutoPrefs.mockReturnValue(prefs(false))
    applyRamAutoPrefs()

    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS)
    expect(mocks.trimWorkingSets).not.toHaveBeenCalled()
  })
})

describe('start/stop', () => {
  it('start aplica a preferência e stop cancela o timer', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 1))

    startRamAutoOptimizer()
    await vi.advanceTimersByTimeAsync(MINUTE_MS - 1_000)
    expect(mocks.trimWorkingSets).not.toHaveBeenCalled()

    stopRamAutoOptimizer()
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS)
    expect(mocks.trimWorkingSets).not.toHaveBeenCalled()
  })
})

describe('registerRamAutoIpc', () => {
  it('registra ram:auto-get e lê as preferências normalizadas pelo store', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 30))
    registerRamAutoIpc()

    const handler = mocks.handlers.get('ram:auto-get')
    expect(handler).toBeTypeOf('function')
    expect(await handler?.()).toEqual({ enabled: true, intervalMinutes: 30 })
  })

  it('ram:auto-set grava e, com sucesso, aplica a agenda', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 1))
    registerRamAutoIpc()

    const handler = mocks.handlers.get('ram:auto-set')
    expect(handler).toBeTypeOf('function')
    const result = await handler?.({}, { enabled: true, intervalMinutes: 1 })
    expect(result).toEqual({ success: true })
    expect(mocks.setRamAutoPrefs).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 1 })

    await vi.advanceTimersByTimeAsync(MINUTE_MS)
    expect(mocks.trimWorkingSets).toHaveBeenCalledTimes(1)
  })

  it('ram:auto-set com falha não agenda e ignora argumentos extras', async () => {
    mocks.getRamAutoPrefs.mockReturnValue(prefs(true, 1))
    mocks.setRamAutoPrefs.mockReturnValue({ success: false, error: 'inválido' })
    registerRamAutoIpc()

    const handler = mocks.handlers.get('ram:auto-set')
    const result = await handler?.({}, { enabled: true, intervalMinutes: 1 }, 'extra', 42)
    expect(result).toEqual({ success: false, error: 'inválido' })
    expect(mocks.setRamAutoPrefs).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 1 })

    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS)
    expect(mocks.trimWorkingSets).not.toHaveBeenCalled()
  })
})
