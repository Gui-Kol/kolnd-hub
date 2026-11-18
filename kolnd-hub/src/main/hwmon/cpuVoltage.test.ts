import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => 'C:\\userData') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
// O `reg.exe` nunca roda de verdade nos testes; o callback é controlado aqui.
vi.mock('child_process', () => ({ execFile: execFileMock }))

import {
  AMD_SVI_PLANE0_OFFSET_LEGACY,
  AMD_SVI_PLANE0_OFFSET_MODERN,
  amdSviPlane0Offset,
  decodeAmdSviVoltage,
  decodeIntelVoltage,
  parseCpuIdentifier,
  readCpuFamilyModel,
  resetCpuFamilyModelCacheForTests
} from './cpuVoltage'

const IDENTIFIER_OUTPUT =
  '\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0\r\n' +
  '    Identifier    REG_SZ    AMD64 Family 25 Model 33 Stepping 2\r\n\r\n'

/** Valor do registrador do plano 0 do SVI2 para um VID (bits 16–23). */
function sviPlane0(vid: number): bigint {
  return BigInt((vid & 0xff) << 16)
}

/** Campo de 16 bits do `IA32_PERF_STATUS` para uma tensão (1/8192 V). */
function intelField(volts: number): bigint {
  return BigInt(Math.round(volts * 8192))
}

/** Simula o `execFile` do `reg query` chamando o callback com a saída dada. */
function mockRegOutput(output: string | null, error: Error | null = null): void {
  execFileMock.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      error: Error | null,
      stdout: string,
      stderr: string
    ) => void
    callback(error, output ?? '', '')
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetCpuFamilyModelCacheForTests()
})

describe('parseCpuIdentifier', () => {
  it('extrai família e modelo do texto do registro (Zen 3 desta máquina)', () => {
    expect(parseCpuIdentifier('AMD64 Family 25 Model 33 Stepping 2')).toEqual({
      family: 25,
      model: 33
    })
  })

  it('aceita a saída completa do reg.exe e o formato Intel', () => {
    expect(parseCpuIdentifier(IDENTIFIER_OUTPUT)).toEqual({ family: 25, model: 33 })
    expect(parseCpuIdentifier('Intel64 Family 6 Model 154 Stepping 3')).toEqual({
      family: 6,
      model: 154
    })
  })

  it('texto fora do padrão vira null (nunca inventa modelo)', () => {
    expect(parseCpuIdentifier('')).toBeNull()
    expect(parseCpuIdentifier('AMD Ryzen 7 5700X')).toBeNull()
    expect(parseCpuIdentifier('Family 0 Model 33')).toBeNull()
    expect(parseCpuIdentifier(null)).toBeNull()
    expect(parseCpuIdentifier(undefined)).toBeNull()
  })
})

describe('amdSviPlane0Offset', () => {
  it('usa +0x10 para Threadripper 3000 e Zen 2–5 (modelos 0x31/0x71/0x21/0x61/0x44)', () => {
    for (const model of [0x31, 0x71, 0x21, 0x61, 0x44]) {
      expect(amdSviPlane0Offset(model)).toBe(AMD_SVI_PLANE0_OFFSET_MODERN)
    }
  })

  it('usa +0xC para Zen/Zen+ (demais modelos)', () => {
    expect(amdSviPlane0Offset(0x01)).toBe(AMD_SVI_PLANE0_OFFSET_LEGACY)
    expect(amdSviPlane0Offset(0x08)).toBe(AMD_SVI_PLANE0_OFFSET_LEGACY)
    expect(amdSviPlane0Offset(0x00)).toBe(AMD_SVI_PLANE0_OFFSET_LEGACY)
  })

  it('modelo ausente/inválido cai no legado (a decodificação recusa depois)', () => {
    expect(amdSviPlane0Offset(null)).toBe(AMD_SVI_PLANE0_OFFSET_LEGACY)
    expect(amdSviPlane0Offset(undefined)).toBe(AMD_SVI_PLANE0_OFFSET_LEGACY)
    expect(amdSviPlane0Offset(1.5)).toBe(AMD_SVI_PLANE0_OFFSET_LEGACY)
  })
})

