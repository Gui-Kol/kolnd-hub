import * as os from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(os.tmpdir(), 'kolnd-hub-test') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
// A identificação da CPU vem do registro (processo externo): nos testes ela é
// fixa (Zen 3, modelo 0x21 → plano 0 em `SVI + 0x10`) e nunca toca a máquina.
vi.mock('./cpuVoltage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cpuVoltage')>()
  return {
    ...actual,
    readCpuFamilyModel: vi.fn(async () => ({ family: 25, model: 0x21 }))
  }
})

import {
  MSR_AMD_PACKAGE_ENERGY_STATUS,
  MSR_AMD_RAPL_POWER_UNIT,
  MSR_INTEL_PACKAGE_ENERGY_STATUS,
  MSR_INTEL_PACKAGE_THERM_STATUS,
  MSR_INTEL_RAPL_POWER_UNIT,
  MSR_INTEL_TEMPERATURE_TARGET,
  MSR_INTEL_THERM_STATUS,
  averageOf,
  computePackageWatts,
  decodeIntelTemp,
  decodeIntelTjMax,
  decodeRaplUnit,
  decodeSmnTemp,
  pushMovingAverage,
  readCpuPower,
  resetCpuPowerForTests,
  type HwRegisterBatchRequest,
  type HwRegisterBatchResult,
  type HwRegisterReader
} from './cpuPower'
import {
  MSR_INTEL_PERF_STATUS,
  SMN_AMD_SVI0_PLANE0_0C,
  SMN_AMD_SVI0_PLANE0_10,
  SMN_AMD_SVI0_TFN,
  SMN_THM_TCON_CUR_TMP
} from './registers'
import { readCpuFamilyModel } from './cpuVoltage'

const ENERGY_UNIT_2_16 = 2 ** -16
const RAPL_UNIT_2_16 = 0x000a1003n

/** Valor bruto do SMN para uma temperatura em °C (campo de 11 bits / 8). */
function rawTemp(tempC: number): number {
  return Math.round(tempC * 8) << 21
}

/** Valor do plano 0 do SVI2 para um VID (bits 16–23); `V = 1,55 − 0,00625×VID`. */
function plane0Raw(vid: number): bigint {
  return BigInt((vid & 0xff) << 16)
}

/** Campo de tensão do `IA32_PERF_STATUS` para uma tensão em volts. */
function intelVoltageField(volts: number): bigint {
  return BigInt(Math.round(volts * 8192))
}

/** SMN de uma leitura AMD válida: Tctl, TFN=0, `+0xC` e `+0x10` (plano no Zen 3). */
function amdSmn(tempC: number, vid = 0x10): Array<bigint | null> {
  return [BigInt(rawTemp(tempC)), 0n, null, plane0Raw(vid)]
}

interface FakeReader extends HwRegisterReader {
  calls: HwRegisterBatchRequest[]
}

/**
 * Leitor injetado: os valores são fixos por registro e alinhados com o pedido,
 * então AMD e Intel são exercitados sem device, driver ou máquina real. `calls`
 * conta as execuções do backend — é a prova de "1 leitura por tick".
 */
function fakeReader(input: {
  msr?: Record<number, bigint | null>
  smn?: Record<number, bigint | null>
  available?: boolean
  error?: string
}): FakeReader {
  const calls: HwRegisterBatchRequest[] = []
  return {
    calls,
    readBatch: async (request) => {
      calls.push(request)
      return {
        available: input.available ?? true,
        msr: (request.msr ?? []).map((index) => input.msr?.[index] ?? null),
        smn: (request.smn ?? []).map((index) => input.smn?.[index] ?? null),
        error: input.error
      }
    }
  }
}

/** Leitor com uma resposta pronta por tick (ordem dos ticks = ordem do array). */
function sequenceReader(results: HwRegisterBatchResult[]): FakeReader {
  const calls: HwRegisterBatchRequest[] = []
  let index = 0
  return {
    calls,
    readBatch: async (request) => {
      calls.push(request)
      const result = results[Math.min(index, results.length - 1)]
      index += 1
      return result
    }
  }
}

