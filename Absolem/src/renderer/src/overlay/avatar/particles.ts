import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial
} from 'three'
import { createSeededRandom } from './caterpillar'

/**
 * Motes de energia flutuando ao redor do corpo.
 *
 * Base de 120 a 240 partículas; a degradação da T7 usa metade e
 * `prefers-reduced-motion` zera a densidade. As posições são geradas por PRNG
 * determinístico; o movimento é senoidal e barato (sem física e sem colisão).
 */
export const PARTICLE_MIN = 120
export const PARTICLE_MAX = 240
export const PARTICLE_DEFAULT = 180

export interface ParticleCountOptions {
  reducedMotion?: boolean
  /** Degradação: metade da base (pode ficar abaixo de PARTICLE_MIN). */
  half?: boolean
}

export function resolveParticleCount(
  requested: number | undefined = PARTICLE_DEFAULT,
  options: ParticleCountOptions = {}
): number {
  if (options.reducedMotion) return 0
  // Densidade "off" do tema (task 04) desliga as partículas de verdade.
  if (requested === 0) return 0
  const value =
    typeof requested === 'number' && Number.isFinite(requested) ? requested : PARTICLE_DEFAULT
  const base = Math.min(PARTICLE_MAX, Math.max(PARTICLE_MIN, Math.round(value)))
  return options.half ? Math.max(1, Math.round(base / 2)) : base
}

export interface ParticleSystemOptions {
  count?: number
  color?: string
  reducedMotion?: boolean
  seed?: number
  /** Raio do volume elíptico em volta do corpo. */
  spread?: { x: number; y: number; z: number }
  speed?: number
}

export interface ParticleSystem {
  points: Points
  /** Partículas efetivamente desenhadas (pode ser reduzido pela degradação). */
  count: () => number
  setCount: (count: number) => void
  setSpeed: (speed: number) => void
  setColor: (color: string | Color) => void
  setOpacity: (opacity: number) => void
  setReducedMotion: (reduced: boolean) => void
  update: (timeSeconds: number) => void
  dispose: () => void
}

export function createParticles(options: ParticleSystemOptions = {}): ParticleSystem {
  const requested = resolveParticleCount(options.count)
  const allocated = Math.max(1, requested)
  const reducedMotion = options.reducedMotion === true
  const spread = options.spread ?? { x: 1.55, y: 0.85, z: 0.6 }
  const random = createSeededRandom(options.seed ?? 17)

  const positions = new Float32Array(allocated * 3)
  const baseX = new Float32Array(allocated)
  const baseY = new Float32Array(allocated)
  const baseZ = new Float32Array(allocated)
  const phase = new Float32Array(allocated)

  for (let index = 0; index < allocated; index += 1) {
    const x = (random() * 2 - 1) * spread.x
    const y = (random() * 2 - 1) * spread.y
    const z = (random() * 2 - 1) * spread.z
    baseX[index] = x
    baseY[index] = y
    baseZ[index] = z
    phase[index] = random() * Math.PI * 2
    positions[index * 3] = x
    positions[index * 3 + 1] = y
    positions[index * 3 + 2] = z
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))

  const material = new PointsMaterial({
    color: new Color(options.color ?? '#93c5fd'),
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
    depthWrite: false
  })

  const points = new Points(geometry, material)
  points.name = 'caterpillar-particles'
  points.frustumCulled = false

  let currentCount = reducedMotion ? 0 : requested
  let requestedCount = requested
  let speed = Math.max(0, options.speed ?? 1)
  let motionReduced = reducedMotion
  geometry.setDrawRange(0, currentCount)

  function writePositions(timeSeconds: number): void {
    for (let index = 0; index < currentCount; index += 1) {
      const wobble = timeSeconds * speed + phase[index]
      positions[index * 3] = baseX[index] + Math.sin(wobble * 0.7) * 0.04
      positions[index * 3 + 1] = baseY[index] + Math.sin(wobble) * 0.06
      positions[index * 3 + 2] = baseZ[index] + Math.cos(wobble * 0.8) * 0.04
    }
    geometry.attributes.position.needsUpdate = true
  }

  if (currentCount > 0 && !motionReduced) writePositions(0)

  return {
    points,
    count: () => currentCount,
    setCount(count: number): void {
      const next = Math.min(allocated, Math.max(0, Math.round(count)))
      requestedCount = next
      currentCount = motionReduced ? 0 : next
      geometry.setDrawRange(0, currentCount)
    },
    setSpeed(next: number): void {
      speed = Math.max(0, next)
    },
    setColor(color: string | Color): void {
      material.color.set(color)
    },
    setOpacity(opacity: number): void {
      material.opacity = Math.min(1, Math.max(0, opacity))
    },
    setReducedMotion(reduced: boolean): void {
      motionReduced = reduced
      currentCount = reduced ? 0 : requestedCount
      geometry.setDrawRange(0, currentCount)
    },
    update(timeSeconds: number): void {
      if (motionReduced || currentCount === 0) return
      writePositions(timeSeconds)
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
    }
  }
}
