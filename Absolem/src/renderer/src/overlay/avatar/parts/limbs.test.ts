import { Box3, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three'
import type { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import {
  buildCaterpillar,
  createDefaultCaterpillarMaterials,
  MAX_CATERPILLAR_TRIANGLES
} from '../caterpillar'
import { normalizePalette } from '../palettes'
import { buildBodyPart } from './body'
import { buildLimbsPart, HAND_FINGERS, buildHand } from './limbs'
import { scaleSkeleton } from './skeleton'
import type { PartContext } from './types'

const PALETTE = normalizePalette(undefined)

function partContext(overrides: Partial<PartContext> = {}): PartContext {
  const materialFor = createDefaultCaterpillarMaterials('classic', {
    hand: parseInt(PALETTE.hand.slice(1), 16),
    claw: parseInt(PALETTE.claw.slice(1), 16),
    sleeve: parseInt(PALETTE.sleeve.slice(1), 16)
  })

  return {
    radius: 0.22,
    materialFor,
    palette: PALETTE,
    seed: 7,
    minimal: false,
    style: 'classic',
    segments: 9,
    curvature: 0.45,
    ...overrides
  }
}

function descendants(root: Object3D, prefix: string): Object3D[] {
  const matches: Object3D[] = []
  root.traverse((object) => {
    if (object.name.startsWith(prefix)) matches.push(object)
  })
  return matches
}

function limbsContext(overrides: Partial<PartContext> = {}) {
  const ctx = partContext(overrides)
  const body = buildBodyPart(ctx)
  const bodyBaseY = body.bodyBaseY
  body.dispose()
  return { ...ctx, bodyBaseY }
}

describe('maos', () => {
  it('cada mao tem 3 dedos e 3 garras', () => {
    for (const side of ['left', 'right'] as const) {
      const hand = buildHand(partContext(), side)
      try {
        const fingers = descendants(hand, 'caterpillar-hand-finger-').filter(
          (object) => !object.name.endsWith('-shaft')
        )
        const claws = descendants(hand, 'caterpillar-hand-claw-')

        expect(fingers).toHaveLength(HAND_FINGERS)
        expect(claws).toHaveLength(HAND_FINGERS)
        expect(hand.getObjectByName('caterpillar-hand')).not.toBeNull()
      } finally {
        hand.traverse((object) => {
          if (object instanceof Mesh) object.geometry.dispose()
        })
      }
    }
  })

  it('garras ficam na ponta dos dedos', () => {
    const hand = buildHand(partContext(), 'right')
    try {
      hand.updateWorldMatrix(true, true)
      for (let index = 1; index <= HAND_FINGERS; index += 1) {
        const shaft = hand.getObjectByName(`caterpillar-hand-finger-${index}-shaft`)
        const claw = hand.getObjectByName(`caterpillar-hand-claw-${index}`)
        expect(shaft).toBeInstanceOf(Mesh)
        expect(claw).toBeInstanceOf(Mesh)
        if (!(shaft instanceof Mesh) || !(claw instanceof Mesh)) continue

        const shaftTop = new Box3().setFromObject(shaft).max.y
        const clawCenter = new Box3().setFromObject(claw).getCenter(claw.position.clone())
        expect(clawCenter.y).toBeGreaterThan(shaftTop - 0.006)
      }
    } finally {
      hand.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose()
      })
    }
  })

  it('mao direita tem angulo de aperto maior que a esquerda', () => {
    const left = buildHand(partContext(), 'left')
    const right = buildHand(partContext(), 'right')
    try {
      const leftAngle = (left.getObjectByName('caterpillar-hand-finger-1') as Object3D).rotation.x
      const rightAngle = (right.getObjectByName('caterpillar-hand-finger-1') as Object3D).rotation.x
      expect(rightAngle).toBeGreaterThan(leftAngle)
    } finally {
      for (const hand of [left, right]) {
        hand.traverse((object) => {
          if (object instanceof Mesh) object.geometry.dispose()
        })
      }
    }
  })

  it('mao usa as cores hand e claw da paleta', () => {
    const hand = buildHand(partContext(), 'left')
    try {
      const palm = hand.getObjectByName('caterpillar-hand')
      const claw = hand.getObjectByName('caterpillar-hand-claw-1')
      expect(palm).toBeInstanceOf(Mesh)
      expect(claw).toBeInstanceOf(Mesh)
      if (!(palm instanceof Mesh) || !(claw instanceof Mesh)) return

      const palmMaterial = palm.material as MeshBasicMaterial
      const clawMaterial = claw.material as MeshBasicMaterial
      expect(palmMaterial.color.getHex()).toBe(parseInt(PALETTE.hand.slice(1), 16))
      expect(clawMaterial.color.getHex()).toBe(parseInt(PALETTE.claw.slice(1), 16))
    } finally {
      hand.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose()
      })
    }
  })
})

