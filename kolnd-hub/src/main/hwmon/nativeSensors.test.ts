import { beforeEach, describe, expect, it, vi } from 'vitest'

// O logger real toca em disco e importa `electron` — nos testes ele é silenciado.
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  buildNativeSnapshot,
  computeCpuUsage,
  parseCimJson,
  parseNvidiaSmi,
  resetNativeSensorsForTests,
  snapshotNative,
  type CimCpuFacts,
  type CimRamModule,
  type CommandRunner,
  type CpuTimesLike,
  type NvidiaSmiSample,
  type StaticFacts
} from './nativeSensors'

const NVIDIA_LINE =
  'NVIDIA GeForce RTX 5060 Ti, 621.24, 2, 2655, 14001, 1427, 8151, 41.35, 0, 28.16, 180.00'

const CIM_JSON = JSON.stringify({
  ram: [
    {
      Capacity: 8589934592,
      ConfiguredClockSpeed: 3200,
      ConfiguredVoltage: 1200,
      SMBIOSMemoryType: 26
    },
    {
      Capacity: 8589934592,
      ConfiguredClockSpeed: 3200,
      ConfiguredVoltage: 1200,
      SMBIOSMemoryType: 26
    },
    {
      Capacity: 8589934592,
      ConfiguredClockSpeed: 3200,
      ConfiguredVoltage: 1200,
      SMBIOSMemoryType: 26
    }
  ],
  cpu: {
    Name: 'AMD Ryzen 7 5700X 8-Core Processor             ',
    NumberOfCores: 8,
    NumberOfLogicalProcessors: 16,
    MaxClockSpeed: 3401
  },
  board: {
    Manufacturer: 'Micro-Star International Co., Ltd.',
    Product: 'B550M PRO-VDH WIFI (MS-7C95)'
  },
  gpuMemory: [
    { Name: 'luid_0x00000000_0x00012CBC_phys_0', SharedUsage: 8192 },
    { Name: 'luid_0x00000000_0x0000F964_phys_0', SharedUsage: 122621952 }
  ],
  processor: { PercentProcessorPerformance: 123 }
})

const CPU_FACTS: CimCpuFacts = {
  name: 'AMD Ryzen 7 5700X 8-Core Processor',
  cores: 8,
  threads: 16,
  baseClockMhz: 3401
}

const RAM_MODULES: CimRamModule[] = [
  {
    capacityBytes: 8589934592,
    configuredClockMhz: 3200,
    configuredVoltageMv: 1200,
    memoryType: 26
  },
  {
    capacityBytes: 8589934592,
    configuredClockMhz: 3200,
    configuredVoltageMv: 1200,
    memoryType: 26
  },
  { capacityBytes: 8589934592, configuredClockMhz: 3200, configuredVoltageMv: 1200, memoryType: 26 }
]

const STATIC_FACTS: StaticFacts = {
  cpu: CPU_FACTS,
  ramModules: RAM_MODULES,
  board: { manufacturer: 'Micro-Star International Co., Ltd.', product: 'B550M PRO-VDH WIFI' }
}

const NVIDIA_SAMPLE: NvidiaSmiSample = {
  name: 'NVIDIA GeForce RTX 5060 Ti',
  driverVersion: '621.24',
  usagePercent: 2,
  coreClockMhz: 2655,
  memClockMhz: 14001,
  vramUsedMb: 1427,
  vramTotalMb: 8151,
  tempC: 41.35,
  fanPercent: 0,
  watts: 28.16,
  powerLimitW: 180
}

function cpuTimes(entries: Array<{ idle: number; user: number }>): CpuTimesLike[] {
  return entries.map((entry) => ({
    times: { user: entry.user, nice: 0, sys: 0, idle: entry.idle, irq: 0 }
  }))
}

