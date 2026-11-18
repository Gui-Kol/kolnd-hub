import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriverStatus, DriverStatusInfo, HwSnapshot } from '../../shared/hwmon'

const mocks = vi.hoisted(() => ({
  snapshotNative: vi.fn(),
  readCpuPower: vi.fn(),
  getDriverStatus: vi.fn(),
  installDriver: vi.fn(),
  getHwmonIntervalMs: vi.fn(),
  setHwmonIntervalMs: vi.fn(),
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
// Importar ../store puxaria o electron-store real; o intervalo persistido é
// substituído por um mock controlável.
vi.mock('../store', () => ({
  getHwmonIntervalMs: mocks.getHwmonIntervalMs,
  setHwmonIntervalMs: mocks.setHwmonIntervalMs
}))
vi.mock('./nativeSensors', () => ({ snapshotNative: mocks.snapshotNative }))
vi.mock('./cpuPower', () => ({ readCpuPower: mocks.readCpuPower }))
vi.mock('./driver', () => ({
  getDriverStatus: mocks.getDriverStatus,
  installDriver: mocks.installDriver
}))

import {
  acquireHwPolling,
  applyHwPollIntervalMs,
  collectHwSnapshot,
  getHwPollIntervalMs,
  getHwPollingRefCountForTests,
  mergeCpuReadings,
  onHwSnapshot,
  registerHwMonitorIpc,
  releaseHwPolling,
  resetHwMonitorForTests,
  shouldReprobe
} from './index'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'

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
      vendor: 'nvidia',
      driverVersion: '621.24',
      driverDate: '2026-11-07',
      usagePercent: 2,
      coreClockMhz: 2655,
      memClockMhz: 14001,
      vramUsedMb: 1427,
      vramTotalMb: 8151,
      sharedMb: 116.9,
      tempC: 41.35,
      fanPercent: 0,
      fanRpm: 0,
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
      platform: 'estimated',
      cpuTemp: 'unavailable',
      gpuUsage: 'measured',
      gpuTemp: 'measured'
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

function driverStatus(state: DriverStatus): DriverStatusInfo {
  return {
    state,
    filePresent: state !== 'absent',
    serviceInstalled: state !== 'absent',
    deviceAccessible: state === 'ready',
    sourcePath: 'C:\\resources\\pawnio\\PawnIO_setup.exe',
    installedPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll'
  }
}

/** Contexto cuja janela registra os envios de `hwmon:update` (prova da UI). */
function createWindowContext(): { context: IpcContext; sent: HwSnapshot[] } {
  const sent: HwSnapshot[] = []
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: HwSnapshot) => {
        if (channel === 'hwmon:update') sent.push(payload)
      }
    }
  }
  return {
    context: {
      getMainWindow: () => window as unknown as ReturnType<IpcContext['getMainWindow']>,
      processManager: {} as IpcContext['processManager']
    },
    sent
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  resetHwMonitorForTests()
  mocks.handle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  mocks.snapshotNative.mockResolvedValue(nativeFixture())
  mocks.readCpuPower.mockResolvedValue({
    available: false,
    tempC: null,
    watts: null,
    voltageV: null
  })
  mocks.getDriverStatus.mockResolvedValue({
    state: 'absent',
    filePresent: true,
    serviceInstalled: false,
    deviceAccessible: false,
    sourcePath: 'C:\\resources\\pawnio\\PawnIO_setup.exe',
    installedPath: 'C:\\Program Files\\PawnIO\\PawnIOLib.dll'
  })
  mocks.installDriver.mockResolvedValue({ ok: true, state: 'ready' })
  mocks.getHwmonIntervalMs.mockReturnValue(500)
  // Mesmo contrato do store real: tipo errado vira erro; número volta como veio
  // (a normalização de faixa é feita pelo próprio módulo do monitor).
  mocks.setHwmonIntervalMs.mockImplementation((input: unknown) =>
    typeof input === 'number'
      ? { success: true, intervalMs: input }
      : { success: false, error: 'Intervalo inválido para o monitor de hardware.' }
  )
})

