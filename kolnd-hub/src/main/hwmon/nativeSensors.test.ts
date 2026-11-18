import { beforeEach, describe, expect, it, vi } from 'vitest'

// O logger real toca em disco e importa `electron` — nos testes ele é silenciado.
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
// O NVML roda PowerShell de verdade; aqui só interessa o que chega ao snapshot.
vi.mock('./nvml', () => ({ readNvmlFan: vi.fn(async () => null) }))

import {
  acpiTenthsKelvinToCelsius,
  buildCimDynamicScript,
  buildNativeSnapshot,
  computeCpuUsage,
  parseCimJson,
  parseNvidiaSmi,
  resetNativeSensorsForTests,
  selectCpuTempFromAcpi,
  snapshotNative,
  type CimCpuFacts,
  type CimRamModule,
  type CommandRunner,
  type CpuTimesLike,
  type NvidiaSmiSample,
  type StaticFacts
} from './nativeSensors'
import type { GpuAdapterInfo } from './gpuInfo'
import { readNvmlFan } from './nvml'

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
  gpuUsagePercent: 2,
  gpuDedicatedBytes: 1294065664,
  gpuSharedBytes: 122621952,
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

const PCI_RTX = 'PCI\\VEN_10DE&DEV_2D04&SUBSYS_53621462&REV_A1\\71F57159262DB04800'

/** Adaptadores como o CIM estático entrega (Parsec + RTX reais desta máquina). */
const GPU_ADAPTERS: GpuAdapterInfo[] = [
  {
    name: 'Parsec Virtual Display Adapter',
    vendor: 'other',
    pnpDeviceId: 'ROOT\\DISPLAY\\0000',
    driverVersion: '0.45.0.0',
    driverDate: '2024-01-25',
    vramTotalMb: null,
    isVirtual: true
  },
  {
    name: 'NVIDIA GeForce RTX 5060 Ti',
    vendor: 'nvidia',
    pnpDeviceId: PCI_RTX,
    driverVersion: '32.0.16.2124',
    driverDate: '2026-11-07',
    vramTotalMb: 8151,
    isVirtual: false
  }
]

const STATIC_FACTS: StaticFacts = {
  cpu: CPU_FACTS,
  ramModules: RAM_MODULES,
  board: { manufacturer: 'Micro-Star International Co., Ltd.', product: 'B550M PRO-VDH WIFI' },
  gpuAdapters: GPU_ADAPTERS,
  // Este desktop não expõe zona ACPI (a consulta falha na máquina real).
  cpuTempAcpiC: null
}

const STATIC_FACTS_NO_GPU: StaticFacts = { ...STATIC_FACTS, gpuAdapters: [] }

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

// Cada teste decide se a máquina tem NVML; o padrão é "sem leitura".
beforeEach(() => {
  vi.mocked(readNvmlFan).mockReset()
  vi.mocked(readNvmlFan).mockResolvedValue(null)
})

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
    // Totais agregados no PowerShell: uso do motor 3D + memória do adaptador
    // primário (o Parsec virtual, com 8 KiB, não entra).
    expect(facts?.gpuUsagePercent).toBe(2)
    expect(facts?.gpuDedicatedBytes).toBe(1294065664)
    expect(facts?.gpuSharedBytes).toBe(122621952)
    expect(facts?.processorPerformancePercent).toBe(123)
  })

  it('aceita objeto único onde o ConvertTo-Json não gerou array', () => {
    const single = JSON.stringify({
      ram: { Capacity: '8589934592', ConfiguredClockSpeed: '3200', ConfiguredVoltage: '1200' },
      cpu: { Name: 'CPU X', NumberOfCores: '4', MaxClockSpeed: '2000' },
      board: { Product: 'Placa Y' },
      gpuUsagePercent: '98',
      gpuDedicatedBytes: '1073741824',
      gpuSharedBytes: 8192,
      processor: { PercentProcessorPerformance: '99' }
    })
    const facts = parseCimJson(single)
    expect(facts?.ramModules).toHaveLength(1)
    expect(facts?.ramModules[0].capacityBytes).toBe(8589934592)
    expect(facts?.cpu.cores).toBe(4)
    expect(facts?.board.manufacturer).toBeNull()
    expect(facts?.gpuUsagePercent).toBe(98)
    expect(facts?.gpuDedicatedBytes).toBe(1073741824)
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
    expect(facts?.gpuUsagePercent).toBeNull()
    expect(facts?.gpuDedicatedBytes).toBeNull()
    expect(facts?.gpuSharedBytes).toBeNull()
    expect(facts?.processorPerformancePercent).toBeNull()
    expect(facts?.cpuTempAcpiC).toBeNull()
  })
})

