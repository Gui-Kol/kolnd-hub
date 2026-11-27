import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_PRESET_ID,
  THEME_PRESETS,
  applyThemePreset,
  defaultTheme,
  normalizeTheme
} from './theme'

describe('THEME_PRESETS', () => {
  it('sete presets com ids únicos', () => {
    expect(THEME_PRESETS).toHaveLength(7)
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(7)
    for (const preset of THEME_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0)
    }
  })

  it('absolem1951 é o padrão', () => {
    expect(THEME_PRESETS[0].id).toBe('absolem1951')
    expect(DEFAULT_THEME_PRESET_ID).toBe('absolem1951')
    expect(defaultTheme()).toEqual(applyThemePreset('absolem1951'))
    expect(defaultTheme().presetId).toBe('absolem1951')
  })

  it('todos passam pelo normalizador sem alteração', () => {
    for (const preset of THEME_PRESETS) {
      const expected = {
        version: 2,
        presetId: preset.id,
        ...preset.values
      }
      expect(normalizeTheme({ ...preset.values, presetId: preset.id })).toEqual(expected)
    }
  })

  it('aplicar preset não muta o objeto original', () => {
    const original = THEME_PRESETS.find((preset) => preset.id === 'neon')
    if (!original) throw new Error('preset neon ausente')
    const before = JSON.stringify(original)

    const applied = applyThemePreset(original)
    applied.primaryColor = '#000000'
    applied.accessories.push('visor_hud')
    applied.style = 'wireframe'

    expect(JSON.stringify(original)).toBe(before)
    expect(applyThemePreset('neon')).toEqual({
      version: 2,
      presetId: 'neon',
      ...original.values
    })
  })
})
