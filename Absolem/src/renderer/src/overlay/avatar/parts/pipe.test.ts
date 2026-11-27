import { Box3, Mesh, Vector3 } from 'three'
import type { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import {
  MAX_CATERPILLAR_TRIANGLES,
  buildCaterpillar,
  createDefaultCaterpillarMaterials
} from '../caterpillar'
import { normalizePalette } from '../palettes'
import type { PartContext } from './types'
import { buildHeadPart } from './head'
import { scaleSkeleton } from './skeleton'
import { buildTurbanPart } from './turban'
import {
  PIPE_CONTROL_POINTS,
  PIPE_MOUTH_TOLERANCE,
  PIPE_SMOKE_DEFAULT_MOTES,
  PIPE_SMOKE_MAX_MOTES,
  PIPE_SMOKE_MIN_MOTES,
  buildPipePart
} from './pipe'

const PALETTE = normalizePalette(undefined)
const RADIUS = 0.22

function context(overrides: Partial<PartContext> = {}): PartContext {
  return {
    radius: RADIUS,
    materialFor: createDefaultCaterpillarMaterials('classic', {
      pipe: parseInt(PALETTE.pipe.slice(1), 16),
      hose: parseInt(PALETTE.hose.slice(1), 16),
      smoke: parseInt(PALETTE.smoke.slice(1), 16),
      turban: parseInt(PALETTE.turban.slice(1), 16),
      turbanStripe: parseInt(PALETTE.turbanStripe.slice(1), 16)
    }),
    palette: PALETTE,
    seed: 7,
    minimal: false,
    style: 'classic',
    segments: 9,
    curvature: 0.45,
    ...overrides
  }
}

function buildParts(overrides: Partial<PartContext> = {}) {
  const ctx = context(overrides)
  const head = buildHeadPart({ ...ctx, neck: scaleSkeleton(RADIUS).neck })
  const turban = buildTurbanPart({ ...ctx, head })
  const pipe = buildPipePart({ ...ctx, head, turban })
  return { head, turban, pipe }
}

function boxOf(object: Object3D): Box3 {
  object.updateWorldMatrix(true, true)
  return new Box3().setFromObject(object)
}

function mouthCorner(head: ReturnType<typeof buildHeadPart>): Vector3 {
  return head.mouth.position.clone().add(head.mouthCorners[1].position)
}

describe('cachimbo', () => {
  it('piteira termina perto do canto direito da boca', () => {
    const { head, turban, pipe } = buildParts()
    try {
      const corner = mouthCorner(head)
      expect(pipe.tip.distanceTo(corner)).toBeLessThan(PIPE_MOUTH_TOLERANCE)
      expect(pipe.mouthpiece.name).toBe('caterpillar-pipe-mouthpiece')
      expect(pipe.mouthpiece.userData.materialRole).toBe('pipe')
    } finally {
      pipe.dispose()
      turban.dispose()
      head.dispose()
    }
  })

  it('mangueira nao cruza o bounding box da cabeca', () => {
    const { head, turban, pipe } = buildParts()
    try {
      const headBox = boxOf(head.head).expandByScalar(pipe.hoseRadius + 1e-6)
      const turbanBox = boxOf(turban.group).expandByScalar(pipe.hoseRadius + 1e-6)
      const point = new Vector3()

      for (let index = 0; index <= 200; index += 1) {
        pipe.curve.getPointAt(index / 200, point)
        expect(headBox.containsPoint(point)).toBe(false)
        expect(turbanBox.containsPoint(point)).toBe(false)
      }
    } finally {
      pipe.dispose()
      turban.dispose()
      head.dispose()
    }
  })

  it('mangueira tem 5 a 7 pontos de controle', () => {
    const { head, turban, pipe } = buildParts()
    try {
      expect(pipe.controlPoints.length).toBe(PIPE_CONTROL_POINTS)
      expect(pipe.controlPoints.length).toBeGreaterThanOrEqual(5)
      expect(pipe.controlPoints.length).toBeLessThanOrEqual(7)
      expect(pipe.hose.name).toBe('caterpillar-pipe-hose')
      expect(pipe.hose.userData.materialRole).toBe('hose')
    } finally {
      pipe.dispose()
      turban.dispose()
      head.dispose()
    }
  })

  it('nao existe mesh de base/cenario', () => {
    const { head, turban, pipe } = buildParts()
    try {
      const meshes: Mesh[] = []
      pipe.group.traverse((object) => {
        if (object instanceof Mesh) meshes.push(object)
      })

      expect(meshes.length).toBeGreaterThan(0)
      for (const mesh of meshes) {
        expect(mesh.name.startsWith('caterpillar-pipe')).toBe(true)
        expect(mesh.name).not.toMatch(/base|cenario|scene|water|ground|bowl/i)
      }
    } finally {
      pipe.dispose()
      turban.dispose()
      head.dispose()
    }
  })

  it('forca 0 nao renderiza motes', () => {
    const { head, turban, pipe } = buildParts()
    try {
      expect(pipe.smoke.points.name).toBe('caterpillar-pipe-smoke')
      expect(PIPE_SMOKE_DEFAULT_MOTES).toBeGreaterThanOrEqual(PIPE_SMOKE_MIN_MOTES)
      expect(PIPE_SMOKE_DEFAULT_MOTES).toBeLessThanOrEqual(PIPE_SMOKE_MAX_MOTES)
      expect(pipe.smoke.count()).toBeGreaterThan(0)
      expect(pipe.smoke.count()).toBeLessThanOrEqual(PIPE_SMOKE_DEFAULT_MOTES)

      pipe.smoke.setStrength(0)
      expect(pipe.smoke.count()).toBe(0)
      expect(pipe.smoke.points.geometry.drawRange.count).toBe(0)

      pipe.smoke.setStrength(1)
      expect(pipe.smoke.count()).toBe(PIPE_SMOKE_DEFAULT_MOTES)
    } finally {
      pipe.dispose()
      turban.dispose()
      head.dispose()
    }
  })

  it('reduced motion zera motes', () => {
    const { head, turban, pipe } = buildParts()
    try {
      pipe.smoke.setStrength(1)
      expect(pipe.smoke.count()).toBeGreaterThan(0)

      pipe.smoke.setReducedMotion(true)
      expect(pipe.smoke.count()).toBe(0)
      expect(pipe.smoke.points.geometry.drawRange.count).toBe(0)
      pipe.smoke.setStrength(0.5)
      expect(pipe.smoke.count()).toBe(0)

      pipe.smoke.setReducedMotion(false)
      expect(pipe.smoke.count()).toBeGreaterThan(0)
    } finally {
      pipe.dispose()
      turban.dispose()
      head.dispose()
    }
  })

  it('dispose duas vezes nao lanca', () => {
    const { head, turban, pipe } = buildParts()
    try {
      expect(() => {
        pipe.dispose()
        pipe.dispose()
        pipe.smoke.dispose()
      }).not.toThrow()
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('triangulos <= MAX_CATERPILLAR_TRIANGLES', () => {
    const build = buildCaterpillar({ seed: 7 })
    try {
      expect(build.stats.triangles).toBeLessThanOrEqual(MAX_CATERPILLAR_TRIANGLES)
      expect(build.smoke).toBeDefined()
      expect(build.smoke.count()).toBeGreaterThan(0)
      expect(build.parts.pipe.getObjectByName('caterpillar-pipe-smoke')).toBe(build.smoke.points)
    } finally {
      build.dispose()
    }
  })
})
