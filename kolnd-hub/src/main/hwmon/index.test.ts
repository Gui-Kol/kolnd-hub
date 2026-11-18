import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HwSnapshot } from '../../shared/hwmon'

const mocks = vi.hoisted(() => ({
  snapshotNative: vi.fn(),
  readCpuPower: vi.fn(),
  getDriverStatus: vi.fn(),
  installDriver: vi.fn(),
  handle: vi.fn(),
  once: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  app: { once: mocks.once }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./nativeSensors', () => ({ snapshotNative: mocks.snapshotNative }))
vi.mock('./cpuPower', () => ({ readCpuPower: mocks.readCpuPower }))
vi.mock('./driver', () => ({
  getDriverStatus: mocks.getDriverStatus,
  installDriver: mocks.installDriver
}))

import {
  acquireHwPolling,
  collectHwSnapshot,
  getHwPollingRefCountForTests,
  mergeCpuReadings,
  onHwSnapshot,
  registerHwMonitorIpc,
  releaseHwPolling,
  resetHwMonitorForTests
} from './index'
import type { IpcContext } from '../ipc/lifecycle'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

function nativeFixture(): HwSnapshot {
  return {
    power: {
      cpuW: null,
      gpuW: 28.16,
      totalMeasuredW: null,
      // 8 núcleos a 12,5%: 71 × (0,25 + 0,75 × 0,125^1,2) ≈ 22,1 W.
      cpuEstimatedW: 22.1,
      platformEstimatedW: 30,
      totalEstimatedW: 80.3
    },
    cpu: {
      model: 'AMD Ryzen 7 5700X 8-Core Processor',
      usagePercent: 12.5,
      clockMhz: 3401,
      tempC: null,
      watts: null
    },
    ram: {
      installedGb: 24,
      speedMhz: 3200,
      voltageV: 1.2,
      usedGb: 11.4,
      usedPercent: 47.7
    },
    gpu: {
      model: 'NVIDIA GeForce RTX 5060 Ti',
      usagePercent: 2,
      coreClockMhz: 2655,
      memClockMhz: 14001,
      vramUsedMb: 1427,
      vramTotalMb: 8151,
      sharedMb: 116.9,
      tempC: 41.35,
      fanPercent: 0,
      watts: 28.16,
      powerLimitW: 180
    },
    specs: {
      cpu: 'AMD Ryzen 7 5700X 8-Core Processor · 8 núcleos / 16 threads',
      gpu: 'NVIDIA GeForce RTX 5060 Ti · 8151 MiB de VRAM',
      ram: '24 GB · DDR4-3200 · 3 módulos',
      board: 'MSI B550M PRO-VDH WIFI (MS-7C95)'
    },
    sources: {
      driver: 'absent',
      cpu: 'estimated',
      gpu: 'measured',
      platform: 'estimated'
    },
    capturedAt: '2026-11-17T12:00:00.000Z'
  }
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

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  resetHwMonitorForTests()
  mocks.handle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  mocks.snapshotNative.mockResolvedValue(nativeFixture())
  mocks.readCpuPower.mockResolvedValue({ available: false, tempC: null, watts: null })
  mocks.getDriverStatus.mockResolvedValue({
    state: 'absent',
    filePresent: true,
    serviceInstalled: false,
    deviceAccessible: false,
    sourcePath: 'C:\\resources\\drivers\\WinRing0x64.sys',
    installedPath: 'C:\\ProgramData\\Kolnd Hub\\drivers\\WinRing0x64.sys'
  })
  mocks.installDriver.mockResolvedValue({ ok: true, state: 'ready' })
})

describe('mergeCpuReadings', () => {
  const cpuReading = { available: true, tempC: 47.5, watts: 65.4 }

  it('soma CPU + GPU somente quando as duas são medidas', () => {
    const merged = mergeCpuReadings(nativeFixture(), cpuReading, 'ready')
    expect(merged.cpu.tempC).toBe(47.5)
    expect(merged.cpu.watts).toBe(65.4)
    expect(merged.power).toEqual({
      cpuW: 65.4,
      gpuW: 28.16,
      totalMeasuredW: 93.6,
      // A estimativa continua no snapshot como referência, mas a fonte é a medida.
      cpuEstimatedW: 22.1,
      platformEstimatedW: 30,
      totalEstimatedW: 80.3
    })
    expect(merged.sources).toEqual({
      driver: 'ready',
      cpu: 'measured',
      gpu: 'measured',
      platform: 'estimated'
    })
  })

  it('sem GPU (ou sem CPU) a energia total medida fica null — não inventa', () => {
    const noGpu = nativeFixture()
    noGpu.gpu.watts = null
    const merged = mergeCpuReadings(noGpu, cpuReading, 'ready')
    expect(merged.power.totalMeasuredW).toBeNull()
    // Sem GPU medida o total estimado também não existe (não somamos buraco).
    expect(merged.power.totalEstimatedW).toBeNull()
    expect(merged.sources.gpu).toBe('unavailable')

    const noCpu = mergeCpuReadings(
      nativeFixture(),
      { available: false, tempC: null, watts: null },
      'absent'
    )
    expect(noCpu.power.cpuW).toBeNull()
    expect(noCpu.power.totalMeasuredW).toBeNull()
    expect(noCpu.cpu.tempC).toBeNull()
    expect(noCpu.cpu.watts).toBeNull()
    // Sem driver, a estimativa assume a linha da CPU com rótulo próprio.
    expect(noCpu.power.cpuEstimatedW).toBe(22.1)
    expect(noCpu.power.totalEstimatedW).toBe(80.3)
    expect(noCpu.sources.cpu).toBe('estimated')
  })

  it('driver pronto sem watts derruba a fonte para estimado (degrada, não quebra)', () => {
    const merged = mergeCpuReadings(
      nativeFixture(),
      { available: true, tempC: 52, watts: null },
      'ready'
    )
    expect(merged.cpu.tempC).toBe(52)
    expect(merged.power.cpuW).toBeNull()
    expect(merged.power.totalMeasuredW).toBeNull()
    expect(merged.sources.cpu).toBe('estimated')
    expect(merged.power.totalEstimatedW).toBe(80.3)
  })

  it('snapshot sem núcleos nem estimativa degrada para unavailable', () => {
    const native = nativeFixture()
    native.power.cpuEstimatedW = null
    native.power.totalEstimatedW = null
    const merged = mergeCpuReadings(
      native,
      { available: false, tempC: null, watts: null },
      'absent'
    )
    expect(merged.power.cpuEstimatedW).toBeNull()
    expect(merged.power.totalEstimatedW).toBeNull()
    expect(merged.sources.cpu).toBe('unavailable')
  })
})

describe('collectHwSnapshot', () => {
  it('sem driver mantém CPU temp/potência em null, mas entrega as estimativas rotuladas', async () => {
    const snapshot = await collectHwSnapshot()
    expect(snapshot.cpu.tempC).toBeNull()
    expect(snapshot.cpu.watts).toBeNull()
    expect(snapshot.power.totalMeasuredW).toBeNull()
    expect(snapshot.power.cpuEstimatedW).toBe(22.1)
    expect(snapshot.power.platformEstimatedW).toBe(30)
    expect(snapshot.power.totalEstimatedW).toBe(80.3)
    expect(snapshot.sources.driver).toBe('absent')
    expect(snapshot.sources.cpu).toBe('estimated')
    expect(snapshot.sources.gpu).toBe('measured')
    expect(snapshot.gpu.model).toBe('NVIDIA GeForce RTX 5060 Ti')
    // O helper privilegiado nem é chamado quando o device não está acessível.
    expect(mocks.readCpuPower).not.toHaveBeenCalled()
  })
})

describe('registerHwMonitorIpc', () => {
  it('registra os canais e o stop no will-quit', () => {
    registerHwMonitorIpc(createContext())
    expect([...handlers.keys()].sort()).toEqual([
      'hwmon:driver-status',
      'hwmon:install-driver',
      'hwmon:snapshot',
      'hwmon:start',
      'hwmon:stop'
    ])
    expect(mocks.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
  })

  it('hwmon:snapshot devolve o snapshot e rejeita argumentos inesperados', async () => {
    registerHwMonitorIpc(createContext())
    const handler = getHandler('hwmon:snapshot')

    const snapshot = (await handler({})) as HwSnapshot
    expect(snapshot.gpu.model).toBe('NVIDIA GeForce RTX 5060 Ti')
    expect(snapshot.cpu.tempC).toBeNull()
    expect(snapshot.power.totalMeasuredW).toBeNull()

    await expect(handler({}, 'inesperado')).rejects.toThrow('Requisição inválida.')
  })

  it('hwmon:driver-status devolve o status atual', async () => {
    registerHwMonitorIpc(createContext())
    const status = (await getHandler('hwmon:driver-status')({})) as { state: string }
    expect(status.state).toBe('absent')
  })

  it('hwmon:install-driver delega ao driver e atualiza o estado', async () => {
    registerHwMonitorIpc(createContext())
    const result = (await getHandler('hwmon:install-driver')({})) as {
      ok: boolean
      state?: string
    }
    expect(mocks.installDriver).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, state: 'ready' })
  })

  it('hwmon:start e hwmon:stop são idempotentes', async () => {
    registerHwMonitorIpc(createContext())

    expect(getHandler('hwmon:start')({})).toEqual({ ok: true })
    expect(getHandler('hwmon:start')({})).toEqual({ ok: true })
    expect(getHwPollingRefCountForTests()).toBe(2)
    expect(getHandler('hwmon:stop')({})).toEqual({ ok: true })
    expect(getHandler('hwmon:stop')({})).toEqual({ ok: true })
    expect(getHwPollingRefCountForTests()).toBe(0)

    // Deixa o snapshot assíncrono do start terminar antes do fim do teste.
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
})

describe('refcount do polling (aba + HUD)', () => {
  it('compartilha um único timer e só para quando o último consumidor solta', async () => {
    const seen: HwSnapshot[] = []
    const unsubscribe = onHwSnapshot((snapshot) => seen.push(snapshot))

    acquireHwPolling()
    acquireHwPolling()
    expect(getHwPollingRefCountForTests()).toBe(2)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(seen.length).toBeGreaterThan(0)

    releaseHwPolling()
    expect(getHwPollingRefCountForTests()).toBe(1)

    releaseHwPolling()
    expect(getHwPollingRefCountForTests()).toBe(0)

    unsubscribe()
  })

  it('listener que lança não impede os demais de receber o snapshot', async () => {
    const received: HwSnapshot[] = []
    const unsubscribeBad = onHwSnapshot(() => {
      throw new Error('assinante quebrado')
    })
    const unsubscribeGood = onHwSnapshot((snapshot) => received.push(snapshot))

    acquireHwPolling()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(received.length).toBeGreaterThan(0)

    releaseHwPolling()
    unsubscribeBad()
    unsubscribeGood()
  })

  it('stopHwMonitorPolling zera o refcount (will-quit nunca deixa timer)', () => {
    acquireHwPolling()
    expect(getHwPollingRefCountForTests()).toBe(1)
    resetHwMonitorForTests()
    expect(getHwPollingRefCountForTests()).toBe(0)
    // release depois de um stop forçado não vai a negativo.
    releaseHwPolling()
    expect(getHwPollingRefCountForTests()).toBe(0)
  })
})