describe('parseCimJson — agregação de GPU (CIM)', () => {
  // Valores reais do script dinâmico (GPU em repouso nesta máquina): adaptador
  // NVIDIA com 1.294.065.664 B dedicados e 68.964.352 B compartilhados.
  const REAL_DYNAMIC = JSON.stringify({
    gpuUsagePercent: 2,
    gpuDedicatedBytes: 1294065664,
    gpuSharedBytes: 68964352,
    processor: { PercentProcessorPerformance: 116 }
  })

  it('lê os totais do adaptador primário sem tocar nas linhas por processo', () => {
    const facts = parseCimJson(REAL_DYNAMIC)
    expect(facts?.gpuUsagePercent).toBe(2)
    expect(facts?.gpuDedicatedBytes).toBe(1294065664)
    expect(facts?.gpuSharedBytes).toBe(68964352)
  })

  it('0% é leitura válida (GPU ociosa) e uso acima de 100 é clampado', () => {
    expect(
      parseCimJson('{"gpuUsagePercent":0,"gpuDedicatedBytes":0,"gpuSharedBytes":0}')
    ).toMatchObject({ gpuUsagePercent: 0, gpuDedicatedBytes: 0, gpuSharedBytes: 0 })
    expect(parseCimJson('{"gpuUsagePercent":180}')?.gpuUsagePercent).toBe(100)
  })

  it('valor negativo ou texto inválido vira null (nunca número inventado)', () => {
    const facts = parseCimJson(
      '{"gpuUsagePercent":-1,"gpuDedicatedBytes":"-5","gpuSharedBytes":"x"}'
    )
    expect(facts?.gpuUsagePercent).toBeNull()
    expect(facts?.gpuDedicatedBytes).toBeNull()
    expect(facts?.gpuSharedBytes).toBeNull()
  })
})

