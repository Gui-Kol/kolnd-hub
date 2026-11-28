import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BELLY_COLOR,
  DEFAULT_DETAIL_COLOR,
  DEFAULT_EFFECT_COLOR,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_THEME_LOOK,
  DEFAULT_THEME_OUTLINE_STRENGTH,
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
        'bellyColor',
        'detailColor',
        'effectColor',
        'glowIntensity',
        'look',
        'outlineStrength',
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

  it('tema v1 vira v2 completo', () => {
    const v1 = {
      version: 1,
      presetId: 'classic',
      primaryColor: '#3b82f6',
      effectColor: '#93c5fd',
      glowIntensity: 0.7,
      style: 'classic',
      outfit: 'none',
      accessories: [],
      particleDensity: 'medium',
      scale: 1,
      reducedMotion: false
    }

    const theme = normalizeTheme(v1)

    expect(theme.version).toBe(2)
    expect(theme.presetId).toBe('classic')
    expect(theme.primaryColor).toBe('#3b82f6')
    expect(theme.effectColor).toBe('#93c5fd')
    expect(theme.look).toBe(DEFAULT_THEME_LOOK)
    expect(theme.bellyColor).toBe(DEFAULT_BELLY_COLOR)
    expect(theme.detailColor).toBe(DEFAULT_DETAIL_COLOR)
    expect(theme.outlineStrength).toBe(DEFAULT_THEME_OUTLINE_STRENGTH)
    expect(themeNormalizationWarnings(v1)).toEqual([])
  })

  it('look inválido cai em storybook', () => {
    expect(normalizeTheme({ look: 'neon' }).look).toBe('storybook')
    expect(themeNormalizationWarnings({ look: 'neon' })).toEqual([
      'Acabamento desconhecido; o padrão foi aplicado.'
    ])
  })

  it('outlineStrength fora da faixa é limitado', () => {
    expect(normalizeTheme({ outlineStrength: -1 }).outlineStrength).toBe(0)
    expect(normalizeTheme({ outlineStrength: 4 }).outlineStrength).toBe(1)
    expect(normalizeTheme({ outlineStrength: 'firme' }).outlineStrength).toBe(
      DEFAULT_THEME_OUTLINE_STRENGTH
    )
    expect(themeNormalizationWarnings({ outlineStrength: 4 })).toEqual([
      'Contorno fora da faixa 0..1; o valor foi ajustado.'
    ])
  })

  it('cores novas aceitam #RGB', () => {
    const theme = normalizeTheme({ bellyColor: '#aef', detailColor: '#F09' })

    expect(theme.bellyColor).toBe('#aaeeff')
    expect(theme.detailColor).toBe('#ff0099')
    expect(themeNormalizationWarnings({ bellyColor: '#aef', detailColor: '#F09' })).toEqual([])
  })

  it('normalizar duas vezes é idempotente', () => {
    const once = normalizeTheme({
      version: 1,
      primaryColor: '#1f7f96',
      look: 'holo',
      bellyColor: '#ade4ef',
      detailColor: '#f06292',
      outlineStrength: 0.4,
      accessories: ['antenna_glow']
    })

    expect(normalizeTheme(once)).toEqual(once)
    expect(themeNormalizationWarnings(once)).toEqual([])
  })
})
