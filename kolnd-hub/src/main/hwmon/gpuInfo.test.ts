import { describe, expect, it } from 'vitest'
import {
  buildGpuAdapters,
  gpuVendorFromName,
  gpuVendorFromPnpId,
  isVirtualAdapter,
  normalizeDriverDate,
  parseGpuRegistry,
  parseVideoControllers,
  resolveVramTotalMb,
  selectPrimaryGpu,
  type GpuRegistryEntry
} from './gpuInfo'

/**
 * Fixtures capturadas NESTA máquina (18/11/2026):
 * `Get-CimInstance Win32_VideoController` + as chaves
 * `HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-...}`.
 *
 * O caso Parsec + RTX é o que motivou o módulo: dois adaptadores, sendo um
 * virtual, com `AdapterRAM` saturado em ~4 GiB numa placa de 8 GiB.
 */
const REAL_VIDEO_CONTROLLERS = [
  {
    Name: 'Parsec Virtual Display Adapter',
    PNPDeviceID: 'ROOT\\DISPLAY\\0000',
    DriverVersion: '0.45.0.0',
    DriverDate: '/Date(1706140800000)/',
    AdapterRAM: null,
    VideoProcessor: null,
    AdapterCompatibility: 'Parsec Cloud, Inc.',
    Status: 'OK'
  },
  {
    Name: 'NVIDIA GeForce RTX 5060 Ti',
    PNPDeviceID: 'PCI\\VEN_10DE&DEV_2D04&SUBSYS_53621462&REV_A1\\71F57159262DB04800',
    DriverVersion: '32.0.16.2124',
    DriverDate: '/Date(1794009600000)/',
    AdapterRAM: 4293918720,
    VideoProcessor: 'NVIDIA GeForce RTX 5060 Ti',
    AdapterCompatibility: 'NVIDIA',
    Status: 'OK'
  }
]

const REAL_REGISTRY = [
  {
    Key: '0000',
    DriverDesc: 'NVIDIA GeForce RTX 5060 Ti',
    DriverVersion: '32.0.16.2124',
    MatchingDeviceId: 'pci\\ven_10de&dev_2d04&subsys_53621462',
    ProviderName: 'NVIDIA',
    'HardwareInformation.qwMemorySize': 8546942976
  },
  {
    Key: '0001',
    DriverDesc: 'Parsec Virtual Display Adapter',
    DriverVersion: '0.45.0.0',
    MatchingDeviceId: 'Root\\Parsec\\VDA',
    ProviderName: 'Parsec Cloud, Inc.',
    'HardwareInformation.qwMemorySize': null
  },
  {
    Key: 'Configuration',
    DriverDesc: null,
    DriverVersion: null,
    MatchingDeviceId: null,
    ProviderName: null,
    'HardwareInformation.qwMemorySize': null
  }
]

const AMD_CONTROLLER = {
  Name: 'AMD Radeon RX 7800 XT',
  PNPDeviceID: 'PCI\\VEN_1002&DEV_747E&SUBSYS_E1A11DA2&REV_C8\\6&1A2B3C4D&0&00000019',
  DriverVersion: '31.0.24033.1003',
  DriverDate: '/Date(1710288000000)/',
  AdapterRAM: 4293918720
}

const AMD_REGISTRY: GpuRegistryEntry[] = [
  {
    driverDesc: 'AMD Radeon RX 7800 XT',
    driverVersion: '31.0.24033.1003',
    matchingDeviceId: 'pci\\ven_1002&dev_747e&subsys_e1a11da2',
    memoryBytes: 17179869184
  }
]

const INTEL_CONTROLLER = {
  Name: 'Intel(R) UHD Graphics 630',
  PNPDeviceID: 'PCI\\VEN_8086&DEV_3E9B&SUBSYS_D0001458&REV_00\\3&11583659&0&10',
  DriverVersion: '27.20.100.9316',
  DriverDate: '/Date(1617235200000)/',
  AdapterRAM: 1073741824
}

