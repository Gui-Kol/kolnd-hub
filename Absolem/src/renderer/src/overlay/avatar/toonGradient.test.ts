import { NearestFilter, UnsignedByteType } from 'three'
import { describe, expect, it } from 'vitest'
import {
  TOON_GRADIENT_LEVELS,
  createToonGradient,
  shouldCreateStorybookLights
} from './toonGradient'

describe('rampa toon (gradientMap)', () => {
  it('rampa tem 4 níveis', () => {
    const gradient = createToonGradient()
    try {
      const texture = gradient.texture
      const image = texture.image as { width: number; height: number; data: Uint8Array }
      expect(TOON_GRADIENT_LEVELS).toBe(4)
      expect(image.width).toBe(4)
      expect(image.height).toBe(1)
      expect(image.data.length).toBe(4 * 4)
      expect(texture.type).toBe(UnsignedByteType)
      expect(texture.generateMipmaps).toBe(false)
      // `needsUpdate = true` no three r187 incrementa `version` (setter puro).
      expect(texture.version).toBeGreaterThanOrEqual(1)

      // 4 níveis distintos, do mais escuro ao mais claro, com alfa cheio.
      const levels = [0, 1, 2, 3].map((index) => image.data[index * 4])
      expect(new Set(levels).size).toBe(4)
      expect([...levels].sort((a, b) => a - b)).toEqual(levels)
      for (let index = 0; index < 4; index += 1) {
        expect(image.data[index * 4 + 3]).toBe(255)
      }
    } finally {
      gradient.dispose()
    }
  })

  it('filtro é NearestFilter', () => {
    const gradient = createToonGradient()
    try {
      expect(gradient.texture.magFilter).toBe(NearestFilter)
      expect(gradient.texture.minFilter).toBe(NearestFilter)
    } finally {
      gradient.dispose()
    }
  })

  it('dispose não lança duas vezes', () => {
    const gradient = createToonGradient()
    expect(() => {
      gradient.dispose()
      gradient.dispose()
    }).not.toThrow()
  })
})

describe('decisão de luz por acabamento', () => {
  it('look holo não cria luz', () => {
    expect(shouldCreateStorybookLights('holo')).toBe(false)
  })

  it('look storybook cria luz', () => {
    expect(shouldCreateStorybookLights('storybook')).toBe(true)
  })
})
