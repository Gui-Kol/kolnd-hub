import { AdditiveBlending, Color } from 'three'
import { describe, expect, it } from 'vitest'
import { computeHoloAlpha, createHoloMaterial } from './holoMaterial'
import { PARTICLE_MAX, PARTICLE_MIN, createParticles, resolveParticleCount } from './particles'

describe('material de holograma', () => {
  it('uniforms de cor e tempo existem', () => {
    const material = createHoloMaterial({ color: '#3b82f6' })
    try {
      expect(material.uniforms.uTime).toBeDefined()
      expect(material.uniforms.uTime.value).toBe(0)
      expect(material.uniforms.uColor.value).toBeInstanceOf(Color)
      expect((material.uniforms.uColor.value as Color).getHexString()).toBe('3b82f6')
      expect(material.uniforms.uIntensity.value).toBe(1)
      expect(material.uniforms.uScanlineSpeed.value).toBeGreaterThan(0)

      expect(material.transparent).toBe(true)
      expect(material.depthWrite).toBe(false)
      expect(material.blending).toBe(AdditiveBlending)
      expect(material.vertexShader).toContain('vNormal')
      expect(material.fragmentShader).toContain('fresnel')
      expect(material.fragmentShader).toContain('scanline')
    } finally {
      material.dispose()
    }
  })

  it('intensidade 0 desliga o brilho', () => {
    expect(computeHoloAlpha({ intensity: 0, fresnel: 1, scanline: 1, noise: 1 })).toBe(0)
    expect(computeHoloAlpha({ intensity: 1, fresnel: 1, scanline: 0, noise: 0 })).toBeGreaterThan(0)

    const material = createHoloMaterial({ intensity: 0 })
    try {
      material.uniforms.uIntensity.value = 0
      const alpha = computeHoloAlpha({
        intensity: material.uniforms.uIntensity.value as number,
        fresnel: 1,
        scanline: 1,
        noise: 1
      })
      expect(alpha).toBe(0)
    } finally {
      material.dispose()
    }
  })

  it('densidade de partículas respeita o limite', () => {
    expect(resolveParticleCount()).toBeGreaterThanOrEqual(PARTICLE_MIN)
    expect(resolveParticleCount()).toBeLessThanOrEqual(PARTICLE_MAX)
    expect(resolveParticleCount(10_000)).toBe(PARTICLE_MAX)
    expect(resolveParticleCount(1)).toBe(PARTICLE_MIN)
    // Degradação: metade da base, mesmo abaixo do mínimo normal.
    expect(resolveParticleCount(180, { half: true })).toBe(90)
    // Movimento reduzido: nenhuma partícula.
    expect(resolveParticleCount(180, { reducedMotion: true })).toBe(0)

    const system = createParticles({ count: 10_000 })
    try {
      expect(system.count()).toBe(PARTICLE_MAX)
      expect(system.points.geometry.drawRange.count).toBe(system.count())

      system.setCount(10_000)
      expect(system.count()).toBe(PARTICLE_MAX)
      expect(system.points.geometry.drawRange.count).toBe(PARTICLE_MAX)
    } finally {
      system.dispose()
    }

    const base = createParticles()
    try {
      expect(base.count()).toBeGreaterThanOrEqual(PARTICLE_MIN)
      expect(base.count()).toBeLessThanOrEqual(PARTICLE_MAX)
    } finally {
      base.dispose()
    }

    const reduced = createParticles({ reducedMotion: true })
    try {
      expect(reduced.count()).toBe(0)
      expect(reduced.points.geometry.drawRange.count).toBe(0)
    } finally {
      reduced.dispose()
    }
  })
})
