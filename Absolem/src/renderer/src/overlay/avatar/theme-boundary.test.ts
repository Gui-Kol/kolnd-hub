import { readdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { THEME_PRESETS } from '../../../../shared/theme'

/**
 * Contrato da separação tema x lógica.
 *
 * Aparência é dado: uma cor, preset ou roupa nova não pode exigir mudar a
 * máquina de estados nem a animação da bola. O adaptador é a única fronteira
 * que interpreta `ThemeConfig`; o core da bola conhece apenas `scale` e
 * `reducedMotion`, e as cores dos estados são fixas por decisão de produto.
 */

const here = dirname(fileURLToPath(import.meta.url))

function sourceOf(file: string): string {
  return readFileSync(join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

function sourceFiles(): string[] {
  return readdirSync(here).filter(
    (file) =>
      (file.endsWith('.ts') || file.endsWith('.tsx')) &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('.test.tsx')
  )
}

const PRESET_IDS = THEME_PRESETS.map((preset) => preset.id)

/** Paleta fixa da bola (task 27); só o core pode declará-la. */
const STATE_COLORS = ['#3b82f6', '#22c55e', '#eab308', '#f59e0b', '#ef4444']

describe('fronteira tema x comportamento', () => {
  it('nenhum preset citado no core da bola', () => {
    for (const file of ['ball.ts', 'index.ts', 'themeAdapter.ts', 'fallback.ts', 'looks.ts']) {
      const source = sourceOf(file)
      expect(source).not.toMatch(/presetId/)
      for (const id of PRESET_IDS) {
        expect(source, `${file} citou o preset ${id}`).not.toContain(`'${id}'`)
        expect(source, `${file} citou o preset ${id}`).not.toContain(`"${id}"`)
      }
    }
  })

  it('as cores fixas moram no core da bola', () => {
    const ball = sourceOf('ball.ts')
    for (const color of STATE_COLORS) expect(ball).toContain(`'${color}'`)

    for (const file of sourceFiles()) {
      if (file === 'ball.ts') continue
      const source = sourceOf(file)
      for (const color of STATE_COLORS) {
        expect(source, `${file} não pode declarar a cor de estado ${color}`).not.toContain(color)
      }
    }
  })

  it('adaptador é o único que lê ThemeConfig', () => {
    const readsThemeFields =
      /theme\.(primaryColor|effectColor|bellyColor|detailColor|glowIntensity|outlineStrength|look|style|outfit|accessories|particleDensity|scale|reducedMotion)\b/

    for (const file of sourceFiles()) {
      if (file === 'themeAdapter.ts') continue
      expect(sourceOf(file), `${file} não pode ler campos do tema`).not.toMatch(readsThemeFields)
    }

    const adapter = sourceOf('themeAdapter.ts')
    expect(adapter).toMatch(/theme\.scale\b/)
    expect(adapter).toMatch(/theme\.reducedMotion\b/)
    expect(adapter).not.toMatch(
      /theme\.(primaryColor|effectColor|bellyColor|detailColor|glowIntensity|outlineStrength|look|style|outfit|accessories|particleDensity)\b/
    )
  })

  it('nenhum módulo do avatar importa three', () => {
    for (const file of sourceFiles()) {
      expect(sourceOf(file), `${file} não pode importar three`).not.toMatch(/from ['"]three['"]/)
    }
  })
})