describe('parseNvidiaSmi', () => {
  it('lê a linha real desta máquina (11 campos, sem unidades)', () => {
    expect(parseNvidiaSmi(NVIDIA_LINE)).toEqual({
      name: 'NVIDIA GeForce RTX 5060 Ti',
      driverVersion: '621.24',
      usagePercent: 2,
      coreClockMhz: 2655,
      memClockMhz: 14001,
      vramUsedMb: 1427,
      vramTotalMb: 8151,
      tempC: 41.35,
      fanPercent: 0,
      watts: 28.16,
      powerLimitW: 180
    })
  })

  it('converte [N/A] em null sem derrubar os demais campos', () => {
    const line =
      'NVIDIA GeForce RTX 3060, 555.99, [N/A], 1800, [N/A], [N/A], 12288, [N/A], [N/A], [N/A], [N/A]'
    const sample = parseNvidiaSmi(line)
    expect(sample).not.toBeNull()
    expect(sample?.name).toBe('NVIDIA GeForce RTX 3060')
    expect(sample?.driverVersion).toBe('555.99')
    expect(sample?.usagePercent).toBeNull()
    expect(sample?.coreClockMhz).toBe(1800)
    expect(sample?.memClockMhz).toBeNull()
    expect(sample?.vramUsedMb).toBeNull()
    expect(sample?.vramTotalMb).toBe(12288)
    expect(sample?.tempC).toBeNull()
    expect(sample?.fanPercent).toBeNull()
    expect(sample?.watts).toBeNull()
    expect(sample?.powerLimitW).toBeNull()
  })

  it('tolera vírgula no nome do modelo (junta os campos extras)', () => {
    const line = 'NVIDIA A100, PCIe, 570.00, 0, 1200, 1200, 0, 40960, 30, 30, 60, 250'
    const sample = parseNvidiaSmi(line)
    expect(sample?.name).toBe('NVIDIA A100, PCIe')
    expect(sample?.driverVersion).toBe('570.00')
    expect(sample?.vramTotalMb).toBe(40960)
    expect(sample?.powerLimitW).toBe(250)
  })

  it('ignora linhas vazias antes da amostra', () => {
    expect(parseNvidiaSmi(`\r\n  \r\n${NVIDIA_LINE}\r\n`)?.name).toBe('NVIDIA GeForce RTX 5060 Ti')
  })

  it('devolve null para saída vazia, curta ou sem nome', () => {
    expect(parseNvidiaSmi('')).toBeNull()
    expect(parseNvidiaSmi(null)).toBeNull()
    expect(parseNvidiaSmi('NVIDIA, 621.24, 2')).toBeNull()
    expect(parseNvidiaSmi(', 621.24, 2, 1, 1, 1, 1, 1, 1, 1, 1')).toBeNull()
  })
})

