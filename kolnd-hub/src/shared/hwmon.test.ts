import { describe, expect, it } from 'vitest'
import {
  HWMON_INTERVAL_DEFAULT_MS,
  HWMON_INTERVAL_MAX_MS,
  HWMON_INTERVAL_MIN_MS,
  HWMON_INTERVAL_STEP_MS,
  normalizeHwmonIntervalMs
} from './hwmon'

describe('constantes do intervalo do polling', () => {
  it('faixa de 0,1 s a 2,0 s com passo de 0,1 s e padrão de 0,5 s', () => {
    expect(HWMON_INTERVAL_MIN_MS).toBe(100)
    expect(HWMON_INTERVAL_MAX_MS).toBe(2000)
    expect(HWMON_INTERVAL_STEP_MS).toBe(100)
    expect(HWMON_INTERVAL_DEFAULT_MS).toBe(500)
  })
})

describe('normalizeHwmonIntervalMs', () => {
  it('volta ao default quando o valor não é um número finito', () => {
    expect(normalizeHwmonIntervalMs(undefined)).toBe(500)
    expect(normalizeHwmonIntervalMs(null)).toBe(500)
    // String não é convertida de propósito: o IPC valida tipo antes de usar.
    expect(normalizeHwmonIntervalMs('500')).toBe(500)
    expect(normalizeHwmonIntervalMs(Number.NaN)).toBe(500)
    expect(normalizeHwmonIntervalMs(Number.POSITIVE_INFINITY)).toBe(500)
    expect(normalizeHwmonIntervalMs(Number.NEGATIVE_INFINITY)).toBe(500)
    expect(normalizeHwmonIntervalMs({})).toBe(500)
  })

  it('aplica o piso de 100 ms', () => {
    expect(normalizeHwmonIntervalMs(0)).toBe(100)
    expect(normalizeHwmonIntervalMs(50)).toBe(100)
    expect(normalizeHwmonIntervalMs(-1000)).toBe(100)
    // O renderer trabalha em ms inteiros; 0,1 s vira 100 no piso.
    expect(normalizeHwmonIntervalMs(0.1)).toBe(100)
  })

  it('aplica o teto de 2000 ms', () => {
    expect(normalizeHwmonIntervalMs(2000)).toBe(2000)
    expect(normalizeHwmonIntervalMs(2001)).toBe(2000)
    expect(normalizeHwmonIntervalMs(5000)).toBe(2000)
  })

  it('arredonda ao passo de 100 ms', () => {
    expect(normalizeHwmonIntervalMs(149)).toBe(100)
    expect(normalizeHwmonIntervalMs(151)).toBe(200)
    expect(normalizeHwmonIntervalMs(249)).toBe(200)
    expect(normalizeHwmonIntervalMs(250)).toBe(300)
    expect(normalizeHwmonIntervalMs(1049)).toBe(1000)
  })

  it('preserva valores já válidos', () => {
    expect(normalizeHwmonIntervalMs(500)).toBe(500)
    expect(normalizeHwmonIntervalMs(1000)).toBe(1000)
    expect(normalizeHwmonIntervalMs(100)).toBe(100)
  })
})