describe('parseVideoControllers', () => {
  it('lê os adaptadores reais desta máquina', () => {
    const controllers = parseVideoControllers(REAL_VIDEO_CONTROLLERS)
    expect(controllers).toHaveLength(2)
    expect(controllers[0]).toEqual({
      name: 'Parsec Virtual Display Adapter',
      pnpDeviceId: 'ROOT\\DISPLAY\\0000',
      driverVersion: '0.45.0.0',
      driverDate: '2024-01-25',
      adapterRamBytes: null
    })
    expect(controllers[1].name).toBe('NVIDIA GeForce RTX 5060 Ti')
    expect(controllers[1].driverDate).toBe('2026-11-07')
    // 4.293.918.720 = teto do uint32 (não é a VRAM real de 8 GB).
    expect(controllers[1].adapterRamBytes).toBe(4293918720)
  })

  it('aceita item único e ignora linhas sem nome', () => {
    const controllers = parseVideoControllers({
      Name: 'AMD Radeon RX 7800 XT',
      AdapterRAM: '17179869184'
    })
    expect(controllers).toEqual([
      {
        name: 'AMD Radeon RX 7800 XT',
        pnpDeviceId: null,
        driverVersion: null,
        driverDate: null,
        adapterRamBytes: 17179869184
      }
    ])
    expect(parseVideoControllers([{ PNPDeviceID: 'PCI\\VEN_10DE' }])).toEqual([])
    expect(parseVideoControllers(null)).toEqual([])
    expect(parseVideoControllers('json inválido')).toEqual([])
  })
})

describe('normalizeDriverDate', () => {
  it('converte o formato /Date(ms)/ do ConvertTo-Json', () => {
    expect(normalizeDriverDate('/Date(1794009600000)/')).toBe('2026-11-07')
    expect(normalizeDriverDate('/Date(1706140800000)/')).toBe('2024-01-25')
  })

  it('aceita ISO e datetime do WMI', () => {
    expect(normalizeDriverDate('2026-11-07')).toBe('2026-11-07')
    expect(normalizeDriverDate('2026-11-07T00:00:00Z')).toBe('2026-11-07')
    expect(normalizeDriverDate('20261107000000.000000-000')).toBe('2026-11-07')
  })

  it('recusa lixo sem inventar data', () => {
    expect(normalizeDriverDate('00000000000000.000000-000')).toBeNull()
    expect(normalizeDriverDate('ontem')).toBeNull()
    expect(normalizeDriverDate('')).toBeNull()
    expect(normalizeDriverDate(null)).toBeNull()
  })
})

describe('parseGpuRegistry', () => {
  it('lê a chave real, inclui o Parsec e descarta a chave Configuration', () => {
    const entries = parseGpuRegistry(REAL_REGISTRY)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({
      driverDesc: 'NVIDIA GeForce RTX 5060 Ti',
      driverVersion: '32.0.16.2124',
      matchingDeviceId: 'pci\\ven_10de&dev_2d04&subsys_53621462',
      memoryBytes: 8546942976
    })
    expect(entries[1].memoryBytes).toBeNull()
  })

  it('zero/vazio não vira 0 MiB', () => {
    const entries = parseGpuRegistry([{ DriverDesc: 'GPU', 'HardwareInformation.qwMemorySize': 0 }])
    expect(entries[0].memoryBytes).toBeNull()
    expect(parseGpuRegistry({})).toEqual([])
  })
})

describe('resolveVramTotalMb', () => {
  const controllers = parseVideoControllers(REAL_VIDEO_CONTROLLERS)
  const registry = parseGpuRegistry(REAL_REGISTRY)

  it('usa o qwMemorySize do registro (8151 MiB) e não o AdapterRAM saturado', () => {
    expect(resolveVramTotalMb(controllers[1], registry)).toBe(8151)
  })

  it('casamento por MatchingDeviceId quando o nome diverge', () => {
    const renamed = { ...controllers[1], name: 'NVIDIA Graphics Device' }
    expect(resolveVramTotalMb(renamed, registry)).toBe(8151)
  })

  it('sem registro confiável não usa AdapterRAM no teto do uint32', () => {
    expect(resolveVramTotalMb(controllers[1], [])).toBeNull()
  })

  it('AdapterRAM abaixo do teto ainda serve de fallback', () => {
    const intel = parseVideoControllers(INTEL_CONTROLLER)[0]
    expect(resolveVramTotalMb(intel, [])).toBe(1024)
  })

  it('VRAM absurda no registro é descartada', () => {
    const insane: GpuRegistryEntry[] = [
      {
        driverDesc: 'NVIDIA GeForce RTX 5060 Ti',
        driverVersion: null,
        matchingDeviceId: null,
        memoryBytes: 10 * 1024 ** 4
      }
    ]
    // Cai no AdapterRAM, que está saturado → null (nunca 10 TB).
    expect(resolveVramTotalMb(controllers[1], insane)).toBeNull()
  })
})

