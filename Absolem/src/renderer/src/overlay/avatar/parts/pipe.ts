import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  Mesh,
  Points,
  PointsMaterial,
  Quaternion,
  TubeGeometry,
  Vector3
} from 'three'
import type { ColorRepresentation } from 'three'
import { createSeededRandom } from '../caterpillar'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'
import type { HeadPartBuild } from './head'
import type { TurbanPartBuild } from './turban'
import { scaleSkeleton } from './skeleton'

const UP = new Vector3(0, 1, 0)

/** Pontos de controle da mangueira (o teste exige de 5 a 7). */
export const PIPE_CONTROL_POINTS = 6

/** Teto do tubo: 40 anéis por 6 radiais. */
export const PIPE_TUBULAR_SEGMENTS = 40
export const PIPE_RADIAL_SEGMENTS = 6

/** A piteira precisa terminar a menos disto do canto direito da boca. */
export const PIPE_MOUTH_TOLERANCE = 0.08

/** Espessura da mangueira e da piteira, em múltiplos do raio do corpo. */
const HOSE_RADIUS_SCALE = 0.05
const MOUTHPIECE_LENGTH_SCALE = 0.3
const MOUTHPIECE_RADIUS_SCALE = 0.045

/** Baforada: sistema pequeno e separado das partículas de energia. */
export const PIPE_SMOKE_MIN_MOTES = 12
export const PIPE_SMOKE_MAX_MOTES = 24
export const PIPE_SMOKE_DEFAULT_MOTES = 16

/** Força inicial discreta; a task 20 anima o canal da baforada. */
const PIPE_SMOKE_DEFAULT_STRENGTH = 0.45
const PIPE_SMOKE_RISE = 0.16
const PIPE_SMOKE_SIZE = 0.018

export interface PipeSmokeOptions {
  origin: Vector3
  color: ColorRepresentation
  seed?: number
  count?: number
  reducedMotion?: boolean
}

export interface PipeSmoke {
  points: Points
  /** Motes efetivamente desenhados (0 com força 0 ou movimento reduzido). */
  count: () => number
  setStrength: (strength: number) => void
  setReducedMotion: (reduced: boolean) => void
  /** Move a baforada no laço; a cena só chama na task 20. */
  update: (timeSeconds: number) => void
  dispose: () => void
}

/**
 * Baforada procedural: motes pequenos saindo da piteira, subindo e dissipando.
 * Não reutiliza `particles.ts` (energia do corpo) e mantém opacidade baixa para
 * não sujar o overlay transparente. `setStrength(0)` e movimento reduzido
 * deixam o draw range vazio em vez de criar ou remover geometria.
 */
export function createPipeSmoke(options: PipeSmokeOptions): PipeSmoke {
  const allocated = Math.min(
    PIPE_SMOKE_MAX_MOTES,
    Math.max(PIPE_SMOKE_MIN_MOTES, Math.round(options.count ?? PIPE_SMOKE_DEFAULT_MOTES))
  )
  const random = createSeededRandom(options.seed ?? 23)
  const origin = options.origin
  const positions = new Float32Array(allocated * 3)
  const baseX = new Float32Array(allocated)
  const baseY = new Float32Array(allocated)
  const baseZ = new Float32Array(allocated)
  const phase = new Float32Array(allocated)

  for (let index = 0; index < allocated; index += 1) {
    const angle = random() * Math.PI * 2
    const spread = 0.008 + random() * 0.03
    baseX[index] = origin.x + Math.cos(angle) * spread
    baseY[index] = origin.y + 0.005 + random() * 0.02
    baseZ[index] = origin.z + 0.008 + random() * 0.03
    phase[index] = random()
    positions[index * 3] = baseX[index]
    positions[index * 3 + 1] = baseY[index]
    positions[index * 3 + 2] = baseZ[index]
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))

  const material = new PointsMaterial({
    color: options.color,
    size: PIPE_SMOKE_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.3,
    depthWrite: false
  })

  const points = new Points(geometry, material)
  points.name = 'caterpillar-pipe-smoke'
  points.frustumCulled = false

  let strength = PIPE_SMOKE_DEFAULT_STRENGTH
  let motionReduced = options.reducedMotion === true
  let disposed = false

  function visibleCount(): number {
    if (motionReduced) return 0
    return Math.round(allocated * strength)
  }

  function applyDrawRange(): void {
    geometry.setDrawRange(0, visibleCount())
  }

  function writePositions(timeSeconds: number): void {
    for (let index = 0; index < allocated; index += 1) {
      const progress = (phase[index] + timeSeconds * 0.22) % 1
      positions[index * 3] =
        baseX[index] + Math.sin(phase[index] * Math.PI * 2 + timeSeconds * 0.5) * 0.014 * progress
      positions[index * 3 + 1] = baseY[index] + progress * PIPE_SMOKE_RISE
      positions[index * 3 + 2] = baseZ[index] + progress * 0.045
    }
    geometry.attributes.position.needsUpdate = true
  }

  applyDrawRange()
  writePositions(0)

  return {
    points,
    count: visibleCount,
    setStrength(next: number): void {
      strength = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0))
      applyDrawRange()
    },
    setReducedMotion(reduced: boolean): void {
      motionReduced = reduced
      applyDrawRange()
    },
    update(timeSeconds: number): void {
      if (disposed || motionReduced || visibleCount() === 0) return
      writePositions(timeSeconds)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      geometry.dispose()
      material.dispose()
    }
  }
}

