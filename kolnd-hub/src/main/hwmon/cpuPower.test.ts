import * as os from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(os.tmpdir(), 'kolnd-hub-test') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  MSR_AMD_PACKAGE_ENERGY_STATUS,
  MSR_AMD_RAPL_POWER_UNIT,
  SMN_DATA_OFFSET,
  SMN_INDEX_OFFSET,
  SMN_THM_TCON_CUR_TMP,
  averageOf,
  computePackageWatts,
  decodeRaplUnit,
  decodeSmnTemp,
  pushMovingAverage,
  readCpuPower,
  resetCpuPowerForTests,
  type WinRing0BatchReader
} from './cpuPower'
import type { WinRing0BatchResult } from './winring0'

const ENERGY_UNIT_2_16 = 2 ** -16

/** Valor bruto do SMN para uma temperatura em °C (campo de 11 bits / 8). */
function rawTemp(tempC: number): number {
  return Math.round(tempC * 8) << 21
}

function batchResult(input: {
  energy: bigint
  tempRaw?: number | null
  unit?: bigint
  deviceOpen?: boolean
}): WinRing0BatchResult {
  return {
    ok: true,
    deviceOpen: input.deviceOpen ?? true,
    msr: [
      { index: MSR_AMD_RAPL_POWER_UNIT, value: input.unit ?? 0x000a1003n },
      { index: MSR_AMD_PACKAGE_ENERGY_STATUS, value: input.energy }
    ],
    pciWrites: [
      {
        bus: 0,
        device: 0x14,
        function: 0,
        offset: SMN_INDEX_OFFSET,
        ok: true
      }
    ],
    pci: [
      {
        bus: 0,
        device: 0x14,
        function: 0,
        offset: SMN_DATA_OFFSET,
        value: input.tempRaw === undefined ? rawTemp(47.5) : input.tempRaw
      }
    ]
  }
}

beforeEach(() => {
  resetCpuPowerForTests()
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

describe('decodeSmnTemp', () => {
  it('decodifica Tctl do campo de 11 bits (bits 21–31, /8)', () => {
    expect(decodeSmnTemp(rawTemp(47.5))).toBe(47.5)
    expect(decodeSmnTemp(BigInt(rawTemp(82.25)))).toBe(82.25)
  })

  it('rejeita 0, leitura absurda e entradas inválidas', () => {
    expect(decodeSmnTemp(0)).toBeNull()
    expect(decodeSmnTemp(0xffffffff)).toBeNull() // 255,875 °C
    expect(decodeSmnTemp(null)).toBeNull()
    expect(decodeSmnTemp(undefined)).toBeNull()
    expect(decodeSmnTemp(Number.NaN)).toBeNull()
    expect(decodeSmnTemp(-5)).toBeNull()
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

describe('readCpuPower', () => {
  it('primeira amostra só tem temperatura; a segunda calcula watts', async () => {
    const reader = vi
      .fn<WinRing0BatchReader>()
      .mockResolvedValueOnce(batchResult({ energy: 1_000n }))
      .mockResolvedValueOnce(batchResult({ energy: 1_000n + 2_000_000n }))

    const first = await readCpuPower(1_000, reader)
    expect(first).toEqual({ available: true, tempC: 47.5, watts: null })

    const second = await readCpuPower(2_000, reader)
    expect(second.available).toBe(true)
    expect(second.tempC).toBe(47.5)
    expect(second.watts).toBeCloseTo(30.5176, 3)

    // O pedido contém unidade + energia, escrita do índice SMN e leitura do dado.
    const request = reader.mock.calls[0][0]
    expect(request.msr).toEqual([MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS])
    expect(request.pciWrites?.[0]).toMatchObject({
      bus: 0,
      device: 0x14,
      function: 0,
      offset: SMN_INDEX_OFFSET,
      value: SMN_THM_TCON_CUR_TMP
    })
    expect(request.pci?.[0]).toMatchObject({ offset: SMN_DATA_OFFSET })
  })

  it('aplica média móvel curta nas amostras seguintes', async () => {
    const reader = vi
      .fn<WinRing0BatchReader>()
      .mockResolvedValueOnce(batchResult({ energy: 0n }))
      .mockResolvedValueOnce(batchResult({ energy: 2_000_000n }))
      .mockResolvedValueOnce(batchResult({ energy: 6_000_000n }))

    await readCpuPower(1_000, reader)
    const second = await readCpuPower(2_000, reader)
    const third = await readCpuPower(3_000, reader)

    expect(second.watts).toBeCloseTo(30.5176, 3)
    // 30,5176 W e 61,0352 W → média 45,7764 W.
    expect(third.watts).toBeCloseTo(45.7764, 3)
  })

  it('sobrevive ao wrap do contador entre dois ticks', async () => {
    const reader = vi
      .fn<WinRing0BatchReader>()
      .mockResolvedValueOnce(batchResult({ energy: 0xffffff00n }))
      .mockResolvedValueOnce(batchResult({ energy: 0x00000100n }))

    await readCpuPower(1_000, reader)
    const second = await readCpuPower(2_000, reader)
    expect(second.watts).toBeCloseTo(0.0078125, 8)
  })

  it('sem driver devolve available=false e campos null', async () => {
    const reader = vi
      .fn<WinRing0BatchReader>()
      .mockResolvedValue(batchResult({ energy: 0n, deviceOpen: false, tempRaw: null }))

    const reading = await readCpuPower(1_000, reader)
    expect(reading).toEqual({ available: false, tempC: null, watts: null, error: undefined })
  })

  it('unidade inválida não vira potência (null), mas mantém a temperatura', async () => {
    const reader = vi
      .fn<WinRing0BatchReader>()
      .mockResolvedValue(batchResult({ energy: 1_000n, unit: 0n }))

    const reading = await readCpuPower(1_000, reader)
    expect(reading.available).toBe(true)
    expect(reading.tempC).toBe(47.5)
    expect(reading.watts).toBeNull()
  })

  it('erro do leitor degrada para null sem lançar', async () => {
    const reader = vi.fn<WinRing0BatchReader>().mockRejectedValue(new Error('boom'))
    const reading = await readCpuPower(1_000, reader)
    expect(reading).toEqual({
      available: false,
      tempC: null,
      watts: null,
      error: 'Não foi possível ler os sensores da CPU.'
    })
  })
})
