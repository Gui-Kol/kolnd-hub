import { Box3, Group, Mesh, Object3D, SphereGeometry, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createDefaultCaterpillarMaterials } from '../caterpillar'
import { normalizePalette } from '../palettes'
import {
  IDLE_LID_CLOSURE,
  applyEyelidClosure,
  applyMouthPose,
  lidClosureFromOpenness
} from '../facePose'
import { scaleSkeleton } from './skeleton'
import { EYELID_IDLE_OPENNESS, buildHeadPart } from './head'
import type { PartContext } from './types'

const PALETTE = normalizePalette(undefined)
const RADIUS = 0.22
const HEAD_RADIUS = RADIUS * 1.12

function buildHead(overrides: Partial<PartContext> = {}) {
  const materialFor = createDefaultCaterpillarMaterials('classic', {
    head: parseInt(PALETTE.head.slice(1), 16),
    sclera: parseInt(PALETTE.sclera.slice(1), 16),
    pupil: parseInt(PALETTE.pupil.slice(1), 16),
    mouth: parseInt(PALETTE.mouth.slice(1), 16)
  })

  return buildHeadPart({
    radius: RADIUS,
    materialFor,
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

function boxOf(object: Object3D): Box3 {
  object.updateWorldMatrix(true, true)
  return new Box3().setFromObject(object)
}

describe('cabeca e rosto', () => {
  it('cabeca e mais larga que alta', () => {
    const head = buildHead()
    try {
      const size = boxOf(head.head).getSize(new Vector3())
      const ratio = size.x / size.y
      expect(ratio).toBeGreaterThanOrEqual(1.15)
      expect(ratio).toBeLessThanOrEqual(1.3)
    } finally {
      head.dispose()
    }
  })

  it('topo da cabeca e plano dentro de 0.04', () => {
    const head = buildHead()
    try {
      head.head.updateWorldMatrix(true, true)
      const position = head.head.geometry.getAttribute('position')
      const world = new Vector3()
      const worldYs: number[] = []

      for (let index = 0; index < position.count; index += 1) {
        world.fromBufferAttribute(position, index)
        world.applyMatrix4(head.head.matrixWorld)
        worldYs.push(world.y)
      }

      const maxY = Math.max(...worldYs)
      const topYs = worldYs.filter((value) => value >= maxY - 1e-6)
      expect(topYs.length).toBeGreaterThan(3)
      expect(Math.max(...topYs) - Math.min(...topYs)).toBeLessThanOrEqual(0.04)
    } finally {
      head.dispose()
    }
  })

  it('papada fica abaixo do centro do queixo', () => {
    const head = buildHead()
    try {
      const jowl = head.group.getObjectByName('caterpillar-jowl') as Mesh
      const headBox = boxOf(head.head)
      const jowlBox = boxOf(jowl)

      expect(jowl).toBeInstanceOf(Mesh)
      expect(jowl.position.y).toBeLessThan(head.head.position.y - HEAD_RADIUS * 0.5)
      expect(jowlBox.min.y).toBeLessThan(headBox.min.y)
    } finally {
      head.dispose()
    }
  })

  it('bochechas nao empatam com o cranio em z', () => {
    const head = buildHead()
    try {
      const headBox = boxOf(head.head)
      const left = head.group.getObjectByName('caterpillar-cheek-left') as Mesh
      const right = head.group.getObjectByName('caterpillar-cheek-right') as Mesh

      expect(head.group.getObjectByName('caterpillar-head')).toBe(head.head)
      for (const cheek of [left, right]) {
        expect(cheek).toBeInstanceOf(Mesh)
        expect(Math.abs(boxOf(cheek).max.z - headBox.max.z)).toBeGreaterThan(0.01)
      }
    } finally {
      head.dispose()
    }
  })

  it('sobrancelha tem 2 grupos', () => {
    const head = buildHead()
    try {
      expect(head.brows).toHaveLength(2)
      expect(head.brows[0].name).toContain('caterpillar-brow')
      expect(head.brows[1].name).toContain('caterpillar-brow')
      expect(head.browLeft.name).toBe('caterpillar-brow-left')
      expect(head.browRight.name).toBe('caterpillar-brow-right')
      for (const brow of head.brows) {
        expect(brow.getObjectByName('caterpillar-brow-tube')).toBeInstanceOf(Mesh)
      }
    } finally {
      head.dispose()
    }
  })

  it('sobrancelha fica acima das palpebras', () => {
    const head = buildHead()
    try {
      const eye = new Vector3()
      head.eyeGroups[0].getWorldPosition(eye)
      for (const brow of head.brows) {
        const browPosition = new Vector3()
        brow.getWorldPosition(browPosition)
        expect(browPosition.y).toBeGreaterThan(eye.y)
      }
    } finally {
      head.dispose()
    }
  })

  it('cada olho tem esclera, iris, pupila e palpebra', () => {
    const head = buildHead()
    try {
      expect(head.eyeGroups).toHaveLength(2)
      expect(head.lids).toHaveLength(2)
      for (const eye of head.eyeGroups) {
        expect(eye.getObjectByName('caterpillar-sclera')).toBeInstanceOf(Mesh)
        expect(eye.getObjectByName('caterpillar-iris')).toBeInstanceOf(Mesh)
        expect(eye.getObjectByName('caterpillar-pupil')).toBeInstanceOf(Mesh)
        expect(eye.getObjectByName('caterpillar-highlight')).toBeInstanceOf(Mesh)
        expect(eye.getObjectByName('caterpillar-eyelid')).toBeInstanceOf(Group)
      }
    } finally {
      head.dispose()
    }
  })

  it('palpebra em 1 cobre o olho inteiro', () => {
    const head = buildHead()
    try {
      applyEyelidClosure(head.lids, 1)
      for (let index = 0; index < head.eyeGroups.length; index += 1) {
        const sclera = head.eyeGroups[index].getObjectByName('caterpillar-sclera') as Mesh
        const lidBox = boxOf(head.lids[index])
        const scleraBox = boxOf(sclera)
        const epsilon = 0.002

        expect(lidBox.min.x).toBeLessThanOrEqual(scleraBox.min.x + epsilon)
        expect(lidBox.max.x).toBeGreaterThanOrEqual(scleraBox.max.x - epsilon)
        expect(lidBox.min.y).toBeLessThanOrEqual(scleraBox.min.y + epsilon)
        expect(lidBox.max.y).toBeGreaterThanOrEqual(scleraBox.max.y - epsilon)
      }
    } finally {
      head.dispose()
    }
  })

  it('pupila dentro da esclera', () => {
    const head = buildHead()
    try {
      for (const eye of head.eyeGroups) {
        const sclera = eye.getObjectByName('caterpillar-sclera') as Mesh
        const pupil = eye.getObjectByName('caterpillar-pupil') as Mesh
        const scleraRadius = (sclera.geometry as SphereGeometry).parameters.radius
        const pupilRadius = (pupil.geometry as SphereGeometry).parameters.radius
        expect(pupil.position.length() + pupilRadius).toBeLessThanOrEqual(scleraRadius + 1e-6)
      }
    } finally {
      head.dispose()
    }
  })

  it('palpebra em repouso cobre cerca de 35 por cento', () => {
    expect(lidClosureFromOpenness(1)).toBe(0)
    expect(lidClosureFromOpenness(0)).toBe(1)
    expect(lidClosureFromOpenness(EYELID_IDLE_OPENNESS)).toBeCloseTo(IDLE_LID_CLOSURE, 6)
    expect(IDLE_LID_CLOSURE).toBeGreaterThan(0.3)
    expect(IDLE_LID_CLOSURE).toBeLessThan(0.45)
  })

  it('narinas tem 2 meshes', () => {
    const head = buildHead()
    try {
      expect(head.nostrils).toHaveLength(2)
      const nostrils = head.group.getObjectByName('caterpillar-nostrils') as Group
      const meshes = nostrils.children.filter((child) => child instanceof Mesh)
      expect(meshes).toHaveLength(2)
      for (const nostril of head.nostrils) {
        expect(nostril).toBeInstanceOf(Mesh)
      }
    } finally {
      head.dispose()
    }
  })

  it('nariz entre olhos e boca', () => {
    const head = buildHead()
    try {
      const nose = new Vector3()
      const eye = new Vector3()
      const mouth = new Vector3()
      head.nose.getWorldPosition(nose)
      head.eyeGroups[0].getWorldPosition(eye)
      head.mouth.getWorldPosition(mouth)

      expect(nose.y).toBeLessThan(eye.y)
      expect(nose.y).toBeGreaterThan(mouth.y)
    } finally {
      head.dispose()
    }
  })

  it('nariz nao cruza o plano da boca', () => {
    const head = buildHead()
    try {
      const noseBox = boxOf(head.nose)
      const mouthBox = boxOf(head.mouth)
      expect(noseBox.min.y).toBeGreaterThan(mouthBox.max.y)
    } finally {
      head.dispose()
    }
  })

  it('boca tem interior, lingua e 2 cantos', () => {
    const head = buildHead()
    try {
      expect(head.mouth).toBeInstanceOf(Group)
      expect(head.mouth.name).toBe('caterpillar-mouth')
      expect(head.mouth.getObjectByName('caterpillar-mouth-interior')).toBeInstanceOf(Mesh)
      expect(head.mouth.getObjectByName('caterpillar-tongue')).toBeInstanceOf(Mesh)
      expect(head.mouth.getObjectByName('caterpillar-lip-upper')).toBeInstanceOf(Mesh)
      expect(head.mouth.getObjectByName('caterpillar-lip-lower')).toBeInstanceOf(Mesh)
      expect(head.mouthCorners).toHaveLength(2)
      for (const corner of head.mouthCorners) {
        expect(corner.name).toContain('caterpillar-mouth-corner')
      }
    } finally {
      head.dispose()
    }
  })

  it('em repouso os cantos ficam acima do centro', () => {
    const head = buildHead()
    try {
      applyMouthPose(head, 0, 0.5)
      const center = new Vector3()
      head.mouth.getWorldPosition(center)
      for (const corner of head.mouthCorners) {
        const position = new Vector3()
        corner.getWorldPosition(position)
        expect(position.y).toBeGreaterThan(center.y)
      }
    } finally {
      head.dispose()
    }
  })

  it('mouthOpen 1 afasta os labios em pelo menos 0.06', () => {
    const head = buildHead()
    try {
      applyMouthPose(head, 1, 0.5)
      const upperBox = boxOf(head.upperLip)
      const lowerBox = boxOf(head.lowerLip)
      expect(upperBox.min.y - lowerBox.max.y).toBeGreaterThanOrEqual(0.06)
    } finally {
      head.dispose()
    }
  })

  it('mouthOpen 0 nao deixa fresta', () => {
    const head = buildHead()
    try {
      applyMouthPose(head, 0, 0.5)
      const upperBox = boxOf(head.upperLip)
      const lowerBox = boxOf(head.lowerLip)
      expect(lowerBox.max.y).toBeGreaterThanOrEqual(upperBox.min.y - 1e-6)
    } finally {
      head.dispose()
    }
  })
})
