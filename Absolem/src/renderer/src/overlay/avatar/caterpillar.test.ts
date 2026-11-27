import { describe, expect, it } from 'vitest'
import {
  CATERPILLAR_LOW_DETAIL_SEGMENTS,
  MAX_CATERPILLAR_TRIANGLES,
  buildCaterpillar
} from './caterpillar'
import type { CaterpillarOutfit } from './caterpillar'

describe('buildCaterpillar', () => {
  it('gera entre 7 e 9 segmentos', () => {
    const normal = buildCaterpillar()
    try {
      expect(normal.stats.segments).toBeGreaterThanOrEqual(7)
      expect(normal.stats.segments).toBeLessThanOrEqual(9)
      expect(normal.segments).toHaveLength(normal.stats.segments)
      expect(normal.stats.triangles).toBeGreaterThan(0)
      expect(normal.stats.triangles).toBeLessThan(MAX_CATERPILLAR_TRIANGLES)
    } finally {
      normal.dispose()
    }

    const high = buildCaterpillar({ segments: 42 })
    const low = buildCaterpillar({ segments: 1 })
    try {
      expect(high.stats.segments).toBe(9)
      expect(low.stats.segments).toBe(7)
    } finally {
      high.dispose()
      low.dispose()
    }

    // A degradação (T7) usa o mesmo construtor com o corpo mínimo explícito.
    const degraded = buildCaterpillar({ minimal: true })
    try {
      expect(degraded.stats.segments).toBe(CATERPILLAR_LOW_DETAIL_SEGMENTS)
    } finally {
      degraded.dispose()
    }
  })

  it('outfit desconhecido não quebra a geração', () => {
    const build = buildCaterpillar({
      outfit: 'sombrero' as CaterpillarOutfit,
      style: 'inexistente',
      seed: 3
    })
    try {
      expect(build.stats.outfit).toBe('none')
      expect(build.outfit).toBeNull()
      expect(build.stats.style).toBe('classic')
      expect(build.segments.length).toBe(build.stats.segments)
      expect(build.head.name).toBe('caterpillar-head')
    } finally {
      build.dispose()
    }

    for (const outfit of ['scarf', 'collar', 'visor'] as const) {
      const withOutfit = buildCaterpillar({ outfit })
      try {
        expect(withOutfit.outfit).not.toBeNull()
        expect(withOutfit.stats.outfit).toBe(outfit)
      } finally {
        withOutfit.dispose()
      }
    }
  })

  it('contagem de vértices estável para a mesma seed', () => {
    const first = buildCaterpillar({ seed: 2026 })
    const second = buildCaterpillar({ seed: 2026 })
    try {
      expect(first.stats.vertices).toBe(second.stats.vertices)
      expect(first.stats.triangles).toBe(second.stats.triangles)
      expect(first.stats.vertices).toBeGreaterThan(0)
      expect(first.segments.map((segment) => segment.position.y)).toEqual(
        second.segments.map((segment) => segment.position.y)
      )
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('contrato facial mantem olhos, palpebras, sobrancelhas, boca e mandibulas', () => {
    const build = buildCaterpillar({ seed: 5 })
    try {
      expect(build.eyeGroups).toHaveLength(2)
      expect(build.pupils).toHaveLength(2)
      expect(build.lids).toHaveLength(2)
      expect(build.brows).toHaveLength(2)
      expect(build.mouthCorners).toHaveLength(2)
      expect(build.mandibles).toHaveLength(2)
      expect(build.mouth.name).toBe('caterpillar-mouth')
      expect(build.jaw.name).toBe('caterpillar-jaw')
      // Justificativa T6: no look novo as antenas podem ficar escondidas sob
      // o turbante (task 18). O contrato aceita 0 ou 2, nunca outra quantidade.
      expect([0, 2]).toContain(build.antennae.length)
    } finally {
      build.dispose()
    }
  })
})