describe('parseCimJson', () => {
  it('lê o JSON real (módulos, CPU, placa, shared, performance)', () => {
    const facts = parseCimJson(CIM_JSON)
    expect(facts).not.toBeNull()
    expect(facts?.ramModules).toHaveLength(3)
    expect(facts?.ramModules[0]).toEqual({
      capacityBytes: 8589934592,
      configuredClockMhz: 3200,
      configuredVoltageMv: 1200,
      memoryType: 26
    })
    expect(facts?.cpu.name).toBe('AMD Ryzen 7 5700X 8-Core Processor')
    expect(facts?.cpu.cores).toBe(8)
    expect(facts?.cpu.threads).toBe(16)
    expect(facts?.cpu.baseClockMhz).toBe(3401)
    expect(facts?.board.product).toBe('B550M PRO-VDH WIFI (MS-7C95)')
    // O adaptador básico (8192) é ignorado — o maior SharedUsage é o da GPU real.
    expect(facts?.gpuSharedBytes).toBe(122621952)
    expect(facts?.processorPerformancePercent).toBe(123)
  })

  it('aceita objeto único onde o ConvertTo-Json não gerou array', () => {
    const single = JSON.stringify({
      ram: { Capacity: '8589934592', ConfiguredClockSpeed: '3200', ConfiguredVoltage: '1200' },
      cpu: { Name: 'CPU X', NumberOfCores: '4', MaxClockSpeed: '2000' },
      board: { Product: 'Placa Y' },
      gpuMemory: { SharedUsage: 8192 },
      processor: { PercentProcessorPerformance: '99' }
    })
    const facts = parseCimJson(single)
    expect(facts?.ramModules).toHaveLength(1)
    expect(facts?.ramModules[0].capacityBytes).toBe(8589934592)
    expect(facts?.cpu.cores).toBe(4)
    expect(facts?.board.manufacturer).toBeNull()
    expect(facts?.gpuSharedBytes).toBe(8192)
    expect(facts?.processorPerformancePercent).toBe(99)
  })

  it('tolera BOM e lixo antes/depois do JSON', () => {
    const wrapped = `\uFEFFaviso qualquer\r\n${CIM_JSON}\r\nfim`
    expect(parseCimJson(wrapped)?.cpu.name).toBe('AMD Ryzen 7 5700X 8-Core Processor')
  })

  it('devolve null para blob inválido ou vazio', () => {
    expect(parseCimJson('')).toBeNull()
    expect(parseCimJson(undefined)).toBeNull()
    expect(parseCimJson('sem json aqui')).toBeNull()
    expect(parseCimJson('{quebrado')).toBeNull()
    expect(parseCimJson('[1,2,3]')).toBeNull()
  })

  it('não inventa valores quando o CIM vem sem as classes', () => {
    const facts = parseCimJson('{}')
    expect(facts).not.toBeNull()
    expect(facts?.ramModules).toEqual([])
    expect(facts?.cpu).toEqual({ name: null, cores: null, threads: null, baseClockMhz: null })
    expect(facts?.board).toEqual({ manufacturer: null, product: null })
    expect(facts?.gpuSharedBytes).toBeNull()
    expect(facts?.processorPerformancePercent).toBeNull()
  })
})

describe('computeCpuUsage', () => {
  it('calcula a fração ocupada entre duas amostras', () => {
    const previous = cpuTimes([
      { idle: 100, user: 100 },
      { idle: 200, user: 200 }
    ])
    const next = cpuTimes([
      { idle: 150, user: 150 },
      { idle: 300, user: 300 }
    ])
    expect(computeCpuUsage(previous, next)).toBe(50)
  })

  it('devolve 100 quando todo o delta é trabalho', () => {
    const previous = cpuTimes([{ idle: 0, user: 0 }])
    const next = cpuTimes([{ idle: 0, user: 100 }])
    expect(computeCpuUsage(previous, next)).toBe(100)
  })

  it('devolve null sem amostra anterior ou sem delta positivo', () => {
    const sample = cpuTimes([{ idle: 10, user: 10 }])
    expect(computeCpuUsage(null, sample)).toBeNull()
    expect(computeCpuUsage(sample, sample)).toBeNull()
    expect(computeCpuUsage([], [])).toBeNull()
    expect(
      computeCpuUsage(cpuTimes([{ idle: 100, user: 100 }]), cpuTimes([{ idle: 50, user: 50 }]))
    ).toBeNull()
  })
})

