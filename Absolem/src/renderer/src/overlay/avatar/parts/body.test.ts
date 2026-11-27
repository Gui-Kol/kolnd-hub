import {
  Box3,
  BufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3
} from 'three'
import { describe, expect, it } from 'vitest'
import {
  CATERPILLAR_LOW_DETAIL_SEGMENTS,
  MAX_CATERPILLAR_TRIANGLES,
  buildCaterpillar,
  createDefaultCaterpillarMaterials
} from '../caterpillar'
import { normalizePalette } from '../palettes'
import { buildBodyPart } from './body'
import type { PartContext } from './types'

const PALETTE = normalizePalette(undefined)

function buildBody(overrides: Partial<PartContext> = {}) {
  const materialFor = createDefaultCaterpillarMaterials('classic', {
    body: parseInt(PALETTE.body.slice(1), 16),
    belly: parseInt(PALETTE.belly.slice(1), 16)
  })

  return buildBodyPart({
    radius: 0.22,
    materialFor,
    palette: PALETTE,
    seed: 7,
    minimal: false,
    style: 'classic',
    segments: 9,
    curvature: 0.45,
    ...overrides
  })
}

function boxOf(object: Object3D): Box3 {
  object.updateWorldMatrix(true, true)
  return new Box3().setFromObject(object)
}

function countVertices(body: ReturnType<typeof buildBody>): number {
  let total = 0
  body.group.traverse((object) => {
    if (object instanceof Mesh) total += object.geometry.attributes.position.count
  })
  return total
}

function segmentBox(body: ReturnType<typeof buildBody>): Box3 {
  const box = new Box3()
  for (const segment of body.segments) box.union(boxOf(segment))
  return box
}

