import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { normalizeTheme } from '../../../../shared/theme'
import { clampBallScale, toBallTheme } from './themeAdapter'

const here = dirname(fileURLToPath(import.meta.url))

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('toBallTheme', () => {
  it('extrai só escala e movimento reduzido', () => {
    const params = toBallTheme(normalizeTheme({ primaryColor: '#f8fafc', scale: 1.2 }))

    expect(params).toEqual({ scale: 1.2, reducedMotion: false })
    expect(Object.keys(params).sort()).toEqual(['reducedMotion', 'scale'])
  })

  it('limita a escala à faixa do schema', () => {
    expect(toBallTheme(normalizeTheme({ scale: 0.2 })).scale).toBe(0.8)
    expect(toBallTheme(normalizeTheme({ scale: 3 })).scale).toBe(1.5)
    expect(clampBallScale(Number.NaN)).toBe(1)
    expect(clampBallScale(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('mantém reduced motion booleano', () => {
    expect(toBallTheme(normalizeTheme({ reducedMotion: true })).reducedMotion).toBe(true)
    expect(toBallTheme(normalizeTheme({ reducedMotion: 'sim' })).reducedMotion).toBe(false)
  })

  it('o adaptador não lê estado nem cores', () => {
    const source = stripComments(readFileSync(join(here, 'themeAdapter.ts'), 'utf8'))

    expect(source).not.toMatch(/AvatarState|AvatarApplyPush/)
    expect(source).not.toMatch(/level|colorForState|ballVisualFrame/)
    // Assinatura de um único argumento: o estado não tem por onde entrar.
    expect(toBallTheme.length).toBe(1)
    const params = toBallTheme(normalizeTheme(undefined))
    expect(params).not.toHaveProperty('state')
    expect(params).not.toHaveProperty('level')
  })
})