describe('decodeAmdSviVoltage (SVI2)', () => {
  const ZEN3 = 0x21
  const ZEN_PLUS = 0x08

  it('VID 0 → 1,550 V e VID 0x10 → 1,450 V', () => {
    expect(decodeAmdSviVoltage(0n, sviPlane0(0x00), ZEN3)).toBeCloseTo(1.55, 5)
    expect(decodeAmdSviVoltage(0n, sviPlane0(0x10), ZEN3)).toBeCloseTo(1.45, 5)
  })

  it('usa o campo dos bits 16–23 como VID (bits baixos não interferem)', () => {
    // VID 0x10 no campo alto; sujeira nos bits baixos é ignorada.
    expect(decodeAmdSviVoltage(0, 0x0010ffff, ZEN3)).toBeCloseTo(1.45, 5)
    expect(decodeAmdSviVoltage(0n, sviPlane0(0x08), ZEN_PLUS)).toBeCloseTo(1.5, 5)
  })

  it('TFN com bit 0 ligado (ou ausente) anula a leitura', () => {
    expect(decodeAmdSviVoltage(1n, sviPlane0(0x10), ZEN3)).toBeNull()
    expect(decodeAmdSviVoltage(0x01, sviPlane0(0x10), ZEN3)).toBeNull()
    expect(decodeAmdSviVoltage(null, sviPlane0(0x10), ZEN3)).toBeNull()
    expect(decodeAmdSviVoltage(undefined, sviPlane0(0x10), ZEN3)).toBeNull()
    // Outros bits do TFN não invalidam: só o bit 0 (plano 0).
    expect(decodeAmdSviVoltage(0xfe, sviPlane0(0x00), ZEN3)).toBeCloseTo(1.55, 5)
  })

  it('modelo ausente/inválido ou plano ausente vira null (nunca estima)', () => {
    expect(decodeAmdSviVoltage(0n, sviPlane0(0x10), null)).toBeNull()
    expect(decodeAmdSviVoltage(0n, sviPlane0(0x10), undefined)).toBeNull()
    expect(decodeAmdSviVoltage(0n, sviPlane0(0x10), 1.5)).toBeNull()
    expect(decodeAmdSviVoltage(0n, null, ZEN3)).toBeNull()
    expect(decodeAmdSviVoltage(0n, -1, ZEN3)).toBeNull()
  })

  it('tensão fora de 0,3–1,8 V vira null', () => {
    // VID 0xFF → 1,55 − 1,59375 = −0,04375 V (sensor inválido).
    expect(decodeAmdSviVoltage(0n, sviPlane0(0xff), ZEN3)).toBeNull()
    // VID 0xC0 → 0,35 V: ainda plausível (limite útil da faixa).
    expect(decodeAmdSviVoltage(0n, sviPlane0(0xc0), ZEN3)).toBeCloseTo(0.35, 5)
  })
})

describe('decodeIntelVoltage (IA32_PERF_STATUS)', () => {
  it('lê o campo alto em passos de 1/8192 V', () => {
    expect(decodeIntelVoltage(intelField(1.25) << 16n)).toBeCloseTo(1.25, 5)
    const field = intelField(1.35)
    expect(decodeIntelVoltage((field << 16n) | 0xffffn)).toBe(Number(field) / 8192)
  })

  it('usa o campo baixo quando o alto é zero (fallback do LHM)', () => {
    const field = intelField(1.2)
    expect(decodeIntelVoltage(field)).toBe(Number(field) / 8192)
  })

  it('leitura fora de 0,3–1,8 V ou ausente vira null', () => {
    expect(decodeIntelVoltage(0n)).toBeNull()
    expect(decodeIntelVoltage(intelField(0.1))).toBeNull()
    expect(decodeIntelVoltage(intelField(2.4))).toBeNull()
    expect(decodeIntelVoltage(null)).toBeNull()
    expect(decodeIntelVoltage(undefined)).toBeNull()
    expect(decodeIntelVoltage(-1)).toBeNull()
  })
})

describe('readCpuFamilyModel', () => {
  it.runIf(process.platform === 'win32')('lê o registro UMA vez e cacheia a resposta', async () => {
    mockRegOutput(IDENTIFIER_OUTPUT)
    await expect(readCpuFamilyModel()).resolves.toEqual({ family: 25, model: 33 })
    await expect(readCpuFamilyModel()).resolves.toEqual({ family: 25, model: 33 })
    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(execFileMock.mock.lastCall?.[0]).toBe('reg.exe')
    expect(execFileMock.mock.lastCall?.[1]).toEqual([
      'query',
      'HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0',
      '/v',
      'Identifier'
    ])
  })

  it.runIf(process.platform === 'win32')(
    'falha nunca lança: vira null e pode ser reavaliada',
    async () => {
      mockRegOutput('', new Error('reg.exe indisponível'))
      await expect(readCpuFamilyModel()).resolves.toBeNull()

      resetCpuFamilyModelCacheForTests()
      mockRegOutput(IDENTIFIER_OUTPUT)
      await expect(readCpuFamilyModel()).resolves.toEqual({ family: 25, model: 33 })
    }
  )
})
