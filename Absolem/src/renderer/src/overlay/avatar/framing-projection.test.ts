import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { buildCaterpillar } from './caterpillar'
import {
  FRAMING_MARGIN,
  FRAMING_YAW_DEG,
  computeFraming,
  framingCameraOffset,
  type FramingBounds
} from './framing'

const FOV_DEG = 42
const NDC_LIMIT = 0.94
const SCENE_ROOT_SCALE = 0.92

function scaledBounds(build: ReturnType<typeof buildCaterpillar>, scale: number): FramingBounds {
  return {
    min: build.bounds.min.clone().multiplyScalar(scale),
    max: build.bounds.max.clone().multiplyScalar(scale)
  }
}

function corners(bounds: FramingBounds): Vector3[] {
  const out: Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) out.push(new Vector3(x, y, z))
    }
  }
  return out
}

function projectAll(bounds: FramingBounds, width: number, height: number): Vector3[] {
  const aspect = width / height
  const framing = computeFraming(bounds, aspect, {
    fovDeg: FOV_DEG,
    margin: FRAMING_MARGIN,
    yawDeg: FRAMING_YAW_DEG
  })
  const camera = new PerspectiveCamera(FOV_DEG, aspect, 0.1, 100)
  camera.position
    .copy(framing.target)
    .addScaledVector(framingCameraOffset(FRAMING_YAW_DEG), framing.distance)
  camera.lookAt(framing.target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return corners(bounds).map((corner) => corner.clone().project(camera))
}

describe('ângulo 3/4 e projeção do bounding box', () => {
  it('yaw fica na faixa de 12 a 18 graus', () => {
    expect(FRAMING_YAW_DEG).toBeGreaterThanOrEqual(12)
    expect(FRAMING_YAW_DEG).toBeLessThanOrEqual(18)
  })

  it('projeção dos 8 cantos fica dentro do NDC [-0.94, 0.94] para 240x260, 320x360 e 480x560', () => {
    const build = buildCaterpillar({ seed: 1 })
    try {
      const bounds = scaledBounds(build, SCENE_ROOT_SCALE)
      for (const [width, height] of [
        [240, 260],
        [320, 360],
        [480, 560]
      ]) {
        const projected = projectAll(bounds, width, height)
        for (const point of projected) {
          expect(Math.abs(point.x)).toBeLessThanOrEqual(NDC_LIMIT)
          expect(Math.abs(point.y)).toBeLessThanOrEqual(NDC_LIMIT)
          expect(point.z).toBeLessThanOrEqual(1)
          expect(point.z).toBeGreaterThanOrEqual(-1)
        }
      }
    } finally {
      build.dispose()
    }
  })

  it('escalas 0.8 e 1.5 do tema também caem dentro do NDC', () => {
    const build = buildCaterpillar({ seed: 1 })
    try {
      for (const themeScale of [0.8, 1.5]) {
        const bounds = scaledBounds(build, SCENE_ROOT_SCALE * themeScale)
        for (const [width, height] of [
          [240, 260],
          [320, 360],
          [480, 560]
        ]) {
          const projected = projectAll(bounds, width, height)
          for (const point of projected) {
            expect(Math.abs(point.x)).toBeLessThanOrEqual(NDC_LIMIT)
            expect(Math.abs(point.y)).toBeLessThanOrEqual(NDC_LIMIT)
          }
        }
      }
    } finally {
      build.dispose()
    }
  })
})