function amdReader(input: {
  energy: bigint
  tempC?: number
  unit?: bigint
  available?: boolean
  error?: string
}): FakeReader {
  return fakeReader({
    msr: {
      [MSR_AMD_RAPL_POWER_UNIT]: input.unit ?? RAPL_UNIT_2_16,
      [MSR_AMD_PACKAGE_ENERGY_STATUS]: input.energy
    },
    smn: {
      [SMN_THM_TCON_CUR_TMP]: BigInt(rawTemp(input.tempC ?? 47.5)),
      // TFN bit 0 = 0 (leitura válida); modelo do mock é Zen 3 → plano em +0x10.
      [SMN_AMD_SVI0_TFN]: 0n,
      [SMN_AMD_SVI0_PLANE0_0C]: null,
      [SMN_AMD_SVI0_PLANE0_10]: plane0Raw(0x10)
    },
    available: input.available,
    error: input.error
  })
}

function intelReader(input: {
  energy: bigint
  tjMax?: number
  /** Delta até o TjMax no 0x1B1; null = sem o status do pacote. */
  delta?: number | null
  /** Delta no 0x19C (alternativa); padrão null. */
  thermDelta?: number | null
  unit?: bigint
  /** Campo do `IA32_PERF_STATUS`; padrão 1,25 V. */
  voltageField?: bigint | null
  available?: boolean
  error?: string
}): FakeReader {
  const delta = input.delta === undefined ? 30 : input.delta
  return fakeReader({
    msr: {
      [MSR_INTEL_RAPL_POWER_UNIT]: input.unit ?? RAPL_UNIT_2_16,
      [MSR_INTEL_PACKAGE_ENERGY_STATUS]: input.energy,
      [MSR_INTEL_TEMPERATURE_TARGET]: BigInt((input.tjMax ?? 100) << 16),
      [MSR_INTEL_PACKAGE_THERM_STATUS]: delta === null ? null : BigInt(delta << 16),
      [MSR_INTEL_THERM_STATUS]:
        input.thermDelta === undefined || input.thermDelta === null
          ? null
          : BigInt(input.thermDelta << 16),
      [MSR_INTEL_PERF_STATUS]:
        input.voltageField === undefined ? intelVoltageField(1.25) : input.voltageField
    },
    available: input.available,
    error: input.error
  })
}

const AMD_MSR_INDICES = [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS]

/** Pedido AMD completo: unidade + energia (MSR) e Tctl + SVI2 (SMN) no MESMO lote. */
const AMD_REQUEST: HwRegisterBatchRequest = {
  msr: AMD_MSR_INDICES,
  smn: [SMN_THM_TCON_CUR_TMP, SMN_AMD_SVI0_TFN, SMN_AMD_SVI0_PLANE0_0C, SMN_AMD_SVI0_PLANE0_10]
}

const INTEL_MSR_INDICES = [
  MSR_INTEL_RAPL_POWER_UNIT,
  MSR_INTEL_PACKAGE_ENERGY_STATUS,
  MSR_INTEL_TEMPERATURE_TARGET,
  MSR_INTEL_PACKAGE_THERM_STATUS,
  MSR_INTEL_THERM_STATUS,
  MSR_INTEL_PERF_STATUS
]

beforeEach(() => {
  resetCpuPowerForTests()
  vi.mocked(readCpuFamilyModel).mockResolvedValue({ family: 25, model: 0x21 })
})

describe('decodeRaplUnit', () => {
  it('decodifica o expoente dos bits 8–12 (0xA1003 → 2^-16 J)', () => {
    expect(decodeRaplUnit(0x000a1003)).toBe(ENERGY_UNIT_2_16)
    expect(decodeRaplUnit(0x000a1003n)).toBe(ENERGY_UNIT_2_16)
  })

  it('respeita o limite dos 5 bits do expoente', () => {
    // Bits 8–12 = 1 → 2^-1; bits acima do campo não interferem.
    expect(decodeRaplUnit(0x00010100)).toBe(0.5)
    expect(decodeRaplUnit(0x00001f00)).toBe(2 ** -31)
  })

  it('rejeita unidade ausente/zero e entradas inválidas', () => {
    expect(decodeRaplUnit(0)).toBeNull()
    expect(decodeRaplUnit(0n)).toBeNull()
    expect(decodeRaplUnit(null)).toBeNull()
    expect(decodeRaplUnit(undefined)).toBeNull()
    expect(decodeRaplUnit(Number.NaN)).toBeNull()
    expect(decodeRaplUnit(-1)).toBeNull()
    expect(decodeRaplUnit(1.5)).toBeNull()
  })
})

