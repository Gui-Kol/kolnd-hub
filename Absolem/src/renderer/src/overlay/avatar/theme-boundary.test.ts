import { readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { THEME_PRESETS } from '../../../../shared/theme'

/**
 * Contrato da separação tema x lógica.
 *
 * Aparência é dado: uma cor, roupa ou preset novo não pode exigir mudar a
 * máquina de estados, o lip-sync ou a montagem da cena. O adaptador é a única
 * fronteira que interpreta `ThemeConfig`.
 */

const here = dirname(fileURLToPath(import.meta.url))

function sourceOf(file: string): string {
  return readFileSync(join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const PRESET_IDS = THEME_PRESETS.map((preset) => preset.id)

describe('fronteira tema x comportamento', () => {
  it('nenhum preset citado em expressions', () => {
    for (const file of ['expressions.ts', 'lipSync.ts', 'scene.ts']) {
      const source = sourceOf(file)
      expect(source).not.toMatch(/presetId/)
      for (const id of PRESET_IDS) {
        expect(source).not.toContain(`'${id}'`)
        expect(source).not.toContain(`"${id}"`)
      }
    }
  })

  it('nenhuma cor literal em caterpillar', () => {
    const source = sourceOf('caterpillar.ts')

    expect(source).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/)
    expect(source).not.toMatch(/\bcolor\s*:\s*0x[0-9a-fA-F]{3,8}/)
    expect(source).not.toMatch(/new Color\(/)
  })

  it('adaptador é o único que lê ThemeConfig', () => {
    const readsThemeFields =
      /theme\.(primaryColor|effectColor|bellyColor|detailColor|glowIntensity|outlineStrength|look|style|outfit|accessories|particleDensity|scale|reducedMotion)\b/
    const files = readdirSync(here).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts')
    )

    for (const file of files) {
      if (file === 'themeAdapter.ts') continue
      expect(sourceOf(file), `${file} não pode ler campos do tema`).not.toMatch(readsThemeFields)
    }

    expect(sourceOf('themeAdapter.ts')).toMatch(readsThemeFields)
  })
})
