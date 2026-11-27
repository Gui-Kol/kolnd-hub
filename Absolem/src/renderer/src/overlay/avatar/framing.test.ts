import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  FRAMING_MARGIN,
  FRAMING_YAW_DEG,
  computeFraming,
  framingCameraOffset,
  type Framing,
  type FramingBounds
} from './framing'

const FOV_DEG = 42

function corners(bounds: FramingBounds): Vector3[] {
  const out: Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) out.push(new Vector3(x, y, z))
    }
  }
  return out
}

/** Projeta os 8 cantos na câmera de teste, com o mesmo yaw do enquadramento. */
function project(
  bounds: FramingBounds,
  aspect: number,
  framing: Framing,
  yawDeg = FRAMING_YAW_DEG
): Vector3[] {
  const camera = new PerspectiveCamera(FOV_DEG, aspect, 0.1, 100)
  camera.position
    .copy(framing.target)
    .addScaledVector(framingCameraOffset(yawDeg), framing.distance)
  camera.lookAt(framing.target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return corners(bounds).map((corner) => corner.clone().project(camera))
}

function squareBounds(): FramingBounds {
  // Seção quadrada (X e Z iguais) e mais alta que larga, como o personagem
  // sentado com turbante; a altura é o lado limitante no aspect retrato.
  return {
    min: new Vector3(-0.9, -2.4, -0.9),
    max: new Vector3(0.9, 2.4, 0.9)
  }
}

function scaled(bounds: FramingBounds, factor: number): FramingBounds {
  return {
    min: bounds.min.clone().multiplyScalar(factor),
    max: bounds.max.clone().multiplyScalar(factor)
  }
}

describe('enquadramento automático da câmera', () => {
  it('bounds quadrados em aspect 0.89 preenchem 84% a 94% da altura', () => {
    const bounds = squareBounds()
    const framing = computeFraming(bounds, 0.89, {
      fovDeg: FOV_DEG,
      margin: FRAMING_MARGIN,
      yawDeg: 0
    })
    const projected = project(bounds, 0.89, framing, 0)
    const fill = Math.max(...projected.map((point) => Math.abs(point.y)))
    expect(fill).toBeGreaterThanOrEqual(0.84)
    expect(fill).toBeLessThanOrEqual(0.94)
  })

  it('bounds largos (com cachimbo) preservam a margem lateral', () => {
    // Conjunto assimétrico: mais largo que alto, com o lado do cachimbo em +X.
    const bounds: FramingBounds = {
      min: new Vector3(-2.6, -1.4, -0.9),
      max: new Vector3(3.1, 1.6, 1.1)
    }
    const aspect = 320 / 360
    const framing = computeFraming(bounds, aspect, { fovDeg: FOV_DEG, margin: FRAMING_MARGIN })
    const projected = project(bounds, aspect, framing)

    const maxX = Math.max(...projected.map((point) => Math.abs(point.x)))
    const maxY = Math.max(...projected.map((point) => Math.abs(point.y)))
    expect(maxX).toBeLessThanOrEqual(0.94)
    expect(maxX).toBeGreaterThanOrEqual(0.84)
    expect(maxY).toBeLessThanOrEqual(0.94)
  })

  it('aspect muda e o alvo continua no centro', () => {
    const bounds: FramingBounds = {
      min: new Vector3(-3.2, -1.5, -0.7),
      max: new Vector3(3.2, 1.5, 0.7)
    }
    const center = new Vector3().addVectors(bounds.min, bounds.max).multiplyScalar(0.5)
    const distances: number[] = []

    for (const aspect of [240 / 260, 320 / 360, 480 / 560]) {
      const framing = computeFraming(bounds, aspect, { fovDeg: FOV_DEG })
      expect(framing.target.x).toBeCloseTo(center.x, 10)
      expect(framing.target.y).toBeCloseTo(center.y, 10)
      expect(framing.target.z).toBeCloseTo(center.z, 10)

      // O centro do box projeta no centro exato do quadro.
      const camera = new PerspectiveCamera(FOV_DEG, aspect, 0.1, 100)
      camera.position
        .copy(framing.target)
        .addScaledVector(framingCameraOffset(FRAMING_YAW_DEG), framing.distance)
      camera.lookAt(framing.target)
      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()
      const projectedCenter = center.clone().project(camera)
      expect(Math.abs(projectedCenter.x)).toBeLessThan(1e-6)
      expect(Math.abs(projectedCenter.y)).toBeLessThan(1e-6)
      distances.push(framing.distance)
    }

    // Aspect mais estreito (480x560, 0.857) exige mais distância que 320x360
    // (0.889) e que 240x260 (0.923).
    expect(distances[0]).toBeLessThan(distances[1])
    expect(distances[1]).toBeLessThan(distances[2])
  })

  it('scale 1.5 não corta', () => {
    const base: FramingBounds = {
      min: new Vector3(-1.9, -2.7, -0.8),
      max: new Vector3(2.3, 3.5, 1.0)
    }
    const big = scaled(base, 1.5)

    for (const [width, height] of [
      [240, 260],
      [320, 360],
      [480, 560]
    ]) {
      const aspect = width / height
      const framingBase = computeFraming(base, aspect, { fovDeg: FOV_DEG })
      const framingBig = computeFraming(big, aspect, { fovDeg: FOV_DEG })
      expect(framingBig.distance).toBeCloseTo(framingBase.distance * 1.5, 8)

      const projected = project(big, aspect, framingBig)
      for (const point of projected) {
        expect(Math.abs(point.x)).toBeLessThanOrEqual(0.94)
        expect(Math.abs(point.y)).toBeLessThanOrEqual(0.94)
        expect(Math.abs(point.z)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('função é pura (mesma entrada, mesma saída)', () => {
    const bounds: FramingBounds = {
      min: new Vector3(-1.2, -2.0, -0.5),
      max: new Vector3(1.6, 2.8, 0.7)
    }
    const minBefore = bounds.min.clone()
    const maxBefore = bounds.max.clone()

    const first = computeFraming(bounds, 0.889, { fovDeg: FOV_DEG })
    const second = computeFraming(bounds, 0.889, { fovDeg: FOV_DEG })

    expect(second.target.toArray()).toEqual(first.target.toArray())
    expect(second.distance).toBe(first.distance)
    expect(bounds.min.toArray()).toEqual(minBefore.toArray())
    expect(bounds.max.toArray()).toEqual(maxBefore.toArray())
    expect(second.target).not.toBe(first.target)
  })
})
