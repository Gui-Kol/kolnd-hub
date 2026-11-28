import { describe, expect, it } from 'vitest'
import type { FpsPidSample } from '../../shared/fps'
import { buildLiveReading, computeFps, normalizeFrametime } from './aggregate'

function sample(overrides: Partial<FpsPidSample> = {}): FpsPidSample {
  return { pid: 100, name: 'game.exe', presents: 144, frametimeMs: 6.944, ...overrides }
}

describe('computeFps', () => {
  it('converte presents da janela em FPS com uma casa', () => {
    expect(computeFps(144, 1000)).toBe(144)
    expect(computeFps(165, 1000)).toBe(165)
    expect(computeFps(60, 1000)).toBe(60)
    expect(computeFps(144, 500)).toBe(288)
    expect(computeFps(29, 1000)).toBe(29)
  })

  it('aplica a sanidade 0 < fps <= 1000', () => {
    expect(computeFps(0, 1000)).toBeNull()
    expect(computeFps(-1, 1000)).toBeNull()
    expect(computeFps(1000, 1000)).toBe(1000)
    expect(computeFps(1001, 1000)).toBeNull()
    expect(computeFps(144, 0)).toBeNull()
    expect(computeFps(Number.NaN, 1000)).toBeNull()
    expect(computeFps(144, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('normalizeFrametime', () => {
  it('arredonda para duas casas e rejeita fora da faixa', () => {
    expect(normalizeFrametime(6.944)).toBe(6.94)
    expect(normalizeFrametime(16.666)).toBe(16.67)
    expect(normalizeFrametime(0)).toBeNull()
    expect(normalizeFrametime(1001)).toBeNull()
    expect(normalizeFrametime(Number.NaN)).toBeNull()
  })
})

describe('buildLiveReading', () => {
  it('monta a leitura live só com valores plausíveis', () => {
    expect(buildLiveReading(sample(), 1000, 'EldenRing')).toEqual({
      state: 'live',
      fps: 144,
      frametimeMs: 6.94,
      processName: 'EldenRing'
    })
  })

  it('nome vazio, presents zero ou frametime inválido = null (nunca número)', () => {
    expect(buildLiveReading(sample(), 1000, '   ')).toBeNull()
    expect(buildLiveReading(sample({ presents: 0 }), 1000, 'game')).toBeNull()
    expect(buildLiveReading(sample({ frametimeMs: 0 }), 1000, 'game')).toBeNull()
    expect(buildLiveReading(sample({ frametimeMs: 5000 }), 1000, 'game')).toBeNull()
  })
})