describe('computePackageWatts', () => {
  it('converte o delta do contador em watts', () => {
    const watts = computePackageWatts(
      { counter: 1000, unitJ: ENERGY_UNIT_2_16 },
      { counter: 1000 + 2_000_000, unitJ: ENERGY_UNIT_2_16 },
      1000
    )
    expect(watts).toBeCloseTo(30.5176, 3)
  })

  it('trata wrap do contador de 32 bits', () => {
    const watts = computePackageWatts(
      { counter: 0xffffff00, unitJ: ENERGY_UNIT_2_16 },
      { counter: 0x00000100, unitJ: ENERGY_UNIT_2_16 },
      1000
    )
    // Delta = 512 unidades → 512 × 2^-16 J em 1 s.
    expect(watts).toBeCloseTo(0.0078125, 8)
  })

  it('rejeita reset (salto maior que metade do contador) em vez de virar wrap', () => {
    expect(
      computePackageWatts(
        { counter: 100, unitJ: ENERGY_UNIT_2_16 },
        { counter: 0xffffffff, unitJ: ENERGY_UNIT_2_16 },
        1000
      )
    ).toBeNull()
  })

  it('rejeita contador igual, tempo inválido e unidade 0/NaN', () => {
    expect(
      computePackageWatts(
        { counter: 500, unitJ: ENERGY_UNIT_2_16 },
        { counter: 500, unitJ: ENERGY_UNIT_2_16 },
        1000
      )
    ).toBeNull()
    expect(
      computePackageWatts(
        { counter: 0, unitJ: ENERGY_UNIT_2_16 },
        { counter: 100, unitJ: ENERGY_UNIT_2_16 },
        0
      )
    ).toBeNull()
    expect(
      computePackageWatts(
        { counter: 0, unitJ: ENERGY_UNIT_2_16 },
        { counter: 100, unitJ: ENERGY_UNIT_2_16 },
        Number.NaN
      )
    ).toBeNull()
    expect(
      computePackageWatts({ counter: 0, unitJ: 0 }, { counter: 100, unitJ: 0 }, 1000)
    ).toBeNull()
    expect(
      computePackageWatts(
        { counter: 0, unitJ: Number.NaN },
        { counter: 100, unitJ: Number.NaN },
        1000
      )
    ).toBeNull()
  })

  it('rejeita amostra ausente e contador fora de 32 bits', () => {
    expect(computePackageWatts(null, { counter: 1, unitJ: ENERGY_UNIT_2_16 }, 1000)).toBeNull()
    expect(computePackageWatts({ counter: 1, unitJ: ENERGY_UNIT_2_16 }, null, 1000)).toBeNull()
    expect(
      computePackageWatts(
        { counter: -1, unitJ: ENERGY_UNIT_2_16 },
        { counter: 100, unitJ: ENERGY_UNIT_2_16 },
        1000
      )
    ).toBeNull()
    expect(
      computePackageWatts(
        { counter: 0, unitJ: ENERGY_UNIT_2_16 },
        { counter: 0x100000000, unitJ: ENERGY_UNIT_2_16 },
        1000
      )
    ).toBeNull()
  })
})

