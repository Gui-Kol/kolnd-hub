import { describe, expect, it } from 'vitest'
import {
  IDLE_FRACTION,
  LOAD_EXPONENT,
  LOAD_FRACTION,
  PLATFORM_W,
  TDP_BASE_W,
  TDP_MAX_W,
  TDP_MIN_W,
  TDP_PER_CORE_W,
  estimateCpuWatts,
  estimatePlatformWatts,
  estimateTotalWatts,
  tdpClassWatts
} from './powerEstimate'

/**
 * Testes do modelo de estimativa — ponteiro fixo para a fórmula documentada.
 * Os valores esperados foram calculados à mão a partir das constantes; se a
 * fórmula mudar, estes testes devem mudar junto (e a nota da UI também).
 */
describe('tdpClassWatts', () => {
  it('segue 35 W + 4,5 W por núcleo dentro da faixa', () => {
    expect(tdpClassWatts(8)).toBe(71) // 5700X desta máquina
    expect(tdpClassWatts(4)).toBe(53)
    expect(tdpClassWatts(6)).toBe(62)
  })

  it('limita a classe à faixa 45–150 W', () => {
    expect(tdpClassWatts(1)).toBe(TDP_MIN_W)
    expect(tdpClassWatts(2)).toBe(TDP_MIN_W)
    expect(tdpClassWatts(32)).toBe(TDP_MAX_W)
    expect(tdpClassWatts(1000)).toBe(TDP_MAX_W)
  })

  it('devolve null para contagem de núcleos inválida', () => {
    expect(tdpClassWatts(null)).toBeNull()
    expect(tdpClassWatts(undefined)).toBeNull()
    expect(tdpClassWatts(0)).toBeNull()
    expect(tdpClassWatts(-8)).toBeNull()
    expect(tdpClassWatts(8.5)).toBeNull()
    expect(tdpClassWatts(Number.NaN)).toBeNull()
    expect(tdpClassWatts(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('estimateCpuWatts', () => {
  it('usa 25% da classe em 0% de uso', () => {
    // 71 × 0,25 = 17,75 → 17,8 W
    expect(estimateCpuWatts({ cores: 8, usagePercent: 0 })).toBe(17.8)
  })

  it('fica entre o piso ocioso e a classe nos usos intermediários', () => {
    expect(estimateCpuWatts({ cores: 8, usagePercent: 50 })).toBe(40.9)
    expect(estimateCpuWatts({ cores: 8, usagePercent: 25.44 })).toBe(28.1)
  })

  it('atinge no máximo a classe térmica em 100% de uso', () => {
    expect(estimateCpuWatts({ cores: 8, usagePercent: 100 })).toBe(71)
    expect(estimateCpuWatts({ cores: 16, usagePercent: 100 })).toBe(tdpClassWatts(16))
  })

  it('limita uso fora da faixa em vez de descartar a leitura', () => {
    expect(estimateCpuWatts({ cores: 8, usagePercent: 150 })).toBe(
      estimateCpuWatts({ cores: 8, usagePercent: 100 })
    )
    expect(estimateCpuWatts({ cores: 8, usagePercent: -20 })).toBe(
      estimateCpuWatts({ cores: 8, usagePercent: 0 })
    )
  })

  it('devolve null sem núcleos ou sem uso válido', () => {
    expect(estimateCpuWatts({ cores: null, usagePercent: 50 })).toBeNull()
    expect(estimateCpuWatts({ cores: 8, usagePercent: null })).toBeNull()
    expect(estimateCpuWatts({ cores: 8, usagePercent: Number.NaN })).toBeNull()
    expect(estimateCpuWatts({ cores: 8, usagePercent: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('as constantes exportadas descrevem a fórmula', () => {
    expect(TDP_BASE_W + TDP_PER_CORE_W * 8).toBe(71)
    expect(IDLE_FRACTION + LOAD_FRACTION).toBe(1)
    expect(LOAD_EXPONENT).toBe(1.2)
  })
})

describe('estimatePlatformWatts', () => {
  it('é a constante documentada de 30 W', () => {
    expect(estimatePlatformWatts()).toBe(PLATFORM_W)
  })
})

describe('estimateTotalWatts', () => {
  it('soma CPU estimada + GPU medida + plataforma (26,21 W da GPU desta máquina)', () => {
    // 40,9 + 26,21 + 30 = 97,11 → 97,1 W
    expect(estimateTotalWatts({ cpuEstimatedW: 40.9, gpuW: 26.21 })).toBe(97.1)
  })

  it('sem GPU medida o total é null — nunca soma um buraco', () => {
    expect(estimateTotalWatts({ cpuEstimatedW: 40.9, gpuW: null })).toBeNull()
    expect(estimateTotalWatts({ cpuEstimatedW: 40.9, gpuW: undefined })).toBeNull()
    expect(estimateTotalWatts({ cpuEstimatedW: 40.9, gpuW: Number.NaN })).toBeNull()
    expect(estimateTotalWatts({ cpuEstimatedW: 40.9, gpuW: -1 })).toBeNull()
  })

  it('sem estimativa de CPU o total é null', () => {
    expect(estimateTotalWatts({ cpuEstimatedW: null, gpuW: 26.21 })).toBeNull()
  })

  it('aceita plataforma customizada e rejeita valor inválido', () => {
    expect(estimateTotalWatts({ cpuEstimatedW: 40, gpuW: 20, platformW: 10 })).toBe(70)
    expect(estimateTotalWatts({ cpuEstimatedW: 40, gpuW: 20, platformW: Number.NaN })).toBeNull()
  })
})