describe('fabricante', () => {
  it('identifica pelo nome', () => {
    expect(gpuVendorFromName('NVIDIA GeForce RTX 5060 Ti')).toBe('nvidia')
    expect(gpuVendorFromName('AMD Radeon RX 7800 XT')).toBe('amd')
    expect(gpuVendorFromName('Intel(R) UHD Graphics 630')).toBe('intel')
    expect(gpuVendorFromName('Parsec Virtual Display Adapter')).toBe('other')
    expect(gpuVendorFromName(null)).toBe('other')
  })

  it('identifica pelo VEN_ do PNP', () => {
    expect(gpuVendorFromPnpId('PCI\\VEN_10DE&DEV_2D04')).toBe('nvidia')
    expect(gpuVendorFromPnpId('PCI\\VEN_1002&DEV_747E')).toBe('amd')
    expect(gpuVendorFromPnpId('PCI\\VEN_8086&DEV_3E9B')).toBe('intel')
    expect(gpuVendorFromPnpId('ROOT\\DISPLAY\\0000')).toBe('other')
    expect(gpuVendorFromPnpId(undefined)).toBe('other')
  })
})

describe('isVirtualAdapter', () => {
  it('marca o Parsec real e os adaptadores de software', () => {
    expect(isVirtualAdapter('Parsec Virtual Display Adapter', 'ROOT\\DISPLAY\\0000')).toBe(true)
    expect(isVirtualAdapter('Microsoft Basic Display Adapter', 'ROOT\\BasicDisplay\\0000')).toBe(
      true
    )
    expect(isVirtualAdapter('Microsoft Basic Render Driver', 'ROOT\\BasicRender\\0000')).toBe(true)
    expect(isVirtualAdapter('Remote Display Adapter', null)).toBe(true)
    expect(isVirtualAdapter('Meta Virtual Monitor', null)).toBe(true)
  })

  it('não marca GPU física', () => {
    expect(isVirtualAdapter('NVIDIA GeForce RTX 5060 Ti', 'PCI\\VEN_10DE&DEV_2D04')).toBe(false)
    expect(isVirtualAdapter('AMD Radeon RX 7800 XT', 'PCI\\VEN_1002&DEV_747E')).toBe(false)
    expect(isVirtualAdapter('Intel(R) UHD Graphics 630', 'PCI\\VEN_8086&DEV_3E9B')).toBe(false)
  })
})

describe('buildGpuAdapters + selectPrimaryGpu', () => {
  it('caso real: escolhe a RTX, não o Parsec, com VRAM do registro', () => {
    const adapters = buildGpuAdapters(
      parseVideoControllers(REAL_VIDEO_CONTROLLERS),
      parseGpuRegistry(REAL_REGISTRY)
    )
    expect(adapters.map((adapter) => adapter.isVirtual)).toEqual([true, false])
    expect(adapters[0].vramTotalMb).toBeNull()

    const primary = selectPrimaryGpu(adapters)
    expect(primary).not.toBeNull()
    expect(primary?.name).toBe('NVIDIA GeForce RTX 5060 Ti')
    expect(primary?.vendor).toBe('nvidia')
    expect(primary?.vramTotalMb).toBe(8151)
    expect(primary?.driverVersion).toBe('32.0.16.2124')
    expect(primary?.driverDate).toBe('2026-11-07')
  })

  it('caso AMD sintético: VRAM de 16 GB pelo registro', () => {
    const adapters = buildGpuAdapters(parseVideoControllers([AMD_CONTROLLER]), AMD_REGISTRY)
    expect(adapters[0]).toMatchObject({
      vendor: 'amd',
      vramTotalMb: 16384,
      driverVersion: '31.0.24033.1003',
      isVirtual: false
    })
    expect(selectPrimaryGpu(adapters)?.name).toBe('AMD Radeon RX 7800 XT')
  })

  it('prefere NVIDIA/AMD sobre Intel quando os dois existem', () => {
    const withAmd = buildGpuAdapters(
      parseVideoControllers([INTEL_CONTROLLER, AMD_CONTROLLER]),
      AMD_REGISTRY
    )
    expect(selectPrimaryGpu(withAmd)?.vendor).toBe('amd')

    const withNvidia = buildGpuAdapters(
      parseVideoControllers([INTEL_CONTROLLER, ...REAL_VIDEO_CONTROLLERS]),
      parseGpuRegistry(REAL_REGISTRY)
    )
    expect(selectPrimaryGpu(withNvidia)?.name).toBe('NVIDIA GeForce RTX 5060 Ti')
  })

  it('só Intel ainda é escolhida; só virtual devolve null', () => {
    const onlyIntel = buildGpuAdapters(parseVideoControllers([INTEL_CONTROLLER]), [])
    expect(selectPrimaryGpu(onlyIntel)?.vendor).toBe('intel')
    expect(selectPrimaryGpu(onlyIntel)?.vramTotalMb).toBe(1024)

    const onlyVirtual = buildGpuAdapters(
      parseVideoControllers([REAL_VIDEO_CONTROLLERS[0]]),
      parseGpuRegistry(REAL_REGISTRY)
    )
    expect(selectPrimaryGpu(onlyVirtual)).toBeNull()
    expect(selectPrimaryGpu([])).toBeNull()
  })
})