describe('mergeCpuReadings', () => {
  const cpuReading = { available: true, tempC: 47.5, watts: 65.4, voltageV: 1.35 }

  it('soma CPU + GPU somente quando as duas são medidas', () => {
    const merged = mergeCpuReadings(nativeFixture(), cpuReading, 'ready')
    expect(merged.cpu.tempC).toBe(47.5)
    expect(merged.cpu.watts).toBe(65.4)
    // A tensão medida pelo agente é propagada sem passar pela estimativa.
    expect(merged.cpu.voltageV).toBe(1.35)
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
      platform: 'estimated',
      cpuTemp: 'measured',
      gpuUsage: 'measured',
      gpuTemp: 'measured'
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
      { available: false, tempC: null, watts: null, voltageV: null },
      'absent'
    )
    expect(noCpu.power.cpuW).toBeNull()
    expect(noCpu.power.totalMeasuredW).toBeNull()
    expect(noCpu.cpu.tempC).toBeNull()
    expect(noCpu.cpu.watts).toBeNull()
    expect(noCpu.cpu.voltageV).toBeNull()
    // Sem driver, a estimativa assume a linha da CPU com rótulo próprio.
    expect(noCpu.power.cpuEstimatedW).toBe(22.1)
    expect(noCpu.power.totalEstimatedW).toBe(80.3)
    expect(noCpu.sources.cpu).toBe('estimated')
  })

  it('driver pronto sem watts derruba a fonte para estimado (degrada, não quebra)', () => {
    const merged = mergeCpuReadings(
      nativeFixture(),
      { available: true, tempC: 52, watts: null, voltageV: null },
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
      { available: false, tempC: null, watts: null, voltageV: null },
      'absent'
    )
    expect(merged.power.cpuEstimatedW).toBeNull()
    expect(merged.power.totalEstimatedW).toBeNull()
    expect(merged.sources.cpu).toBe('unavailable')
  })

  it('ACPI sobrevive sem driver e é promovida a medida quando o driver responde', () => {
    const native = nativeFixture()
    native.cpu.tempC = 45.1
    native.sources.cpuTemp = 'acpi'

    // Sem driver: a temperatura ACPI continua com a origem declarada.
    const withoutDriver = mergeCpuReadings(
      native,
      { available: false, tempC: null, watts: null, voltageV: null },
      'absent'
    )
    expect(withoutDriver.cpu.tempC).toBe(45.1)
    expect(withoutDriver.sources.cpuTemp).toBe('acpi')

    // Driver sem temperatura (leitura falhou): ACPI permanece, sem virar medida.
    const driverWithoutTemp = mergeCpuReadings(
      native,
      { available: true, tempC: null, watts: 40, voltageV: null },
      'ready'
    )
    expect(driverWithoutTemp.cpu.tempC).toBe(45.1)
    expect(driverWithoutTemp.sources.cpuTemp).toBe('acpi')

    // Driver com temperatura: vence e a origem vira `measured`.
    const measured = mergeCpuReadings(
      native,
      { available: true, tempC: 61.2, watts: 70, voltageV: null },
      'ready'
    )
    expect(measured.cpu.tempC).toBe(61.2)
    expect(measured.sources.cpuTemp).toBe('measured')
  })

  it('preserva as origens de GPU do snapshot nativo', () => {
    const native = nativeFixture()
    native.gpu.tempC = null
    native.sources.gpuTemp = 'unavailable'
    const merged = mergeCpuReadings(
      native,
      { available: false, tempC: null, watts: null, voltageV: null },
      'absent'
    )
    expect(merged.sources.gpuUsage).toBe('measured')
    expect(merged.sources.gpuTemp).toBe('unavailable')
  })
})

