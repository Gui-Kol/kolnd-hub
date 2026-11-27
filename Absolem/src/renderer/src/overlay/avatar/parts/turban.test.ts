import { Box3, MathUtils, Mesh, TorusGeometry, Vector3 } from 'three'
import type { MeshBasicMaterial, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { createDefaultCaterpillarMaterials } from '../caterpillar'
import { normalizePalette } from '../palettes'
import type { PartContext } from './types'
import { buildHeadPart } from './head'
import { scaleSkeleton } from './skeleton'
import {
  TURBAN_STRIPE_MIN_WIDTH,
  TURBAN_TILT_DEGREES,
  TURBAN_WRAP_COUNT,
  buildTurbanPart
} from './turban'

const PALETTE = normalizePalette(undefined)
const RADIUS = 0.22

function materialFactory() {
  return createDefaultCaterpillarMaterials('classic', {
    turban: parseInt(PALETTE.turban.slice(1), 16),
    turbanStripe: parseInt(PALETTE.turbanStripe.slice(1), 16)
  })
}

function buildHead(overrides: Partial<PartContext> = {}) {
  return buildHeadPart({
    radius: RADIUS,
    materialFor: materialFactory(),
    palette: PALETTE,
    seed: 7,
    minimal: false,
    style: 'classic',
    segments: 9,
    curvature: 0.45,
    neck: scaleSkeleton(RADIUS).neck,
    ...overrides
  })
}

function buildTurban(overrides: Partial<PartContext> = {}) {
  const head = buildHead(overrides)
  const turban = buildTurbanPart({
    radius: RADIUS,
    materialFor: materialFactory(),
    palette: PALETTE,
    seed: 7,
    minimal: false,
    style: 'classic',
    segments: 9,
    curvature: 0.45,
    head,
    ...overrides
  })
  return { head, turban }
}

function boxOf(object: Object3D): Box3 {
  object.updateWorldMatrix(true, true)
  return new Box3().setFromObject(object)
}

function clothOf(band: Object3D): Mesh {
  const cloth = band.children.find((child) => child instanceof Mesh)
  if (!cloth) throw new Error('faixa sem pano')
  return cloth
}

function colorOf(mesh: Mesh): number {
  return (mesh.material as MeshBasicMaterial).color.getHex()
}

describe('turbante', () => {
  it('calota cobre o topo da cabeca (bounding sphere contem headTop +/- 0.02)', () => {
    const { head, turban } = buildTurban()
    try {
      turban.cap.updateWorldMatrix(true, false)
      const headBox = boxOf(head.head)
      const headTop = new Vector3(head.head.position.x, headBox.max.y, head.head.position.z)
      const sphere = turban.cap.geometry.boundingSphere?.clone()
      expect(sphere).toBeDefined()
      sphere?.applyMatrix4(turban.cap.matrixWorld)

      expect(sphere?.center.distanceTo(headTop)).toBeLessThanOrEqual((sphere?.radius ?? 0) + 0.02)

      const capBox = boxOf(turban.cap)
      expect(capBox.min.y).toBeLessThanOrEqual(headBox.max.y + 0.02)
      expect(capBox.max.y).toBeGreaterThan(headBox.max.y)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('inclinacao entre 10 e 15 graus', () => {
    const { head, turban } = buildTurban()
    try {
      expect(MathUtils.radToDeg(turban.tiltRadians)).toBeGreaterThanOrEqual(10)
      expect(MathUtils.radToDeg(turban.tiltRadians)).toBeLessThanOrEqual(15)
      expect(MathUtils.radToDeg(turban.tiltRadians)).toBeCloseTo(TURBAN_TILT_DEGREES, 6)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('nenhuma antena visivel fora do turbante no look novo', () => {
    const { head, turban } = buildTurban()
    try {
      expect(turban.hidesAntennae).toBe(true)
      expect(head.antennae).toHaveLength(2)
      for (const antenna of head.antennae) {
        expect(antenna.visible).toBe(false)
      }

      // As raízes das antenas ficam sob a calota; o restante do tubo deixa de
      // ser desenhado enquanto o turbante está no lugar.
      const capBox = boxOf(turban.cap)
      for (const antenna of head.antennae) {
        expect(capBox.containsPoint(antenna.position)).toBe(true)
      }
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('entre 4 e 6 faixas', () => {
    const { head, turban } = buildTurban()
    try {
      expect(turban.wraps.name).toBe('caterpillar-turban-wraps')
      expect(TURBAN_WRAP_COUNT).toBeGreaterThanOrEqual(4)
      expect(TURBAN_WRAP_COUNT).toBeLessThanOrEqual(6)
      expect(turban.wraps.children).toHaveLength(TURBAN_WRAP_COUNT)

      for (const [index, band] of turban.wraps.children.entries()) {
        expect(band.name).toBe(`caterpillar-turban-wrap-${index + 1}`)
        expect(clothOf(band)).toBeInstanceOf(Mesh)
      }
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('listras e base tem pelo menos 2 materiais distintos', () => {
    const { head, turban } = buildTurban()
    try {
      const turbanColor = parseInt(PALETTE.turban.slice(1), 16)
      const stripeColor = parseInt(PALETTE.turbanStripe.slice(1), 16)
      const colors = new Set<number>([colorOf(turban.cap)])
      for (const band of turban.wraps.children) {
        colors.add(colorOf(clothOf(band)))
      }

      expect(colors.size).toBeGreaterThanOrEqual(2)
      expect(colors.has(turbanColor)).toBe(true)
      expect(colors.has(stripeColor)).toBe(true)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('faixas nao se estendem abaixo da linha dos olhos', () => {
    const { head, turban } = buildTurban()
    try {
      const eyeLine = head.eyeGroups[0].position.y
      for (const band of turban.wraps.children) {
        expect(boxOf(band).min.y).toBeGreaterThan(eyeLine)
      }
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('largura minima da listra respeitada', () => {
    const { head, turban } = buildTurban()
    try {
      const headRadius = head.head.geometry.boundingSphere?.radius ?? RADIUS
      const minimum = TURBAN_STRIPE_MIN_WIDTH * headRadius
      let stripes = 0

      for (const band of turban.wraps.children) {
        const cloth = clothOf(band)
        if (cloth.userData.materialRole !== 'turbanStripe') continue
        stripes += 1
        const geometry = cloth.geometry as TorusGeometry
        expect(geometry.parameters.tube * 2).toBeGreaterThanOrEqual(minimum)
      }

      expect(stripes).toBeGreaterThanOrEqual(2)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('no tem 2 volumes', () => {
    const { head, turban } = buildTurban()
    try {
      expect(turban.knot.name).toBe('caterpillar-turban-knot')
      const volumes = turban.knot.children.filter(
        (child) => child instanceof Mesh && child.userData.volume === true
      )
      expect(volumes).toHaveLength(2)
      expect(turban.knot.getObjectByName('caterpillar-turban-knot-fold')).toBeInstanceOf(Mesh)
      expect(turban.knot.getObjectByName('caterpillar-turban-knot-highlight')).toBeInstanceOf(Mesh)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('no nao cruza o plano da sobrancelha', () => {
    const { head, turban } = buildTurban()
    try {
      const knotBox = new Box3()
      for (const child of turban.knot.children) {
        if (child !== turban.tassel && child instanceof Mesh) knotBox.union(boxOf(child))
      }
      const browBox = boxOf(head.browLeft)

      // O corpo do nó fica acima da sobrancelha e à direita dela; nenhum dos
      // dois eixos devolve o nó sobre o arco esquerdo.
      expect(knotBox.min.y).toBeGreaterThan(browBox.max.y)
      expect(knotBox.min.x).toBeGreaterThan(browBox.max.x)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('pingente existe e e filho do no', () => {
    const { head, turban } = buildTurban()
    try {
      expect(turban.tassel.name).toBe('caterpillar-turban-tassel')
      expect(turban.tassel.parent).toBe(turban.knot)
      const spheres = turban.tassel.children.filter((child) => child instanceof Mesh)
      expect(spheres).toHaveLength(2)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })

  it('minimal remove faixas e mantem base e no', () => {
    const { head, turban } = buildTurban({ minimal: true })
    try {
      expect(turban.wraps.children).toHaveLength(0)
      expect(turban.group.getObjectByName('caterpillar-turban-cap')).toBe(turban.cap)
      expect(turban.group.getObjectByName('caterpillar-turban-knot')).toBe(turban.knot)
      expect(turban.group.getObjectByName('caterpillar-turban-tassel')).toBe(turban.tassel)
    } finally {
      turban.dispose()
      head.dispose()
    }
  })
})