describe('decodeSmnTemp (AMD Tctl)', () => {
  it('decodifica Tctl do campo de 11 bits (bits 21–31, /8)', () => {
    expect(decodeSmnTemp(rawTemp(47.5))).toBe(47.5)
    expect(decodeSmnTemp(BigInt(rawTemp(82.25)))).toBe(82.25)
  })

  it('aplica o offset de −49 °C nos valores reais desta máquina (Ryzen 7 5700X)', () => {
    // Fixtures capturadas do SMN 0x00059800 nesta máquina. Sem o offset o
    // campo bruto daria 109,9/112,4/113,9/114,9 °C — o bug que esta regra corrige.
    expect(decodeSmnTemp(0x6dfb0000)).toBeCloseTo(60.9, 1) // repouso
    expect(decodeSmnTemp(0x707b0000)).toBeCloseTo(63.4, 1) // outra amostra
    expect(decodeSmnTemp(0x71fb0000)).toBeCloseTo(64.9, 1) // sob carga
    expect(decodeSmnTemp(0x72fb0000)).toBeCloseTo(65.9, 1)
  })

  it('aplica o offset pelo "range select" (bits 16–17 = 0x3) mesmo sem o bit 19', () => {
    // 110 °C brutos sem o bit 19, mas com 0x30000: vira 61 °C.
    expect(decodeSmnTemp(((110 * 8) << 21) | 0x30000)).toBe(61)
  })

  it('não subtrai quando nem o bit 19 nem o range select estão setados', () => {
    expect(decodeSmnTemp(rawTemp(47.5))).toBe(47.5)
    expect(decodeSmnTemp(rawTemp(82.25))).toBe(82.25)
  })

  it('rejeita 0, leitura absurda e entradas inválidas', () => {
    expect(decodeSmnTemp(0)).toBeNull()
    expect(decodeSmnTemp(0xffffffff)).toBeNull()
    expect(decodeSmnTemp(null)).toBeNull()
    expect(decodeSmnTemp(undefined)).toBeNull()
    expect(decodeSmnTemp(Number.NaN)).toBeNull()
    expect(decodeSmnTemp(-5)).toBeNull()
  })
})

describe('temperatura Intel (TjMax − delta)', () => {
  it('lê o TjMax dos bits 16–23 do 0x1A2', () => {
    expect(decodeIntelTjMax(100 << 16)).toBe(100)
    expect(decodeIntelTjMax(BigInt(95 << 16))).toBe(95)
    // Bits baixos não interferem.
    expect(decodeIntelTjMax((100 << 16) | 0xffff)).toBe(100)
  })

  it('rejeita TjMax 0, fora de 60–120 °C e entradas inválidas', () => {
    expect(decodeIntelTjMax(0)).toBeNull()
    expect(decodeIntelTjMax(40 << 16)).toBeNull()
    expect(decodeIntelTjMax(150 << 16)).toBeNull()
    expect(decodeIntelTjMax(null)).toBeNull()
    expect(decodeIntelTjMax(Number.NaN)).toBeNull()
  })

  it('subtrai o delta de 7 bits do TjMax', () => {
    expect(decodeIntelTemp(30 << 16, 100)).toBe(70)
    expect(decodeIntelTemp(BigInt(0), 100)).toBe(100) // no limite térmico
    expect(decodeIntelTemp((45 << 16) | 0xffff, 100)).toBe(55)
  })

  it('rejeita delta absurdo e ausência de TjMax', () => {
    expect(decodeIntelTemp(127 << 16, 100)).toBeNull() // −27 °C
    expect(decodeIntelTemp(30 << 16, null)).toBeNull()
    expect(decodeIntelTemp(null, 100)).toBeNull()
  })
})

describe('média móvel', () => {
  it('mantém as últimas 5 amostras', () => {
    let samples: number[] = []
    for (const value of [10, 20, 30, 40, 50, 60]) {
      samples = pushMovingAverage(samples, value)
    }
    expect(samples).toEqual([20, 30, 40, 50, 60])
    expect(averageOf(samples)).toBe(40)
  })

  it('ignora valores inválidos e lida com janela vazia', () => {
    expect(pushMovingAverage([1, 2], Number.NaN)).toEqual([1, 2])
    expect(pushMovingAverage([1, 2], 3, 0)).toEqual([1, 2])
    expect(averageOf([])).toBeNull()
    expect(averageOf([Number.NaN])).toBeNull()
  })
})