describe('collectHwSnapshot', () => {
  it('sem driver mantém CPU temp/potência em null, mas entrega as estimativas rotuladas', async () => {
    const snapshot = await collectHwSnapshot()
    expect(snapshot.cpu.tempC).toBeNull()
    expect(snapshot.cpu.watts).toBeNull()
    expect(snapshot.cpu.voltageV).toBeNull()
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

  it('entrega o Vcore medido quando o driver responde', async () => {
    mocks.getDriverStatus.mockResolvedValue(driverStatus('ready'))
    mocks.readCpuPower.mockResolvedValue({
      available: true,
      tempC: 55,
      watts: 62,
      voltageV: 1.28
    })
    const snapshot = await collectHwSnapshot()
    expect(snapshot.cpu.voltageV).toBe(1.28)
    expect(snapshot.cpu.tempC).toBe(55)
    expect(snapshot.cpu.watts).toBe(62)
  })
})

describe('registerHwMonitorIpc', () => {
  it('registra os canais e o stop no will-quit', () => {
    registerHwMonitorIpc(createContext())
    expect([...handlers.keys()].sort()).toEqual([
      'hwmon:driver-status',
      'hwmon:get-interval',
      'hwmon:install-driver',
      'hwmon:set-interval',
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

describe('intervalo do polling (hwmonIntervalMs)', () => {
  it('registrar aplica o intervalo lido do store (default 500 no store vazio)', () => {
    expect(getHwPollIntervalMs()).toBe(500)
    mocks.getHwmonIntervalMs.mockReturnValue(800)
    registerHwMonitorIpc(createContext())
    expect(getHwPollIntervalMs()).toBe(800)
  })

  it('resetHwMonitorForTests volta o período ao default', () => {
    registerHwMonitorIpc(createContext())
    applyHwPollIntervalMs(2000)
    expect(getHwPollIntervalMs()).toBe(2000)
    resetHwMonitorForTests()
    expect(getHwPollIntervalMs()).toBe(500)
  })

  it('hwmon:get-interval devolve o período vigente e recusa argumentos', () => {
    registerHwMonitorIpc(createContext())
    expect(getHandler('hwmon:get-interval')({})).toEqual({ intervalMs: 500 })
    expect(() => getHandler('hwmon:get-interval')({}, 'x')).toThrow('Requisição inválida.')
  })

  it('hwmon:set-interval persiste, aplica e devolve o valor normalizado', () => {
    registerHwMonitorIpc(createContext())
    const handler = getHandler('hwmon:set-interval')

    expect(handler({}, 50)).toEqual({ success: true, intervalMs: 100 })
    expect(mocks.setHwmonIntervalMs).toHaveBeenCalledWith(50)
    expect(getHwPollIntervalMs()).toBe(100)

    expect(handler({}, 9999)).toEqual({ success: true, intervalMs: 2000 })
    expect(mocks.setHwmonIntervalMs).toHaveBeenLastCalledWith(9999)
    expect(getHwPollIntervalMs()).toBe(2000)
  })

  it('hwmon:set-interval recusa tipo inválido e aridade errada sem aplicar nada', () => {
    registerHwMonitorIpc(createContext())
    const handler = getHandler('hwmon:set-interval')

    expect(() => handler({}, '500')).toThrow('Intervalo inválido para o monitor de hardware.')
    expect(() => handler({}, {})).toThrow('Intervalo inválido para o monitor de hardware.')
    expect(() => handler({})).toThrow('Requisição inválida.')
    expect(() => handler({}, 500, 600)).toThrow('Requisição inválida.')
    expect(getHwPollIntervalMs()).toBe(500)
  })

  it('applyHwPollIntervalMs normaliza o valor efetivo', () => {
    expect(applyHwPollIntervalMs(50)).toBe(100)
    expect(getHwPollIntervalMs()).toBe(100)
    expect(applyHwPollIntervalMs(9999)).toBe(2000)
    expect(getHwPollIntervalMs()).toBe(2000)
    expect(applyHwPollIntervalMs('lixo')).toBe(500)
    expect(getHwPollIntervalMs()).toBe(500)
  })

  it('com o timer ativo, aplicar reinicia o período sem leitura imediata extra', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00.000Z') })
    try {
      registerHwMonitorIpc(createContext())
      const received: HwSnapshot[] = []
      const unsubscribe = onHwSnapshot((snapshot) => received.push(snapshot))

      getHandler('hwmon:start')({})
      await vi.advanceTimersByTimeAsync(0)
      const afterStart = received.length
      expect(afterStart).toBe(1)

      // Trocar o intervalo não pode custar uma coleta extra na mesma hora.
      applyHwPollIntervalMs(100)
      await vi.advanceTimersByTimeAsync(0)
      expect(received.length).toBe(afterStart)

      // O período novo já vale: um tick de 100 ms entrega o snapshot seguinte.
      await vi.advanceTimersByTimeAsync(100)
      expect(received.length).toBe(afterStart + 1)

      unsubscribe()
      getHandler('hwmon:stop')({})
    } finally {
      resetHwMonitorForTests()
      vi.useRealTimers()
    }
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

describe('re-sonda do driver (instalação feita com o app aberto)', () => {
  it('shouldReprobe: a cada ~20 s fora de ready, nunca em ready', () => {
    const last = 1_000_000
    expect(shouldReprobe(0, last, 'absent')).toBe(true) // nunca sondado
    expect(shouldReprobe(last, last + 19_999, 'absent')).toBe(false)
    expect(shouldReprobe(last, last + 20_000, 'absent')).toBe(true)
    expect(shouldReprobe(last, last + 60_000, 'present')).toBe(true)
    expect(shouldReprobe(last, last + 60_000, 'ready')).toBe(false)
    expect(shouldReprobe(0, last, 'ready')).toBe(false)
  })

  it('hwmon:start invalida o cache e força uma nova consulta', async () => {
    registerHwMonitorIpc(createContext())
    mocks.readCpuPower.mockResolvedValue({ available: true, tempC: 50, watts: 60, voltageV: null })

    // Primeira consulta deixa o estado "conhecido" (absent).
    const status = (await getHandler('hwmon:driver-status')({})) as DriverStatusInfo
    expect(status.state).toBe('absent')
    expect(mocks.getDriverStatus).toHaveBeenCalledTimes(1)

    // Abrir a aba depois de instalar por fora: `start` não pode confiar no cache.
    mocks.getDriverStatus.mockResolvedValue(driverStatus('ready'))
    expect(getHandler('hwmon:start')({})).toEqual({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mocks.getDriverStatus).toHaveBeenCalledTimes(2)

    getHandler('hwmon:stop')({})
  })

  it('recheque pelo modal (driver-status) entrega snapshot na hora, sem esperar o tick', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00.000Z') })
    try {
      const { context, sent } = createWindowContext()
      registerHwMonitorIpc(context)

      mocks.getDriverStatus.mockResolvedValue(driverStatus('absent'))
      getHandler('hwmon:start')({})
      await vi.advanceTimersByTimeAsync(0)
      const sentBefore = sent.length

      // O modal instala e reconsulta o status com a aba já aberta; naquele
      // instante não há tick coletando, então o snapshot sai na hora.
      mocks.getDriverStatus.mockResolvedValue(driverStatus('ready'))
      mocks.readCpuPower.mockResolvedValue({
        available: true,
        tempC: 55,
        watts: 62,
        voltageV: 1.25
      })
      const status = (await getHandler('hwmon:driver-status')({})) as DriverStatusInfo
      expect(status.state).toBe('ready')
      await vi.advanceTimersByTimeAsync(0)

      expect(sent.length).toBe(sentBefore + 1)
      expect(sent.at(-1)?.sources.driver).toBe('ready')
      expect(sent.at(-1)?.cpu.watts).toBe(62)

      getHandler('hwmon:stop')({})
    } finally {
      resetHwMonitorForTests()
      vi.useRealTimers()
    }
  })

  it('detecta absent -> ready sem reiniciar e entrega o snapshot na hora', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-17T12:00:00.000Z') })
    try {
      const { context, sent } = createWindowContext()
      registerHwMonitorIpc(context)
      const received: HwSnapshot[] = []
      const unsubscribe = onHwSnapshot((snapshot) => received.push(snapshot))

      mocks.getDriverStatus.mockResolvedValue(driverStatus('absent'))
      getHandler('hwmon:start')({})
      await vi.advanceTimersByTimeAsync(0)
      expect(received.at(-1)?.sources.driver).toBe('absent')
      const probesAfterStart = mocks.getDriverStatus.mock.calls.length
      expect(probesAfterStart).toBe(1)

      // O usuário instala o PawnIO por fora, com a aba Monitor já aberta.
      mocks.getDriverStatus.mockResolvedValue(driverStatus('ready'))
      mocks.readCpuPower.mockResolvedValue({
        available: true,
        tempC: 55,
        watts: 62,
        voltageV: 1.25
      })

      // 19 ticks de 1 Hz: nenhum deles custa uma sonda — o relógio é de 20 s.
      await vi.advanceTimersByTimeAsync(19_000)
      expect(mocks.getDriverStatus).toHaveBeenCalledTimes(probesAfterStart)
      expect(received.at(-1)?.sources.driver).toBe('absent')

      // Passados 20 s: uma sonda, e o snapshot seguinte já sai `ready`.
      await vi.advanceTimersByTimeAsync(1_500)
      expect(mocks.getDriverStatus).toHaveBeenCalledTimes(probesAfterStart + 1)
      expect(received.at(-1)?.sources.driver).toBe('ready')
      expect(received.at(-1)?.cpu.watts).toBe(62)
      expect(sent.at(-1)?.sources.driver).toBe('ready')
      expect(sent.at(-1)?.cpu.watts).toBe(62)

      // Já pronto: mais 5 s de polling não re-sondam nem repetem o log.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(mocks.getDriverStatus).toHaveBeenCalledTimes(probesAfterStart + 1)
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith('hwmon', 'driver: absent')
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith('hwmon', 'driver: absent -> ready')
      expect(vi.mocked(logger.info)).toHaveBeenCalledTimes(2)

      unsubscribe()
      getHandler('hwmon:stop')({})
    } finally {
      resetHwMonitorForTests()
      vi.useRealTimers()
    }
  })
})