describe('temperatura da CPU por ACPI', () => {
  it('converte décimos de Kelvin em °C', () => {
    expect(acpiTenthsKelvinToCelsius(3132)).toBe(40.1)
    expect(acpiTenthsKelvinToCelsius(3232)).toBe(50.1)
    expect(acpiTenthsKelvinToCelsius(0)).toBeNull()
    expect(acpiTenthsKelvinToCelsius(-1)).toBeNull()
    expect(acpiTenthsKelvinToCelsius('abc')).toBeNull()
  })

  it('escolhe deterministicamente a maior zona válida entre as duas classes', () => {
    // Zonas típicas de uma placa: CPU mais quente que placa/ambiente.
    const zones = [
      { InstanceName: 'ACPI\\ThermalZone\\TZ00', CurrentTemperature: 3182 },
      { InstanceName: 'ACPI\\ThermalZone\\TZ01', CurrentTemperature: 3282 }
    ]
    expect(selectCpuTempFromAcpi(zones, [])).toBe(55.1)
    expect(selectCpuTempFromAcpi([], [{ Name: '_Total', HighPrecisionTemperature: 3232 }])).toBe(
      50.1
    )
    // As duas fontes juntas: a maior continua vencendo, sem depender da ordem.
    expect(
      selectCpuTempFromAcpi([zones[0]], [{ Name: '_Total', HighPrecisionTemperature: 3232 }])
    ).toBe(50.1)
    expect(selectCpuTempFromAcpi([...zones].reverse(), [])).toBe(55.1)
  })

  it('usa Temperature quando HighPrecisionTemperature não vem', () => {
    expect(selectCpuTempFromAcpi([], [{ Name: '_Total', Temperature: 3182 }])).toBe(45.1)
  })

  it('descarta leituras fora de 15–110 °C', () => {
    expect(acpiTenthsKelvinToCelsius(1000)).toBe(-173.1)
    expect(selectCpuTempFromAcpi([{ CurrentTemperature: 1000 }], [])).toBeNull()
    expect(selectCpuTempFromAcpi([{ CurrentTemperature: 4000 }], [])).toBeNull()
    expect(
      selectCpuTempFromAcpi([], [{ Name: '_Total', HighPrecisionTemperature: 4000 }])
    ).toBeNull()
  })

  it('ausência total → null sem erro (caso real deste desktop)', () => {
    expect(selectCpuTempFromAcpi([], [])).toBeNull()
    expect(selectCpuTempFromAcpi(undefined, undefined)).toBeNull()
    expect(parseCimJson('{}')?.cpuTempAcpiC).toBeNull()
    expect(parseCimJson('{"acpi":[],"thermal":[]}')?.cpuTempAcpiC).toBeNull()
  })

  it('parseCimJson entrega a temperatura ACPI da consulta estática', () => {
    const facts = parseCimJson(
      JSON.stringify({
        acpi: [{ InstanceName: 'ACPI\\ThermalZone\\TZ00', CurrentTemperature: 3182 }],
        thermal: [{ Name: '_Total', HighPrecisionTemperature: 3282 }]
      })
    )
    expect(facts?.cpuTempAcpiC).toBe(55.1)
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
      gpuFanRpm: 1418,
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
    expect(snapshot.gpu.vendor).toBe('nvidia')
    // O `nvidia-smi` vence o CIM para uso e versão de driver.
    expect(snapshot.gpu.driverVersion).toBe('621.24')
    expect(snapshot.gpu.driverDate).toBe('2026-11-07')
    expect(snapshot.gpu.tempC).toBe(41.35)
    expect(snapshot.gpu.fanPercent).toBe(0)
    // RPM vem da NVML (o nvidia-smi só publica percentual).
    expect(snapshot.gpu.fanRpm).toBe(1418)
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
      platform: 'estimated',
      cpuTemp: 'unavailable',
      gpuUsage: 'measured',
      gpuTemp: 'measured'
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
      staticFacts: STATIC_FACTS_NO_GPU,
      gpuSharedBytes: null,
      processorPerformancePercent: null,
      totalmemBytes: 24 * 1024 ** 3,
      freememBytes: 24 * 1024 ** 3
    })

    expect(snapshot.gpu).toEqual({
      model: null,
      vendor: null,
      driverVersion: null,
      driverDate: null,
      usagePercent: null,
      coreClockMhz: null,
      memClockMhz: null,
      vramUsedMb: null,
      vramTotalMb: null,
      sharedMb: null,
      tempC: null,
      fanPercent: null,
      fanRpm: null,
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
      staticFacts: STATIC_FACTS_NO_GPU,
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

  it('GPU AMD/Intel sem nvidia-smi: modelo, VRAM e driver vêm do CIM', () => {
    const amdFacts: StaticFacts = {
      ...STATIC_FACTS_NO_GPU,
      gpuAdapters: [
        {
          name: 'AMD Radeon RX 7800 XT',
          vendor: 'amd',
          pnpDeviceId: 'PCI\\VEN_1002&DEV_747E',
          driverVersion: '31.0.24033.1003',
          driverDate: '2024-03-13',
          vramTotalMb: 16384,
          isVirtual: false
        }
      ]
    }
    const snapshot = buildNativeSnapshot({
      cpuUsagePercent: 10,
      nvidia: null,
      staticFacts: amdFacts,
      gpuUsagePercent: 37,
      gpuDedicatedBytes: 2 * 1024 ** 3,
      gpuSharedBytes: 64 * 1024 ** 2,
      processorPerformancePercent: 100,
      totalmemBytes: 24 * 1024 ** 3,
      freememBytes: 12 * 1024 ** 3
    })

    expect(snapshot.gpu.model).toBe('AMD Radeon RX 7800 XT')
    expect(snapshot.gpu.vendor).toBe('amd')
    expect(snapshot.gpu.driverVersion).toBe('31.0.24033.1003')
    expect(snapshot.gpu.driverDate).toBe('2024-03-13')
    expect(snapshot.gpu.usagePercent).toBe(37)
    expect(snapshot.gpu.vramTotalMb).toBe(16384)
    expect(snapshot.gpu.vramUsedMb).toBe(2048)
    expect(snapshot.gpu.sharedMb).toBe(64)
    // Sem temperatura/fan/potência: o contador não entrega isso.
    expect(snapshot.gpu.tempC).toBeNull()
    expect(snapshot.gpu.watts).toBeNull()
    expect(snapshot.specs.gpu).toBe(
      'AMD Radeon RX 7800 XT · 16384 MiB de VRAM · driver 31.0.24033.1003'
    )
    expect(snapshot.sources.gpuUsage).toBe('measured')
    expect(snapshot.sources.gpuTemp).toBe('unavailable')
    // A GPU não foi medida em watts: o total estimado continua null.
    expect(snapshot.power.gpuW).toBeNull()
    expect(snapshot.power.totalEstimatedW).toBeNull()
  })

  it('temperatura ACPI da CPU aparece com a origem declarada', () => {
    const acpiFacts: StaticFacts = { ...STATIC_FACTS, cpuTempAcpiC: 45.1 }
    const snapshot = buildNativeSnapshot({
      cpuUsagePercent: 5,
      nvidia: null,
      staticFacts: acpiFacts,
      totalmemBytes: 24 * 1024 ** 3,
      freememBytes: 12 * 1024 ** 3
    })
    expect(snapshot.cpu.tempC).toBe(45.1)
    expect(snapshot.sources.cpuTemp).toBe('acpi')
    // ACPI é aproximada e NÃO vira energia medida.
    expect(snapshot.cpu.watts).toBeNull()
    expect(snapshot.sources.cpu).toBe('estimated')
  })

  it('adaptador sem uso medido não inventa barra de GPU', () => {
    const snapshot = buildNativeSnapshot({
      nvidia: null,
      staticFacts: STATIC_FACTS,
      gpuUsagePercent: null,
      totalmemBytes: 24 * 1024 ** 3,
      freememBytes: 12 * 1024 ** 3
    })
    expect(snapshot.gpu.model).toBe('NVIDIA GeForce RTX 5060 Ti')
    expect(snapshot.gpu.usagePercent).toBeNull()
    expect(snapshot.sources.gpuUsage).toBe('unavailable')
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
      watts: null,
      voltageV: null
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

describe('buildCimDynamicScript', () => {
  it('só inclui a consulta do motor 3D quando o nvidia-smi não responde', () => {
    // O caminho NVIDIA não deve pagar os ~300 ms do GPUEngine por tick.
    expect(buildCimDynamicScript(true)).toContain('GPUPerformanceCounters_GPUEngine')
    expect(buildCimDynamicScript(false)).not.toContain('GPUEngine')
    // Mesmo sem o uso, a memória dedicada/compartilhada continua vindo do CIM.
    expect(buildCimDynamicScript(false)).toContain('GPUAdapterMemory')
    expect(buildCimDynamicScript(false)).toContain('gpuSharedBytes')
  })
})

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

  it('não consulta o GPUEngine quando o nvidia-smi respondeu', async () => {
    const runner = vi.fn<CommandRunner>(async (_file, args) => {
      if (isNvidiaQuery(args)) return NVIDIA_LINE
      if (isDynamicCim(args)) return CIM_JSON
      return null
    })
    await snapshotNative(runner)
    const dynamic = runner.mock.calls.find(([, args]) => isDynamicCim(args))
    expect(dynamic).toBeDefined()
    expect(scriptOf(dynamic![1])).not.toContain('GPUEngine')
  })

  it('consulta o GPUEngine (uso por CIM) quando não há nvidia-smi — AMD/Intel', async () => {
    const runner = vi.fn<CommandRunner>(async (_file, args) => {
      if (isNvidiaQuery(args)) return null
      if (isDynamicCim(args)) {
        return JSON.stringify({
          gpuUsagePercent: 42,
          gpuDedicatedBytes: 1024 * 1024 * 1024,
          gpuSharedBytes: 0,
          processor: { PercentProcessorPerformance: 100 }
        })
      }
      return null
    })
    const snapshot = await snapshotNative(runner)

    const dynamic = runner.mock.calls.find(([, args]) => isDynamicCim(args))
    expect(scriptOf(dynamic![1])).toContain('GPUEngine')
    expect(snapshot.gpu.usagePercent).toBe(42)
    expect(snapshot.gpu.vramUsedMb).toBe(1024)
    expect(snapshot.sources.gpuUsage).toBe('measured')
  })

  it('preenche o RPM da ventoinha pela NVML em máquina NVIDIA', async () => {
    vi.mocked(readNvmlFan).mockResolvedValue({ rpm: 1418, percent: 34 })
    const runner = vi.fn<CommandRunner>(async (_file, args) => {
      if (isNvidiaQuery(args)) return NVIDIA_LINE
      if (isStaticCim(args) || isDynamicCim(args)) return CIM_JSON
      return null
    })

    const snapshot = await snapshotNative(runner)

    expect(readNvmlFan).toHaveBeenCalledTimes(1)
    expect(snapshot.gpu.fanRpm).toBe(1418)
    // O percentual continua vindo do nvidia-smi; a NVML só acrescenta o RPM.
    expect(snapshot.gpu.fanPercent).toBe(0)
  })

  it('não paga o NVML em máquina AMD/Intel (nenhum indício de NVIDIA)', async () => {
    const cimAmd = JSON.stringify({
      cpu: {
        Name: 'AMD Ryzen 7 5700X 8-Core Processor',
        NumberOfCores: 8,
        NumberOfLogicalProcessors: 16,
        MaxClockSpeed: 3401
      },
      video: [
        {
          Name: 'AMD Radeon RX 7800 XT',
          PNPDeviceID: 'PCI\\VEN_1002&DEV_747E',
          DriverVersion: '31.0.24033.1003',
          DriverDate: '2024-03-13'
        }
      ],
      gpuUsagePercent: 0
    })
    const runner = vi.fn<CommandRunner>(async (_file, args) => {
      if (isNvidiaQuery(args)) return null
      if (isStaticCim(args) || isDynamicCim(args)) return cimAmd
      return null
    })

    const first = await snapshotNative(runner)
    const second = await snapshotNative(runner)

    expect(readNvmlFan).not.toHaveBeenCalled()
    expect(first.gpu.fanRpm).toBeNull()
    expect(second.gpu.fanRpm).toBeNull()
    expect(second.gpu.vendor).toBe('amd')
  })

  it('usa a NVML quando o CIM identifica NVIDIA mesmo sem o nvidia-smi', async () => {
    vi.mocked(readNvmlFan).mockResolvedValue({ rpm: 0, percent: 0 })
    const cimNvidia = JSON.stringify({
      cpu: {
        Name: 'AMD Ryzen 7 5700X 8-Core Processor',
        NumberOfCores: 8,
        NumberOfLogicalProcessors: 16,
        MaxClockSpeed: 3401
      },
      video: [
        {
          Name: 'NVIDIA GeForce RTX 5060 Ti',
          PNPDeviceID: PCI_RTX,
          DriverVersion: '32.0.16.2124',
          DriverDate: '2026-11-07'
        }
      ],
      gpuUsagePercent: 0
    })
    const runner = vi.fn<CommandRunner>(async (_file, args) => {
      if (isNvidiaQuery(args)) return null
      if (isStaticCim(args) || isDynamicCim(args)) return cimNvidia
      return null
    })

    // 1º tick: fabricante ainda desconhecido (a estática chega junto).
    const first = await snapshotNative(runner)
    // 2º tick: o CIM já disse NVIDIA; o NVML entra sem somar latência.
    const second = await snapshotNative(runner)

    expect(readNvmlFan).toHaveBeenCalledTimes(1)
    expect(first.gpu.fanRpm).toBeNull()
    // 0 RPM é leitura válida (modo zero-fan), não ausência de leitura.
    expect(second.gpu.fanRpm).toBe(0)
  })
})
