import { describe, expect, it } from 'vitest'
import { applyThemePreset, normalizeTheme, THEME_PRESETS } from './theme'

describe('THEME_PRESETS', () => {
  it('seis presets com ids únicos', () => {
    expect(THEME_PRESETS).toHaveLength(6)
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(6)
    for (const preset of THEME_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0)
    }
  })

  it('todos passam pelo normalizador sem alteração', () => {
    for (const preset of THEME_PRESETS) {
      const expected = {
        version: 1,
        presetId: preset.id,
        ...preset.values
      }
      expect(normalizeTheme({ ...preset.values, presetId: preset.id })).toEqual(expected)
    }
  })

  it('aplicar preset não muta o objeto original', () => {
    const original = THEME_PRESETS[1]
    const before = JSON.stringify(original)

    const applied = applyThemePreset(original)
    applied.primaryColor = '#000000'
    applied.accessories.push('visor_hud')
    applied.style = 'wireframe'

    expect(JSON.stringify(original)).toBe(before)
    expect(applyThemePreset('neon')).toEqual({
      version: 1,
      presetId: 'neon',
      ...original.values
    })
  })
})
