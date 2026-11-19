import { describe, expect, it } from 'vitest'
import {
  AVATAR_SEXES,
  BODY_ROWS,
  defaultLookFor,
  HAIR_COLORS,
  HAIR_STYLES,
  isValidAvatarLook,
  isValidPaletteIndex,
  normalizeAvatarLook,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES
} from './officeAvatar'

const CHARACTER_WIDTH = 16

describe('paletas fixas da aparência', () => {
  it('respeita os mínimos curados e nomes/cores preenchidos', () => {
    expect(SKIN_TONES.length).toBeGreaterThanOrEqual(10)
    expect(HAIR_COLORS.length).toBeGreaterThanOrEqual(10)
    expect(SHIRT_COLORS.length).toBeGreaterThanOrEqual(10)
    expect(PANTS_COLORS.length).toBeGreaterThanOrEqual(8)
    expect(HAIR_STYLES).toHaveLength(6)
    expect(AVATAR_SEXES).toEqual(['feminino', 'masculino', 'neutro'])

    for (const list of [SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, PANTS_COLORS]) {
      for (const color of list) {
        expect(color.name.trim()).not.toBe('')
        expect(color.c).toMatch(/^#[0-9a-f]{6}$/i)
        expect(color.C).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('todas as grades de sprite têm largura consistente (16)', () => {
    for (const sex of AVATAR_SEXES) {
      expect(BODY_ROWS[sex]).toHaveLength(24)
      for (const row of BODY_ROWS[sex]) expect(row).toHaveLength(CHARACTER_WIDTH)
    }
    for (const style of HAIR_STYLES) {
      expect(style.name.trim()).not.toBe('')
      expect(style.rows.length).toBeGreaterThan(0)
      for (const row of style.rows) expect(row).toHaveLength(CHARACTER_WIDTH)
    }
  })
})

describe('defaultLookFor', () => {
  it('é determinístico e sempre dentro das paletas', () => {
    for (const seed of [0, 1, 42, 0xdeadbeef, 4_294_967_295]) {
      const first = defaultLookFor(seed)
      expect(defaultLookFor(seed)).toEqual(first)
      expect(AVATAR_SEXES).toContain(first.sex)
      expect(isValidPaletteIndex(first.hairStyle, HAIR_STYLES.length)).toBe(true)
      expect(isValidPaletteIndex(first.hairColor, HAIR_COLORS.length)).toBe(true)
      expect(isValidPaletteIndex(first.skin, SKIN_TONES.length)).toBe(true)
      expect(isValidPaletteIndex(first.shirt, SHIRT_COLORS.length)).toBe(true)
      expect(isValidPaletteIndex(first.pants, PANTS_COLORS.length)).toBe(true)
    }
  })

  it('seeds diferentes variam o personagem (sem look único)', () => {
    const looks = new Set(
      Array.from({ length: 24 }, (_, index) => JSON.stringify(defaultLookFor(index)))
    )
    expect(looks.size).toBeGreaterThan(8)
  })

  it('preserva as cores antigas: pele/camisa continuam nos mesmos tons', () => {
    // A seed antiga escolhia 4 skins e 7 camisas; o mapeamento usa os mesmos hex.
    const skinHex = new Set(SKIN_TONES.map((tone) => tone.c))
    const shirtHex = new Set(SHIRT_COLORS.map((color) => color.c))
    for (let seed = 0; seed < 50; seed++) {
      const look = defaultLookFor(seed)
      expect(skinHex.has(SKIN_TONES[look.skin].c)).toBe(true)
      expect(shirtHex.has(SHIRT_COLORS[look.shirt].c)).toBe(true)
      expect(skinHex.has('#f0c39b')).toBe(true)
    }
  })
})

describe('normalizeAvatarLook / isValidAvatarLook', () => {
  const valid = {
    sex: 'feminino' as const,
    hairStyle: 1,
    hairColor: 6,
    skin: 1,
    shirt: 0,
    pants: 0
  }

  it('aceita um look completo e devolve uma cópia', () => {
    const normalized = normalizeAvatarLook(valid)
    expect(normalized).toEqual(valid)
    expect(normalized).not.toBe(valid)
  })

  it('rejeita sexo desconhecido, índice fora da faixa e campos faltando', () => {
    expect(normalizeAvatarLook(null)).toBeNull()
    expect(normalizeAvatarLook([])).toBeNull()
    expect(normalizeAvatarLook({ ...valid, sex: 'outro' })).toBeNull()
    expect(normalizeAvatarLook({ ...valid, hairStyle: HAIR_STYLES.length })).toBeNull()
    expect(normalizeAvatarLook({ ...valid, hairColor: -1 })).toBeNull()
    expect(normalizeAvatarLook({ ...valid, skin: 1.5 })).toBeNull()
    expect(normalizeAvatarLook({ ...valid, shirt: '0' })).toBeNull()
    const { pants: _pants, ...withoutPants } = valid
    expect(normalizeAvatarLook(withoutPants)).toBeNull()
    expect(isValidAvatarLook({ ...valid, extra: true })).toBe(false)
  })
})