describe('buildNativeSnapshot', () => {
  it('agrega CPU/RAM/GPU/specs com as fontes medidas', () => {
    const snapshot = buildNativeSnapshot({
      capturedAt: Date.UTC(2026, 10, 17, 12, 0, 0),
      cpuUsagePercent: 25.44,
      nvidia: NVIDIA_SAMPLE,
      staticFacts: STATIC_FACTS,
      gpuSharedBytes: 122621952,
      processorPerformancePercent: 116,
      totalmemBytes: 24 * 1024 ** 3,
      freememBytes: 12 * 1024 ** 3,
      driver: 'absent'
    })

    expect(snapshot.capturedAt).toBe('2026-11-17T12:00:00.000Z')
    expect(snapshot.cpu.model).toBe('AMD Ryzen 7 5700X 8-Core Processor')
    expect(snapshot.cpu.usagePercent).toBe(25.4)
    // 3401 × 116% ≈ 3945 MHz (clock efetivo medido pelo contador do SO).
    expect(snapshot.cpu.clockMhz).toBe(3945)
    expect(snapshot.cpu.tempC).toBeNull()
    expect(snapshot.cpu.watts).toBeNull()

    expect(snapshot.ram).toEqual({
      installedGb: 24,
      speedMhz: 3200,
      voltageV: 1.2,
      usedGb: 12,
      usedPercent: 50
    })

    expect(snapshot.gpu.model).toBe('NVIDIA GeForce RTX 5060 Ti')
    expect(snapshot.gpu.tempC).toBe(41.35)
    expect(snapshot.gpu.fanPercent).toBe(0)
    expect(snapshot.gpu.watts).toBe(28.16)
    expect(snapshot.gpu.powerLimitW).toBe(180)
    // 122621952 bytes ≈ 116.9 MiB.
    expect(snapshot.gpu.sharedMb).toBe(116.9)

    expect(snapshot.power).toEqual({
      cpuW: null,
      gpuW: 28.16,
      totalMeasuredW: null,
      // 8 núcleos a 25,44%: 71 × (0,25 + 0,75 × 0,2544^1,2) ≈ 28,1 W.
      cpuEstimatedW: 28.1,
      platformEstimatedW: 30,
      totalEstimatedW: 86.3
    })
    expect(snapshot.sources).toEqual({
      driver: 'absent',
      cpu: 'estimated',
      gpu: 'measured',
      platform: 'estimated'
    })
    expect(snapshot.specs.cpu).toBe(
      'AMD Ryzen 7 5700X 8-Core Processor · 8 núcleos / 16 threads · base 3401 MHz'
    )
    expect(snapshot.specs.gpu).toBe('NVIDIA GeForce RTX 5060 Ti · 8151 MiB de VRAM · driver 621.24')
    expect(snapshot.specs.ram).toBe('24 GB · DDR4-3200 · 3 módulos')
    expect(snapshot.specs.board).toBe('Micro-Star International Co., Ltd. B550M PRO-VDH WIFI')
  })

  it('degrada GPU ausente sem afetar CPU/RAM', () => {
    const snapshot = buildNativeSnapshot({
      cpuUsagePercent: null,
      nvidia: null,
      staticFacts: STATIC_FACTS,
      gpuSharedBytes: null,
      processorPerformancePercent: null,
      totalmemBytes: 24 * 1024 ** 3,
      freememBytes: 24 * 1024 ** 3
    })

    expect(snapshot.gpu).toEqual({
      model: null,
      usagePercent: null,
      coreClockMhz: null,
      memClockMhz: null,
      vramUsedMb: null,
      vramTotalMb: null,
      sharedMb: null,
      tempC: null,
      fanPercent: null,
      watts: null,
      powerLimitW: null
    })
    expect(snapshot.specs.gpu).toBeNull()
    expect(snapshot.cpu.model).toBe('AMD Ryzen 7 5700X 8-Core Processor')
    expect(snapshot.cpu.clockMhz).toBe(3401) // sem contador, cai no clock base
    expect(snapshot.power.gpuW).toBeNull()
    // Sem uso de CPU não há estimativa; sem GPU medida não há total (nunca
    // somamos um buraco).
    expect(snapshot.power.cpuEstimatedW).toBeNull()
    expect(snapshot.power.platformEstimatedW).toBe(30)
    expect(snapshot.power.totalEstimatedW).toBeNull()
    expect(snapshot.sources.gpu).toBe('unavailable')
    expect(snapshot.ram.usedPercent).toBe(0)
  })

  it('com uso e núcleos estima a CPU mesmo sem GPU, mas não inventa total', () => {
    const snapshot = buildNativeSnapshot({
      cpuUsagePercent: 0,
      nvidia: null,
      staticFacts: STATIC_FACTS,
      totalmemBytes: 24 * 1024 ** 3,
      freememBytes: 24 * 1024 ** 3
    })
    expect(snapshot.power.cpuEstimatedW).toBe(17.8)
    expect(snapshot.power.platformEstimatedW).toBe(30)
    expect(snapshot.power.totalEstimatedW).toBeNull()
    expect(snapshot.sources.cpu).toBe('estimated')
    expect(snapshot.sources.gpu).toBe('unavailable')
    expect(snapshot.sources.platform).toBe('estimated')
  })

  it('sem CIM nenhum, campos ficam null (nunca NaN/undefined)', () => {
    const snapshot = buildNativeSnapshot({
      staticFacts: null,
      totalmemBytes: 8 * 1024 ** 3,
      freememBytes: 2 * 1024 ** 3
    })
    expect(snapshot.cpu).toEqual({
      model: null,
      usagePercent: null,
      clockMhz: null,
      tempC: null,
      watts: null
    })
    expect(snapshot.ram.installedGb).toBeNull()
    expect(snapshot.ram.speedMhz).toBeNull()
    expect(snapshot.ram.voltageV).toBeNull()
    expect(snapshot.ram.usedGb).toBe(6)
    expect(snapshot.ram.usedPercent).toBe(75)
    // Sem CIM não há núcleos nem GPU: nada estimado vira número.
    expect(snapshot.power.cpuEstimatedW).toBeNull()
    expect(snapshot.power.platformEstimatedW).toBe(30)
    expect(snapshot.power.totalEstimatedW).toBeNull()
    expect(snapshot.sources.cpu).toBe('unavailable')
    expect(snapshot.specs).toEqual({ cpu: null, gpu: null, ram: null, board: null })
  })
})