describe('readCpuPower (AMD)', () => {
  it('faz UMA leitura por tick e preserva temperatura/watts entre amostras', async () => {
    const reader = sequenceReader([
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 1_000n],
        smn: amdSmn(47.5)
      },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 1_000n + 2_000_000n],
        smn: amdSmn(47.5)
      }
    ])

    const first = await readCpuPower(1_000, reader, 'amd')
    expect(first).toEqual({ available: true, tempC: 47.5, watts: null, voltageV: 1.45 })
    // Regressão de custo: MSR + SMN no MESMO lote (1 processo por tick).
    expect(reader.calls).toHaveLength(1)
    expect(reader.calls[0]).toEqual(AMD_REQUEST)

    const second = await readCpuPower(2_000, reader, 'amd')
    expect(second.available).toBe(true)
    expect(second.tempC).toBe(47.5)
    expect(second.watts).toBeCloseTo(30.5176, 3)
    expect(second.voltageV).toBeCloseTo(1.45, 5)
    expect(reader.calls).toHaveLength(2)
  })

  it('aplica média móvel curta nas amostras seguintes', async () => {
    const reader = sequenceReader([
      { available: true, msr: [RAPL_UNIT_2_16, 0n], smn: amdSmn(47.5) },
      { available: true, msr: [RAPL_UNIT_2_16, 2_000_000n], smn: amdSmn(47.5) },
      { available: true, msr: [RAPL_UNIT_2_16, 6_000_000n], smn: amdSmn(47.5) }
    ])

    await readCpuPower(1_000, reader, 'amd')
    const second = await readCpuPower(2_000, reader, 'amd')
    const third = await readCpuPower(3_000, reader, 'amd')

    expect(second.watts).toBeCloseTo(30.5176, 3)
    // 30,5176 W e 61,0352 W → média 45,7764 W.
    expect(third.watts).toBeCloseTo(45.7764, 3)
    expect(reader.calls).toHaveLength(3)
  })

  it('sobrevive ao wrap do contador entre dois ticks', async () => {
    const reader = sequenceReader([
      { available: true, msr: [RAPL_UNIT_2_16, 0xffffff00n], smn: amdSmn(50) },
      { available: true, msr: [RAPL_UNIT_2_16, 0x00000100n], smn: amdSmn(50) }
    ])

    await readCpuPower(1_000, reader, 'amd')
    const second = await readCpuPower(2_000, reader, 'amd')
    expect(second.watts).toBeCloseTo(0.0078125, 8)
  })

  it('TFN com bit 0 ligado anula a tensão, mas mantém temperatura e potência', async () => {
    const reader = fakeReader({
      msr: {
        [MSR_AMD_RAPL_POWER_UNIT]: RAPL_UNIT_2_16,
        [MSR_AMD_PACKAGE_ENERGY_STATUS]: 1_000n
      },
      smn: {
        [SMN_THM_TCON_CUR_TMP]: BigInt(rawTemp(47.5)),
        // Leitura do plano 0 inválida (Zen 4/5 forçam TFN): nada de tensão.
        [SMN_AMD_SVI0_TFN]: 1n,
        [SMN_AMD_SVI0_PLANE0_0C]: null,
        [SMN_AMD_SVI0_PLANE0_10]: plane0Raw(0x10)
      }
    })
    const reading = await readCpuPower(1_000, reader, 'amd')
    expect(reading.available).toBe(true)
    expect(reading.tempC).toBe(47.5)
    expect(reading.voltageV).toBeNull()
  })

  it('modelo Zen+ escolhe o plano 0 em SVI + 0xC (não o +0x10)', async () => {
    vi.mocked(readCpuFamilyModel).mockResolvedValue({ family: 23, model: 0x08 })
    const reader = fakeReader({
      msr: {
        [MSR_AMD_RAPL_POWER_UNIT]: RAPL_UNIT_2_16,
        [MSR_AMD_PACKAGE_ENERGY_STATUS]: 1_000n
      },
      smn: {
        [SMN_THM_TCON_CUR_TMP]: BigInt(rawTemp(45)),
        [SMN_AMD_SVI0_TFN]: 0n,
        // 1,45 V no offset legado; 1,35 V no offset moderno (não deve ser lido).
        [SMN_AMD_SVI0_PLANE0_0C]: plane0Raw(0x10),
        [SMN_AMD_SVI0_PLANE0_10]: plane0Raw(0x20)
      }
    })
    const reading = await readCpuPower(1_000, reader, 'amd')
    expect(reading.voltageV).toBeCloseTo(1.45, 5)
  })

  it('unidade inválida não vira potência (null), mas mantém a temperatura', async () => {
    const reader = amdReader({ energy: 1_000n, unit: 0n })
    const reading = await readCpuPower(1_000, reader, 'amd')
    expect(reading.available).toBe(true)
    expect(reading.tempC).toBe(47.5)
    expect(reading.watts).toBeNull()
    expect(reading.voltageV).toBeCloseTo(1.45, 5)
    expect(reader.calls).toHaveLength(1)
  })
})