describe('composicao dos membros', () => {
  it('parte dos membros expoe duas maos', () => {
    const limbs = buildLimbsPart(limbsContext())
    try {
      expect(limbs.group.name).toBe('caterpillar-limbs')
      expect(limbs.hands).toHaveLength(2)
      expect(limbs.hands.map((hand) => hand.name)).toEqual([
        'caterpillar-hand-left',
        'caterpillar-hand-right'
      ])
    } finally {
      limbs.dispose()
    }
  })
})

describe('pes', () => {
  it('4 pes', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      expect(build.feet).toHaveLength(4)
      expect(build.feet.map((foot) => foot.name)).toEqual([
        'caterpillar-foot-back-left',
        'caterpillar-foot-back-right',
        'caterpillar-foot-front-left',
        'caterpillar-foot-front-right'
      ])
    } finally {
      build.dispose()
    }
  })

  it('todos os pes tocam bodyBaseY dentro de 0.02', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      build.root.updateWorldMatrix(true, true)
      for (const foot of build.feet) {
        const bottom = new Box3().setFromObject(foot).min.y
        expect(Math.abs(bottom - build.stats.bodyBaseY)).toBeLessThanOrEqual(0.02)
      }
    } finally {
      build.dispose()
    }
  })

  it('pes ficam dentro da largura do quadril', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      build.root.updateWorldMatrix(true, true)
      const hip = new Box3().setFromObject(build.segments[0])
      for (const foot of build.feet) {
        const box = new Box3().setFromObject(foot)
        expect(box.min.x).toBeGreaterThanOrEqual(hip.min.x)
        expect(box.max.x).toBeLessThanOrEqual(hip.max.x)
      }
    } finally {
      build.dispose()
    }
  })
})

describe('integracao e descarte', () => {
  it('dispose duas vezes nao lanca', () => {
    const build = buildCaterpillar({ seed: 7 })
    build.dispose()
    expect(() => build.dispose()).not.toThrow()
  })

  it('rebuild troca a instancia de parts.limbs', () => {
    const first = buildCaterpillar({ seed: 7 })
    const second = buildCaterpillar({ seed: 7 })
    try {
      expect(second.parts.limbs).not.toBe(first.parts.limbs)
      expect(second.hands).not.toBe(first.hands)
      expect(second.hands[0]).not.toBe(first.hands[0])
      expect(second.feet).not.toBe(first.feet)
      expect(second.parts.limbs.getObjectByName('caterpillar-hand-left')).toBe(second.hands[0])
      expect(second.parts.limbs.getObjectByName('caterpillar-foot-back-left')).toBe(second.feet[0])
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('membros ficam dentro de parts.limbs no root', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      const nodes = new Set<Object3D>()
      build.root.traverse((object) => nodes.add(object))
      for (const node of [...build.hands, ...build.feet]) {
        expect(nodes.has(node)).toBe(true)
        expect(node.parent).toBe(build.parts.limbs)
      }
    } finally {
      build.dispose()
    }
  })
})

describe('paleta, nomes e orcamento', () => {
  it('minimal reduz dedos e remove garras', () => {
    const normal = buildCaterpillar({ seed: 7 })
    const minimal = buildCaterpillar({ seed: 7, minimal: true })
    try {
      for (const hand of normal.hands) {
        expect(descendants(hand, 'caterpillar-hand-claw-').length).toBeGreaterThan(0)
        expect(
          descendants(hand, 'caterpillar-hand-finger-').filter(
            (node) => !node.name.endsWith('-shaft')
          )
        ).toHaveLength(3)
      }
      for (const hand of minimal.hands) {
        expect(descendants(hand, 'caterpillar-hand-claw-')).toHaveLength(0)
        expect(
          descendants(hand, 'caterpillar-hand-finger-').filter(
            (node) => !node.name.endsWith('-shaft')
          )
        ).toHaveLength(2)
      }
      const minimalClaws: Object3D[] = []
      minimal.parts.limbs.traverse((object) => {
        if (object.name.includes('-claw')) minimalClaws.push(object)
      })
      expect(minimalClaws).toHaveLength(0)
    } finally {
      normal.dispose()
      minimal.dispose()
    }
  })

  it('nenhum material de membro usa cor fora da paleta', () => {
    const allowed = [PALETTE.hand, PALETTE.sleeve, PALETTE.claw].map((hex) =>
      parseInt(hex.slice(1), 16)
    )
    const build = buildCaterpillar({
      seed: 7,
      palette: {
        hand: allowed[0],
        sleeve: allowed[1],
        claw: allowed[2]
      }
    })
    try {
      const used = new Set<number>()
      build.parts.limbs.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if (material instanceof MeshBasicMaterial) used.add(material.color.getHex())
        }
      })

      expect(used.size).toBeGreaterThan(0)
      for (const color of used) expect(allowed).toContain(color)
    } finally {
      build.dispose()
    }
  })

  it('membros usam nomes caterpillar-*', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      build.parts.limbs.traverse((object) => {
        expect(object.name.startsWith('caterpillar-')).toBe(true)
      })
    } finally {
      build.dispose()
    }
  })

  it('triangulos <= MAX_CATERPILLAR_TRIANGLES', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      expect(build.stats.triangles).toBeGreaterThan(0)
      expect(build.stats.triangles).toBeLessThanOrEqual(MAX_CATERPILLAR_TRIANGLES)
    } finally {
      build.dispose()
    }
  })
})

