import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EFFECT_COLOR,
  DEFAULT_PRIMARY_COLOR,
  THEME_SCALE_MAX,
  THEME_SCALE_MIN,
  defaultTheme,
  normalizeTheme,
  themeNormalizationWarnings
} from './theme'

describe('normalizeTheme', () => {
  it('cor inválida cai no default', () => {
    const theme = normalizeTheme({
      primaryColor: '#12',
      effectColor: 'azul'
    })

    expect(theme.primaryColor).toBe(DEFAULT_PRIMARY_COLOR)
    expect(theme.effectColor).toBe(DEFAULT_EFFECT_COLOR)
    expect(themeNormalizationWarnings({ primaryColor: '#12' })[0]).toContain('Cor principal')
  })

  it('cor #RGB vira #RRGGBB', () => {
    const theme = normalizeTheme({ primaryColor: '#ABC', effectColor: ' #0f0 ' })

    expect(theme.primaryColor).toBe('#aabbcc')
    expect(theme.effectColor).toBe('#00ff00')
    expect(themeNormalizationWarnings({ primaryColor: '#ABC', effectColor: ' #0f0 ' })).toEqual([])
  })

  it('accessory desconhecido é descartado', () => {
    const theme = normalizeTheme({
      accessories: ['antenna_glow', 'sombrero', 'antenna_glow', 42, 'back_spikes']
    })

    expect(theme.accessories).toEqual(['antenna_glow', 'back_spikes'])
    expect(themeNormalizationWarnings({ accessories: ['antenna_glow', 'sombrero'] })).toEqual([
      'Acessórios desconhecidos foram descartados.'
    ])
  })

  it('scale fora da faixa é limitado', () => {
    expect(normalizeTheme({ scale: 5 }).scale).toBe(THEME_SCALE_MAX)
    expect(normalizeTheme({ scale: 0.1 }).scale).toBe(THEME_SCALE_MIN)
    expect(normalizeTheme({ scale: 'grande' }).scale).toBe(1)
  })

  it('objeto vazio devolve o tema padrão completo', () => {
    const theme = normalizeTheme({})

    expect(theme).toEqual(defaultTheme())
    expect(Object.keys(theme).sort()).toEqual(
      [
        'accessories',
        'effectColor',
        'glowIntensity',
        'outfit',
        'particleDensity',
        'presetId',
        'primaryColor',
        'reducedMotion',
        'scale',
        'style',
        'version'
      ].sort()
    )
  })
})