export interface PipePartContext extends PartContext {
  head: HeadPartBuild
  turban?: TurbanPartBuild
}

export interface PipePartBuild extends PartBuild {
  hose: Mesh
  mouthpiece: Mesh
  /** Ponta da piteira (frente do bocal), usada pela baforada da T5. */
  tip: Vector3
  /** Pontos de controle da `CatmullRomCurve3`. */
  controlPoints: Vector3[]
  curve: CatmullRomCurve3
  hoseRadius: number
  /** Baforada exposta em `parts.pipe` para a task 20 animar. */
  smoke: PipeSmoke
}

/**
 * Mangueira e piteira procedurais, aprovadas pelo gate de produto.
 *
 * A curva sai da mão direita (âncora `handRight`), sobe em laço solto à frente
 * do rosto e termina numa piteira escura perto do canto direito da boca. Todos
 * os pontos ficam à frente do plano frontal da cabeça, então o tubo não
 * atravessa o crânio nem o turbante. Não há base de narguilé, água ou cenário.
 */
export function buildPipePart(ctx: PipePartContext): PipePartBuild {
  const { head, materialFor, radius } = ctx
  const anchors = scaleSkeleton(radius)
  const group = new Group()
  group.name = 'caterpillar-pipe'

  const mouthCorner = head.mouth.position.clone().add(head.mouthCorners[1].position)
  const tip = new Vector3(mouthCorner.x, mouthCorner.y, mouthCorner.z + radius * 0.19)

  const controlPoints = [
    anchors.handRight.clone(),
    new Vector3(1.66, 2.72, 1.86).multiplyScalar(radius),
    new Vector3(1.64, 3.02, 1.56).multiplyScalar(radius),
    new Vector3(1.48, 3.28, 1.2).multiplyScalar(radius),
    new Vector3(1.22, 3.34, 1.02).multiplyScalar(radius),
    tip
  ]

  const curve = new CatmullRomCurve3(controlPoints)
  curve.curveType = 'catmullrom'
  curve.tension = 0.42

  const hoseRadius = radius * HOSE_RADIUS_SCALE
  const hose = new Mesh(
    new TubeGeometry(curve, PIPE_TUBULAR_SEGMENTS, hoseRadius, PIPE_RADIAL_SEGMENTS, false),
    materialFor('hose')
  )
  hose.name = 'caterpillar-pipe-hose'
  hose.userData.materialRole = 'hose'
  group.add(hose)

  const tangent = curve.getTangentAt(1).normalize()
  const mouthpieceLength = radius * MOUTHPIECE_LENGTH_SCALE
  const mouthpiece = new Mesh(
    new CylinderGeometry(
      radius * MOUTHPIECE_RADIUS_SCALE,
      radius * MOUTHPIECE_RADIUS_SCALE * 0.72,
      mouthpieceLength,
      8
    ),
    materialFor('pipe')
  )
  mouthpiece.name = 'caterpillar-pipe-mouthpiece'
  mouthpiece.userData.materialRole = 'pipe'
  mouthpiece.position.copy(tip).addScaledVector(tangent, -mouthpieceLength / 2)
  mouthpiece.quaternion.copy(new Quaternion().setFromUnitVectors(UP, tangent))
  group.add(mouthpiece)

  const smoke = createPipeSmoke({
    origin: tip,
    color: ctx.palette.smoke,
    seed: ctx.seed,
    reducedMotion: ctx.minimal
  })
  group.add(smoke.points)

  const disposeGroup = createPartDispose(group)
  let disposed = false

  return {
    group,
    hose,
    mouthpiece,
    tip,
    controlPoints,
    curve,
    hoseRadius,
    smoke,
    dispose(): void {
      if (disposed) return
      disposed = true
      smoke.dispose()
      disposeGroup()
    }
  }
}