function scriptOf(args: string[]): string {
  return args[args.length - 1] ?? ''
}

function isNvidiaQuery(args: string[]): boolean {
  return args.some((arg) => arg.startsWith('--query-gpu='))
}

function isStaticCim(args: string[]): boolean {
  return scriptOf(args).includes('Win32_PhysicalMemory')
}

function isDynamicCim(args: string[]): boolean {
  return scriptOf(args).includes('GPUAdapterMemory')
}

describe('snapshotNative — CIM estática x dinâmica', () => {
  beforeEach(() => {
    resetNativeSensorsForTests()
  })

  it('executa a estática uma vez por sessão e a dinâmica a cada tick', async () => {
    const runner = vi.fn<CommandRunner>(async (_file, args) => {
      if (isNvidiaQuery(args)) return NVIDIA_LINE
      if (isStaticCim(args) || isDynamicCim(args)) return CIM_JSON
      return null
    })

    const first = await snapshotNative(runner)
    const second = await snapshotNative(runner)

    const calls = runner.mock.calls
    expect(calls.filter(([, args]) => isStaticCim(args))).toHaveLength(1)
    expect(calls.filter(([, args]) => isDynamicCim(args))).toHaveLength(2)
    expect(calls.filter(([, args]) => isNvidiaQuery(args))).toHaveLength(2)

    for (const snapshot of [first, second]) {
      expect(snapshot.cpu.model).toBe('AMD Ryzen 7 5700X 8-Core Processor')
      expect(snapshot.ram.installedGb).toBe(24)
      expect(snapshot.gpu.sharedMb).toBe(116.9)
      // 3401 MHz × 123% (fixture CIM_JSON) ≈ 4183 MHz.
      expect(snapshot.cpu.clockMhz).toBe(4183)
      expect(snapshot.specs.ram).toBe('24 GB · DDR4-3200 · 3 módulos')
    }
  })

  it('repete a estática somente se a primeira tentativa falhar', async () => {
    let staticAttempts = 0
    const runner = vi.fn<CommandRunner>(async (_file, args) => {
      if (isNvidiaQuery(args)) return NVIDIA_LINE
      if (isStaticCim(args)) {
        staticAttempts += 1
        return staticAttempts === 1 ? null : CIM_JSON
      }
      if (isDynamicCim(args)) return CIM_JSON
      return null
    })

    const first = await snapshotNative(runner)
    const second = await snapshotNative(runner)
    const third = await snapshotNative(runner)

    // A dinâmica funciona desde o primeiro tick; a estática entra no segundo.
    expect(first.cpu.model).toBeNull()
    expect(first.gpu.sharedMb).toBe(116.9)
    expect(second.cpu.model).toBe('AMD Ryzen 7 5700X 8-Core Processor')
    expect(third.cpu.model).toBe('AMD Ryzen 7 5700X 8-Core Processor')
    expect(staticAttempts).toBe(2)
  })
})