describe('corpo sentado', () => {
  it('9 segmentos no modo normal e 5 no minimal', () => {
    const normal = buildBody()
    const minimal = buildBody({ minimal: true, segments: CATERPILLAR_LOW_DETAIL_SEGMENTS })
    try {
      expect(normal.segments).toHaveLength(9)
      expect(minimal.segments).toHaveLength(CATERPILLAR_LOW_DETAIL_SEGMENTS)

      normal.segments.forEach((segment, index) => {
        expect(segment.name).toBe(`caterpillar-segment-${index}`)
      })
      expect(normal.rings).toHaveLength(8)
      expect(minimal.rings).toHaveLength(0)
    } finally {
      normal.dispose()
      minimal.dispose()
    }
  })

  it('8 aneis no modo normal e 0 no minimal', () => {
    const normal = buildBody()
    const minimal = buildBody({ minimal: true, segments: CATERPILLAR_LOW_DETAIL_SEGMENTS })
    try {
      expect(normal.rings).toHaveLength(8)
      expect(minimal.rings).toHaveLength(0)
      expect(normal.group.getObjectByName('caterpillar-body-detail')).not.toBeNull()
    } finally {
      normal.dispose()
      minimal.dispose()
    }
  })

  it('mesma seed produz a mesma contagem de vertices', () => {
    const first = buildBody({ seed: 2026 })
    const second = buildBody({ seed: 2026 })
    try {
      expect(countVertices(first)).toBe(countVertices(second))
      expect(first.segments.map((segment) => segment.position.toArray())).toEqual(
        second.segments.map((segment) => segment.position.toArray())
      )
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('bounding box do corpo tem altura maior que largura', () => {
    const body = buildBody()
    try {
      const size = boxOf(body.group).getSize(new Vector3())
      expect(size.y).toBeGreaterThan(size.x)
    } finally {
      body.dispose()
    }
  })

  it('nenhum segmento cruza o plano y = -1.0', () => {
    const body = buildBody()
    try {
      for (const segment of body.segments) {
        expect(boxOf(segment).min.y).toBeGreaterThan(-1.0)
      }
    } finally {
      body.dispose()
    }
  })

  it('aneis nao compartilham geometria mutavel entre builds', () => {
    const first = buildBody({ seed: 11 })
    const second = buildBody({ seed: 11 })
    try {
      const firstDetail = first.group.getObjectByName('caterpillar-body-detail') as Mesh
      const secondDetail = second.group.getObjectByName('caterpillar-body-detail') as Mesh
      expect(firstDetail.geometry).not.toBe(secondDetail.geometry)

      const firstPosition = firstDetail.geometry.getAttribute('position')
      const secondPosition = secondDetail.geometry.getAttribute('position')
      const before = secondPosition.getX(0)
      firstPosition.setX(0, before + 1)
      expect(secondPosition.getX(0)).toBe(before)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('contagem total de triangulos fica no teto do personagem', () => {
    const build = buildCaterpillar({ seed: 11 })
    try {
      expect(build.stats.triangles).toBeGreaterThan(0)
      expect(build.stats.triangles).toBeLessThanOrEqual(MAX_CATERPILLAR_TRIANGLES)
    } finally {
      build.dispose()
    }
  })

  it('barriga tem entre 4 e 6 placas', () => {
    const body = buildBody()
    try {
      expect(body.belly.name).toBe('caterpillar-belly')
      expect(body.belly.parent).toBe(body.group)
      expect(body.bellyPlates.name).toBe('caterpillar-belly-plates')
      expect(body.bellyPlates.count).toBeGreaterThanOrEqual(4)
      expect(body.bellyPlates.count).toBeLessThanOrEqual(6)
    } finally {
      body.dispose()
    }
  })

  it('placas usam a cor belly da paleta', () => {
    const body = buildBody()
    try {
      const material = body.bellyPlates.material as MeshBasicMaterial
      expect(material.color.getHex()).toBe(parseInt(PALETTE.belly.slice(1), 16))
    } finally {
      body.dispose()
    }
  })

  it('placas ficam dentro do bounding box do corpo', () => {
    const body = buildBody()
    try {
      const segments = segmentBox(body)
      const position = new Vector3()
      const quaternion = new Quaternion()
      const scale = new Vector3()
      const matrix = new Matrix4()

      for (let index = 0; index < body.bellyPlates.count; index += 1) {
        body.bellyPlates.getMatrixAt(index, matrix)
        matrix.decompose(position, quaternion, scale)
        expect(position.x).toBeGreaterThanOrEqual(segments.min.x)
        expect(position.x).toBeLessThanOrEqual(segments.max.x)
        expect(position.y).toBeGreaterThanOrEqual(segments.min.y)
        expect(position.y).toBeLessThanOrEqual(segments.max.y)
      }
    } finally {
      body.dispose()
    }
  })

  it('ponta da cauda fica dentro do bounding box', () => {
    const body = buildBody()
    try {
      expect(boxOf(body.group).containsPoint(body.tailTip)).toBe(true)
    } finally {
      body.dispose()
    }
  })

  it('base do corpo e plana dentro de 0.05', () => {
    const body = buildBody()
    try {
      const segment = body.segments[0]
      segment.updateWorldMatrix(true, false)
      const position = segment.geometry.getAttribute('position')
      const world = new Vector3()
      const ys: number[] = []

      for (let index = 0; index < position.count; index += 1) {
        world.fromBufferAttribute(position, index)
        world.applyMatrix4(segment.matrixWorld)
        ys.push(world.y)
      }

      const min = Math.min(...ys)
      const baseYs = ys.filter((value) => value <= min + 0.05)
      expect(baseYs.length).toBeGreaterThan(3)
      expect(Math.max(...baseYs) - Math.min(...baseYs)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(min - body.bodyBaseY)).toBeLessThanOrEqual(0.001)

      const build = buildCaterpillar({ seed: 7 })
      try {
        expect(build.stats.bodyBaseY).toBeCloseTo(body.bodyBaseY, 6)
      } finally {
        build.dispose()
      }
    } finally {
      body.dispose()
    }
  })

  it('cauda nao passa da largura do quadril', () => {
    const body = buildBody()
    try {
      const points = body.tailCurve.getPoints(48)
      let minX = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY

      for (const point of points) {
        minX = Math.min(minX, point.x)
        maxX = Math.max(maxX, point.x)
        minY = Math.min(minY, point.y)
      }

      const tailWidth = maxX - minX + body.tailRadius * 2
      const hipWidth = boxOf(body.segments[0]).getSize(new Vector3()).x
      expect(tailWidth).toBeLessThanOrEqual(hipWidth)
      expect(minY - body.tailRadius).toBeGreaterThanOrEqual(body.bodyBaseY - 0.001)
    } finally {
      body.dispose()
    }
  })
})

describe('corpo e orcamento de malha', () => {
  it('detalhe do corpo e da barriga nao viram geometria compartilhada mutavel', () => {
    const body = buildBody()
    try {
      const detail = body.group.getObjectByName('caterpillar-body-detail') as Mesh
      const belly = body.bellyPlates
      expect(detail.geometry).toBeInstanceOf(BufferGeometry)
      expect(belly.geometry).not.toBe(detail.geometry)
      expect(body.group.children).toContain(body.belly)
      expect(body.group.children).toContain(detail)
    } finally {
      body.dispose()
    }
  })
})
