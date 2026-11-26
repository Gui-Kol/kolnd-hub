import { describe, expect, it } from 'vitest'
import {
  RAM_AUTO_INTERVAL_DEFAULT_MINUTES,
  RAM_AUTO_INTERVAL_MAX_MINUTES,
  RAM_AUTO_INTERVAL_MIN_MINUTES,
  defaultRamAutoPrefs,
  normalizeRamAutoIntervalMinutes
} from './ram'

describe('constantes da otimização automática', () => {
  it('faixa de 1 a 60 minutos com padrão de 10', () => {
    expect(RAM_AUTO_INTERVAL_MIN_MINUTES).toBe(1)
    expect(RAM_AUTO_INTERVAL_MAX_MINUTES).toBe(60)
    expect(RAM_AUTO_INTERVAL_DEFAULT_MINUTES).toBe(10)
  })

  it('default liga/desliga desligado e intervalo de 10 minutos', () => {
    expect(defaultRamAutoPrefs()).toEqual({ enabled: false, intervalMinutes: 10 })
  })
})

describe('normalizeRamAutoIntervalMinutes', () => {
  it('preserva os limites e valores válidos', () => {
    expect(normalizeRamAutoIntervalMinutes(1)).toBe(1)
    expect(normalizeRamAutoIntervalMinutes(60)).toBe(60)
    expect(normalizeRamAutoIntervalMinutes(30)).toBe(30)
  })

  it('clampa valores fora da faixa', () => {
    expect(normalizeRamAutoIntervalMinutes(0)).toBe(1)
    expect(normalizeRamAutoIntervalMinutes(61)).toBe(60)
    expect(normalizeRamAutoIntervalMinutes(-5)).toBe(1)
    expect(normalizeRamAutoIntervalMinutes(600)).toBe(60)
  })

  it('arredonda para o inteiro mais próximo', () => {
    expect(normalizeRamAutoIntervalMinutes(10.6)).toBe(11)
    expect(normalizeRamAutoIntervalMinutes(10.4)).toBe(10)
    expect(normalizeRamAutoIntervalMinutes(1.2)).toBe(1)
  })

  it('volta ao padrão de 10 quando o valor não é um número finito', () => {
    expect(normalizeRamAutoIntervalMinutes(Number.NaN)).toBe(10)
    expect(normalizeRamAutoIntervalMinutes(Number.POSITIVE_INFINITY)).toBe(10)
    expect(normalizeRamAutoIntervalMinutes(Number.NEGATIVE_INFINITY)).toBe(10)
    // Strings não são convertidas de propósito: o IPC valida o tipo antes.
    expect(normalizeRamAutoIntervalMinutes('10')).toBe(10)
    expect(normalizeRamAutoIntervalMinutes(null)).toBe(10)
    expect(normalizeRamAutoIntervalMinutes(undefined)).toBe(10)
    expect(normalizeRamAutoIntervalMinutes({})).toBe(10)
  })
})
