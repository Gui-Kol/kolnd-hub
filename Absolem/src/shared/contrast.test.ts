import { describe, expect, it } from 'vitest'
import {
  MIN_BODY_ALPHA,
  clampBodyAlpha,
  contrastRatio,
  contrastWithOverlay,
  fixContrast,
  hasEnoughContrast,
  themeContrastIssues,
  themeContrastWarnings
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

  it('barriga clara sobre corpo escuro passa', () => {
    const issues = themeContrastIssues({
      primaryColor: '#1f7f96',
      bellyColor: '#ade4ef',
      detailColor: '#ade4ef'
    })

    expect(issues.filter((issue) => issue.color === 'belly')).toEqual([])
    expect(
      themeContrastWarnings({
        primaryColor: '#1f7f96',
        bellyColor: '#ade4ef',
        detailColor: '#ade4ef'
      }).some((warning) => warning.includes('barriga'))
    ).toBe(false)
  })

  it('detalhe sem contraste gera aviso', () => {
    const issues = themeContrastIssues({
      primaryColor: '#1f7f96',
      bellyColor: '#ade4ef',
      detailColor: '#1f7f96'
    })
    const detailOnBody = issues.find(
      (issue) => issue.color === 'detail' && issue.background === 'body'
    )

    expect(detailOnBody?.ratio).toBe(1)
    expect(
      themeContrastWarnings({
        primaryColor: '#1f7f96',
        bellyColor: '#ade4ef',
        detailColor: '#1f7f96'
      })
    ).toContain('A cor dos detalhes tem contraste 1.0:1 com o corpo (mínimo 3:1).')
  })
})