describe('readCpuPower (Intel)', () => {
  it('faz UMA leitura por tick e lê RAPL + temperatura no mesmo lote', async () => {
    const perf = intelVoltageField(1.25)
    const reader = sequenceReader([
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 1_000n, BigInt(100 << 16), BigInt(30 << 16), null, perf],
        smn: []
      },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 1_000n + 2_000_000n, BigInt(100 << 16), BigInt(30 << 16), null, perf],
        smn: []
      }
    ])

    const first = await readCpuPower(1_000, reader, 'intel')
    expect(first).toEqual({ available: true, tempC: 70, watts: null, voltageV: 1.25 })
    expect(reader.calls).toHaveLength(1)
    // Intel não tem SMN: o pedido vai só com MSR (um processo por tick).
    expect(reader.calls[0]).toEqual({ msr: INTEL_MSR_INDICES })

    const second = await readCpuPower(2_000, reader, 'intel')
    expect(second.tempC).toBe(70)
    expect(second.watts).toBeCloseTo(30.5176, 3)
    expect(second.voltageV).toBeCloseTo(1.25, 5)
    expect(reader.calls).toHaveLength(2)
  })

  it('usa o 0x19C quando o 0x1B1 não responde', async () => {
    const reading = await readCpuPower(
      1_000,
      intelReader({ energy: 1_000n, delta: null, thermDelta: 45 }),
      'intel'
    )
    expect(reading.tempC).toBe(55)
  })

  it('sem TjMax não inventa temperatura, mas a potência continua', async () => {
    const tempStatus = BigInt(10 << 16)
    const perf = intelVoltageField(1.25)
    const reader = sequenceReader([
      { available: true, msr: [RAPL_UNIT_2_16, 0n, 0n, tempStatus, null, perf], smn: [] },
      { available: true, msr: [RAPL_UNIT_2_16, 2_000_000n, 0n, tempStatus, null, perf], smn: [] }
    ])

    await readCpuPower(1_000, reader, 'intel')
    const second = await readCpuPower(2_000, reader, 'intel')
    expect(second.tempC).toBeNull()
    expect(second.watts).toBeCloseTo(30.5176, 3)
  })

  it('aplica a mesma média móvel do AMD', async () => {
    const perf = intelVoltageField(1.25)
    const reader = sequenceReader([
      { available: true, msr: [RAPL_UNIT_2_16, 0n, BigInt(100 << 16), 0n, null, perf], smn: [] },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 2_000_000n, BigInt(100 << 16), 0n, null, perf],
        smn: []
      },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 6_000_000n, BigInt(100 << 16), 0n, null, perf],
        smn: []
      }
    ])

    await readCpuPower(1_000, reader, 'intel')
    const second = await readCpuPower(2_000, reader, 'intel')
    const third = await readCpuPower(3_000, reader, 'intel')
    expect(second.watts).toBeCloseTo(30.5176, 3)
    expect(third.watts).toBeCloseTo(45.7764, 3)
    expect(reader.calls).toHaveLength(3)
  })
})

