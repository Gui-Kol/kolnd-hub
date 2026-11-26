import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { normalizeTheme } from '../../../../shared/theme'
import {
  MIN_BODY_ALPHA,
  PARTICLE_COUNT_BY_DENSITY,
  clampBodyAlpha,
  toAvatarParams
} from './themeAdapter'

const here = dirname(fileURLToPath(import.meta.url))

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('toAvatarParams', () => {
  it('tema claro e escuro geram uniforms distintos', () => {
    const light = toAvatarParams(normalizeTheme({ primaryColor: '#f8fafc' }))
    const dark = toAvatarParams(normalizeTheme({ primaryColor: '#0b1220' }))

    expect(light.primary.r).not.toBe(dark.primary.r)
    expect(light.primary.hex).toBe('#f8fafc')
    expect(dark.primary.hex).toBe('#0b1220')
    // Cores em linear RGB: um hex claro fica perto de 1, o escuro perto de 0.
    expect(light.primary.r).toBeGreaterThan(0.9)
    expect(dark.primary.r).toBeLessThan(0.01)
  })

  it('wireframe desliga o preenchimento', () => {
    const params = toAvatarParams(normalizeTheme({ style: 'wireframe' }))

    expect(params.geometry.wireframe).toBe(true)
    expect(params.geometry.fill).toBe(false)
    expect(params.style).toBe('wireframe')
  })

  it('densidade off gera zero partículas', () => {
    const params = toAvatarParams(normalizeTheme({ particleDensity: 'off' }))

    expect(params.particles.count).toBe(0)
    expect(params.particles.density).toBe('off')
    expect(PARTICLE_COUNT_BY_DENSITY.high).toBeGreaterThan(PARTICLE_COUNT_BY_DENSITY.medium)
    expect(clampBodyAlpha(0)).toBe(MIN_BODY_ALPHA)
    expect(clampBodyAlpha(0.5)).toBe(0.5)
  })

  it('o adaptador não lê estado', () => {
    const source = stripComments(readFileSync(join(here, 'themeAdapter.ts'), 'utf8'))

    expect(source).not.toMatch(/AvatarState|AvatarApplyPush/)
    expect(source).not.toMatch(/expressions|lipSync/)
    // Assinatura de um único argumento: o estado não tem por onde entrar.
    expect(toAvatarParams.length).toBe(1)
    const params = toAvatarParams(normalizeTheme(undefined))
    expect(params).not.toHaveProperty('state')
    expect(params).not.toHaveProperty('level')
  })
})
