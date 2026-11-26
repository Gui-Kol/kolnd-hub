import { describe, expect, it } from 'vitest'
import {
  MIN_BODY_ALPHA,
  clampBodyAlpha,
  contrastRatio,
  contrastWithOverlay,
  fixContrast,
  hasEnoughContrast
} from './contrast'

describe('contraste do avatar', () => {
  it('preto sobre fundo escuro falha', () => {
    expect(contrastRatio('#000000', '#0b0f14')).toBeLessThan(3)
    expect(hasEnoughContrast('#000000')).toBe(false)
    expect(contrastWithOverlay('#000000')).toBeLessThan(3)
  })

  it('cor clara passa', () => {
    expect(hasEnoughContrast('#e6edf3')).toBe(true)
    expect(contrastWithOverlay('#e6edf3')).toBeGreaterThan(3)
  })

  it('correção automática atinge 3:1', () => {
    const fixed = fixContrast('#000000')

    expect(contrastWithOverlay(fixed)).toBeGreaterThanOrEqual(3)
    // Cor que já passa não é alterada.
    expect(fixContrast('#e6edf3')).toBe('#e6edf3')
  })

  it('alfa mínimo é aplicado', () => {
    expect(clampBodyAlpha(0)).toBe(MIN_BODY_ALPHA)
    expect(clampBodyAlpha(-1)).toBe(MIN_BODY_ALPHA)
    expect(clampBodyAlpha(Number.NaN)).toBe(MIN_BODY_ALPHA)
    expect(clampBodyAlpha(0.5)).toBe(0.5)
    expect(clampBodyAlpha(2)).toBe(1)
  })
})