describe('bracos e punhos', () => {
  it('2 bracos e 2 punhos', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      const names: string[] = []
      build.parts.limbs.traverse((object) => names.push(object.name))
      expect(names.filter((name) => /^caterpillar-arm-(left|right)$/.test(name))).toHaveLength(2)
      expect(names.filter((name) => /^caterpillar-wrist-(left|right)$/.test(name))).toHaveLength(2)
    } finally {
      build.dispose()
    }
  })

  it('braco esquerdo termina sobre a barriga (z > corpo)', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      build.root.updateWorldMatrix(true, true)
      const bodyBox = new Box3().setFromObject(build.parts.body)
      const leftHand = build.hands[0].getWorldPosition(new Vector3())

      expect(leftHand.z).toBeGreaterThan(bodyBox.max.z)
    } finally {
      build.dispose()
    }
  })

  it('braco direito termina acima da linha do ombro', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      const anchors = scaleSkeleton(0.22)
      const rightHand = build.hands[1].getWorldPosition(new Vector3())

      expect(rightHand.y).toBeGreaterThan(anchors.shoulderRight.y)
    } finally {
      build.dispose()
    }
  })

  it('nenhum braco atravessa o tronco (folga minima de 0.02)', () => {
    const ctx = partContext()
    const body = buildBodyPart(ctx)
    const limbs = buildLimbsPart({ ...ctx, bodyBaseY: body.bodyBaseY })
    const armRadius = ctx.radius * 0.16
    const margin = armRadius + 0.02
    const point = new Vector3()

    try {
      for (const side of ['left', 'right'] as const) {
        const curve = limbs.armCurves[side]
        for (let step = 7; step <= 20; step += 1) {
          curve.getPointAt(step / 20, point)
          for (const segment of body.segments) {
            const geometry = segment.geometry
            if (!(geometry instanceof SphereGeometry)) continue
            const baseRadius = geometry.parameters.radius
            const halfX = baseRadius * segment.scale.x + margin
            const halfY = baseRadius * segment.scale.y + margin
            const halfZ = baseRadius * segment.scale.z + margin
            const dx = (point.x - segment.position.x) / halfX
            const dy = (point.y - segment.position.y) / halfY
            const dz = (point.z - segment.position.z) / halfZ

            expect(
              dx * dx + dy * dy + dz * dz,
              `braco ${side} no segmento ${segment.name}`
            ).toBeGreaterThan(1)
          }
        }
      }
    } finally {
      body.dispose()
      limbs.dispose()
    }
  })
})
