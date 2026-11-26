import { describe, expect, it } from 'vitest'
import { CATERPILLAR_MATERIAL_ROLES } from './caterpillar'
import { ABSOLEM_1951_PALETTE, normalizePalette } from './palettes'

const ROLES = [...CATERPILLAR_MATERIAL_ROLES]

describe('paleta do personagem', () => {
  it('toda role tem entrada em ABSOLEM_1951_PALETTE', () => {
    for (const role of ROLES) {
      expect(ABSOLEM_1951_PALETTE[role]).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(Object.keys(ABSOLEM_1951_PALETTE)).toHaveLength(ROLES.length)
  })

  it('cor invalida cai no valor da referencia', () => {
    const palette = normalizePalette({
      body: 'azul',
      belly: '#12',
      head: 42,
      sclera: null
    })

    expect(palette.body).toBe(ABSOLEM_1951_PALETTE.body)
    expect(palette.belly).toBe(ABSOLEM_1951_PALETTE.belly)
    expect(palette.head).toBe(ABSOLEM_1951_PALETTE.head)
    expect(palette.sclera).toBe(ABSOLEM_1951_PALETTE.sclera)
  })

  it('paleta parcial devolve objeto completo', () => {
    const palette = normalizePalette({ body: '#123456', turban: '#AbCdEf' })

    expect(Object.keys(palette).sort()).toEqual([...ROLES].sort())
    expect(palette.body).toBe('#123456')
    expect(palette.turban).toBe('#abcdef')
    expect(palette.head).toBe(ABSOLEM_1951_PALETTE.head)

    const empty = normalizePalette(undefined)
    expect(Object.keys(empty).sort()).toEqual([...ROLES].sort())
    expect(empty).not.toBe(ABSOLEM_1951_PALETTE)
    expect(empty).toEqual(ABSOLEM_1951_PALETTE)
  })

  it('paleta nao tem chave fora de CATERPILLAR_MATERIAL_ROLES', () => {
    const palette = normalizePalette({
      body: '#123456',
      roleInexistente: '#ffffff',
      eye: '#ffffff'
    } as unknown)

    expect(Object.keys(palette).sort()).toEqual([...ROLES].sort())
    expect(palette).not.toHaveProperty('roleInexistente')
    expect(palette).not.toHaveProperty('eye')
  })
})
