import type { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { CATERPILLAR_PART_NAMES, buildCaterpillar } from './caterpillar'

describe('contrato de partes', () => {
  it('todo grupo de parte tem nome unico', () => {
    const build = buildCaterpillar({ outfit: 'scarf', accessories: ['antenna_glow'] })
    try {
      const names = Object.values(build.parts).map((group) => group.name)

      expect(Object.keys(build.parts).sort()).toEqual([...CATERPILLAR_PART_NAMES].sort())
      expect(new Set(names).size).toBe(names.length)
      for (const group of Object.values(build.parts)) {
        expect(group.name.startsWith('caterpillar-')).toBe(true)
        expect(build.root.getObjectByName(group.name)).toBe(group)
      }
    } finally {
      build.dispose()
    }
  })

  it('parts.body contem todos os segmentos e grupos estaveis', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      expect(build.parts.body).toBe(build.body)
      for (const segment of build.segments) {
        expect(build.parts.body.children).toContain(segment)
      }
      expect(build.parts.body.getObjectByName('caterpillar-belly')).not.toBeNull()
      expect(build.parts.body.getObjectByName('caterpillar-body-detail')).not.toBeNull()
    } finally {
      build.dispose()
    }
  })

  it('campos legados apontam para nos existentes no root', () => {
    const build = buildCaterpillar({
      outfit: 'collar',
      accessories: ['back_spikes', 'visor_hud'],
      seed: 11
    })
    try {
      const nodes = new Set<Object3D>()
      build.root.traverse((object) => nodes.add(object))

      const legacy: Object3D[] = [
        build.head,
        build.mouth,
        ...build.segments,
        ...build.eyeGroups,
        ...build.pupils,
        ...build.antennae,
        ...build.mandibles
      ]
      if (build.outfit) legacy.push(build.outfit)

      for (const node of legacy) {
        expect(nodes.has(node)).toBe(true)
      }

      for (const name of ['face', 'limbs', 'turban', 'pipe'] as const) {
        expect(build.parts[name].children).toHaveLength(0)
      }
    } finally {
      build.dispose()
    }
  })
})