describe('base de tempo da amostra (sink de 1 Hz lido a 2 Hz)', () => {
  it('duas amostras 1 s apart dão os watts corretos pelo timestamp da amostra', async () => {
    const t0 = 1_000_000
    const reader = sequenceReader([
      { available: true, msr: [RAPL_UNIT_2_16, 0n], smn: amdSmn(47.5), sampledAtMs: t0 },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 2_000_000n],
        smn: amdSmn(47.5),
        sampledAtMs: t0 + 1_000
      }
    ])

    await readCpuPower(t0, reader, 'amd')
    const second = await readCpuPower(t0 + 1_000, reader, 'amd')
    expect(second.watts).toBeCloseTo(30.5176, 3)
  })

  it('amostra repetida devolve a média atual, não zera e não contamina a próxima', async () => {
    const t0 = 5_000_000
    const reader = sequenceReader([
      { available: true, msr: [RAPL_UNIT_2_16, 0n], smn: amdSmn(47.5), sampledAtMs: t0 },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 2_000_000n],
        smn: amdSmn(47.5),
        sampledAtMs: t0 + 1_000
      },
      // O arquivo não mudou: a segunda leitura a 2 Hz vê a MESMA amostra.
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 2_000_000n],
        smn: amdSmn(47.5),
        sampledAtMs: t0 + 1_000
      },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 6_000_000n],
        smn: amdSmn(47.5),
        sampledAtMs: t0 + 2_000
      }
    ])

    await readCpuPower(t0, reader, 'amd')
    const measured = await readCpuPower(t0 + 1_000, reader, 'amd')
    const repeated = await readCpuPower(t0 + 1_500, reader, 'amd')
    const next = await readCpuPower(t0 + 2_000, reader, 'amd')

    expect(measured.watts).toBeCloseTo(30.5176, 3)
    // Repetição não vira `null` nem dobra: devolve exatamente a média vigente.
    expect(repeated.watts).toBe(measured.watts)
    // Próxima amostra: 4 M unidades em 1 s (delta da AMOSTRA, não da leitura).
    // Se o instante tivesse sido reescrito no tick repetido, o delta sairia 2×.
    expect(next.watts).toBeCloseTo(45.7764, 3)
  })

  it('usa sampledAtMs e ignora o relógio da leitura (now propositalmente errado)', async () => {
    const t0 = 9_000_000
    const reader = sequenceReader([
      { available: true, msr: [RAPL_UNIT_2_16, 0n], smn: amdSmn(47.5), sampledAtMs: t0 },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 2_000_000n],
        smn: amdSmn(47.5),
        sampledAtMs: t0 + 1_000
      }
    ])

    await readCpuPower(t0 - 5_000_000, reader, 'amd')
    const second = await readCpuPower(t0 + 5_000_000, reader, 'amd')
    expect(second.watts).toBeCloseTo(30.5176, 3)
  })

  it('mantém o wrap de 32 bits correto com a base da amostra', async () => {
    const t0 = 7_000_000
    const reader = sequenceReader([
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 0xffffff00n],
        smn: amdSmn(50),
        sampledAtMs: t0
      },
      {
        available: true,
        msr: [RAPL_UNIT_2_16, 0x00000100n],
        smn: amdSmn(50),
        sampledAtMs: t0 + 1_000
      }
    ])

    await readCpuPower(t0, reader, 'amd')
    const second = await readCpuPower(t0 + 1_000, reader, 'amd')
    expect(second.watts).toBeCloseTo(0.0078125, 8)
  })
})

describe('readCpuPower sem driver', () => {
  it('device fechado devolve available=false e campos null nos dois vendors', async () => {
    for (const vendor of ['amd', 'intel'] as const) {
      resetCpuPowerForTests()
      const reader = fakeReader({ available: false, error: undefined })
      const reading = await readCpuPower(1_000, reader, vendor)
      expect(reading).toEqual({
        available: false,
        tempC: null,
        watts: null,
        voltageV: null,
        error: undefined
      })
      expect(reader.calls).toHaveLength(1)
    }
  })

  it('propaga o erro explicável do leitor', async () => {
    const reading = await readCpuPower(
      1_000,
      fakeReader({ available: false, error: 'O PawnIO não está instalado.' }),
      'amd'
    )
    expect(reading).toEqual({
      available: false,
      tempC: null,
      watts: null,
      voltageV: null,
      error: 'O PawnIO não está instalado.'
    })
  })

  it('device aberto sem módulo válido mantém nulls e explica o motivo', async () => {
    const reading = await readCpuPower(
      1_000,
      fakeReader({
        available: true,
        error: 'O módulo de leitura do PawnIO rejeitou esta CPU.'
      }),
      'amd'
    )
    expect(reading.available).toBe(true)
    expect(reading.tempC).toBeNull()
    expect(reading.watts).toBeNull()
    expect(reading.voltageV).toBeNull()
    expect(reading.error).toContain('rejeitou esta CPU')
  })

  it('erro do leitor degrada para null sem lançar', async () => {
    const reader: HwRegisterReader = {
      readBatch: vi.fn().mockRejectedValue(new Error('boom'))
    }
    const reading = await readCpuPower(1_000, reader, 'amd')
    expect(reading).toEqual({
      available: false,
      tempC: null,
      watts: null,
      voltageV: null,
      error: 'Não foi possível ler os sensores da CPU.'
    })
  })
})
