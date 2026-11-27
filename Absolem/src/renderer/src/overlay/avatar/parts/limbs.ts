import {
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  Vector3
} from 'three'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'
import { scaleSkeleton } from './skeleton'

/** Lado do corpo a que o membro pertence. */
export type LimbSide = 'left' | 'right'

/**
 * Proporção da mão em relação ao raio do corpo. `h` é a unidade local da mão:
 * a palma tem cerca de 2,5 `h` de largura e os dedos somam pouco mais de 1 `h`
 * de comprimento, o que mantém a leitura pequena diante do tronco.
 */
const HAND_UNIT = 0.22

/** Ângulo de aperto dos dedos em repouso, em radianos. */
export const HAND_GRIP: Record<LimbSide, number> = {
  left: 0.16,
  right: 1.02
}

/** Quantidade de dedos por mão no detalhe cheio; `minimal` usa 2. */
export const HAND_FINGERS = 3
export const HAND_FINGERS_MINIMAL = 2

/** Espessura do braço no ombro e no punho, em múltiplos do raio do corpo. */
const ARM_RADIUS_START = 0.16
const ARM_RADIUS_END = 0.085

/** Segmentos do tubo do braço; baixos para caber no orçamento. */
const ARM_TUBULAR_SEGMENTS = 16
const ARM_RADIAL_SEGMENTS = 6

/** Raio do sapato dos pés, em múltiplos do raio do corpo. */
const FOOT_RADIUS = 0.22
const FOOT_HEIGHT_SCALE = 0.6

const FORWARD = new Vector3(0, 0, 1)

function fingerCount(minimal: boolean): number {
  return minimal ? HAND_FINGERS_MINIMAL : HAND_FINGERS
}

/**
 * Tubo com raio decrescente ao longo de uma curva. `TubeGeometry` só aceita
 * raio constante, então os anéis são gerados manualmente com os quadros de
 * Frenet da própria curva - sem `BufferGeometryUtils` nem addons do three.
 */
function createTaperedTube(
  curve: CatmullRomCurve3,
  tubularSegments: number,
  radialSegments: number,
  radiusStart: number,
  radiusEnd: number
): BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false)
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const point = new Vector3()

  for (let ring = 0; ring <= tubularSegments; ring += 1) {
    const t = ring / tubularSegments
    curve.getPointAt(t, point)
    const normal = frames.normals[ring]
    const binormal = frames.binormals[ring]
    const ringRadius = radiusStart + (radiusEnd - radiusStart) * t

    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const nx = cos * normal.x + sin * binormal.x
      const ny = cos * normal.y + sin * binormal.y
      const nz = cos * normal.z + sin * binormal.z

      positions.push(
        point.x + nx * ringRadius,
        point.y + ny * ringRadius,
        point.z + nz * ringRadius
      )
      normals.push(nx, ny, nz)
    }
  }

  const stride = radialSegments + 1
  for (let ring = 0; ring < tubularSegments; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const a = ring * stride + segment
      const b = (ring + 1) * stride + segment
      const c = (ring + 1) * stride + segment + 1
      const d = ring * stride + segment + 1
      indices.push(a, b, d, b, c, d)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * Uma mão: palma achatada (`hand`), dedos em cápsula (`hand`) e pontas cônicas
 * (`claw`). O grupo devolvido é o pivô do punho, então a task 20 pode girar a
 * mão inteira sem recalcular a pose dos dedos. A mão direita nasce mais
 * fechada para receber o cachimbo da task 18; a esquerda fica aberta.
 */
export function buildHand(ctx: PartContext, side: LimbSide): Group {
  const { radius, materialFor, minimal } = ctx
  const unit = radius * HAND_UNIT

  const hand = new Group()
  hand.name = `caterpillar-hand-${side}`
  hand.userData.side = side
  hand.userData.grip = HAND_GRIP[side]

  const palmGeometry = new SphereGeometry(unit * 1.25, 10, 8)
  const palm = new Mesh(palmGeometry, materialFor('hand'))
  palm.name = 'caterpillar-hand'
  palm.scale.set(1, 1.05, 0.42)
  hand.add(palm)

  const fingers = fingerCount(minimal)
  const fingerLength = unit * 0.8
  const fingerRadius = unit * 0.17
  const clawHeight = unit * 0.34

  for (let index = 0; index < fingers; index += 1) {
    const spread = fingers === 1 ? 0 : index - (fingers - 1) / 2
    const finger = new Group()
    finger.name = `caterpillar-hand-finger-${index + 1}`
    finger.position.set(spread * unit * 0.62, unit * 0.9, unit * 0.05)
    finger.rotation.x = HAND_GRIP[side]
    finger.rotation.z = spread * 0.16

    const shaft = new Mesh(
      new CapsuleGeometry(fingerRadius, fingerLength, 4, 5),
      materialFor('hand')
    )
    shaft.name = `caterpillar-hand-finger-${index + 1}-shaft`
    shaft.position.y = fingerLength / 2
    finger.add(shaft)

    if (!minimal) {
      const claw = new Mesh(new ConeGeometry(unit * 0.15, clawHeight, 5), materialFor('claw'))
      claw.name = `caterpillar-hand-claw-${index + 1}`
      // Base da garra sobreposta à ponta da cápsula, com a ponta para fora.
      claw.position.y = fingerLength + fingerRadius - unit * 0.03 + clawHeight / 2
      finger.add(claw)
    }

    hand.add(finger)
  }

  return hand
}

interface ArmBuild {
  mesh: Mesh
  cuff: Mesh
  curve: CatmullRomCurve3
}

/**
 * Braço curto e rosado (`hand`) com punho em `sleeve`. O esquerdo desce pela
 * lateral e termina sobre a barriga; o direito sobe em direção à boca. A curva
 * começa no ombro (dentro do tronco, como um encaixe) e sai para a lateral
 * antes de descer ou subir, para não atravessar o abdômen.
 */
function buildArm(ctx: PartContext, side: LimbSide): ArmBuild {
  const { radius, materialFor } = ctx
  const anchors = scaleSkeleton(radius)
  const unit = radius * 0.22
  const shoulder = side === 'left' ? anchors.shoulderLeft : anchors.shoulderRight
  const hand = side === 'left' ? anchors.handLeft : anchors.handRight

  const points =
    side === 'left'
      ? [
          shoulder.clone(),
          new Vector3(-1.45, 1.05, 0.45).multiplyScalar(radius),
          new Vector3(-1.55, 0.15, 1.15).multiplyScalar(radius),
          new Vector3(-1.35, -0.8, 1.72).multiplyScalar(radius),
          hand.clone()
        ]
      : [
          shoulder.clone(),
          new Vector3(1.45, 1.9, 0.5).multiplyScalar(radius),
          new Vector3(1.55, 2.25, 1.05).multiplyScalar(radius),
          new Vector3(1.5, 2.45, 1.38).multiplyScalar(radius),
          hand.clone()
        ]

  const curve = new CatmullRomCurve3(points)
  curve.curveType = 'catmullrom'
  curve.tension = 0.45

  const mesh = new Mesh(
    createTaperedTube(
      curve,
      ARM_TUBULAR_SEGMENTS,
      ARM_RADIAL_SEGMENTS,
      radius * ARM_RADIUS_START,
      radius * ARM_RADIUS_END
    ),
    materialFor('hand')
  )
  mesh.name = `caterpillar-arm-${side}`

  const tangent = curve.getTangentAt(1).normalize()
  const cuff = new Mesh(new TorusGeometry(unit * 0.55, unit * 0.14, 5, 10), materialFor('sleeve'))
  cuff.name = `caterpillar-wrist-${side}`
  cuff.position.copy(hand).addScaledVector(tangent, -unit * 0.45)
  cuff.quaternion.setFromUnitVectors(FORWARD, tangent)

  return { mesh, cuff, curve }
}

export interface LimbsPartBuild extends PartBuild {
  hands: Group[]
  feet: Group[]
  armCurves: Record<LimbSide, CatmullRomCurve3>
}

export interface LimbsPartContext extends PartContext {
  /** Y local do plano de apoio do corpo; a sola dos pés fica nessa linha. */
  bodyBaseY: number
}

interface FootDefinition {
  name: string
  anchor: Vector3
}

/**
 * Um pé: sapato arredondado (`hand`) apoiado em `bodyBaseY` e ponta enrolada
 * (`claw`) na frente. O grupo fica na linha do chão, então a task 22 pode
 * enquadrar o avatar sem recalcular a altura.
 */
function buildFoot(ctx: LimbsPartContext, definition: FootDefinition): Group {
  const { radius, materialFor, minimal } = ctx
  const footRadius = radius * FOOT_RADIUS
  const shoeHalfHeight = footRadius * FOOT_HEIGHT_SCALE

  const foot = new Group()
  foot.name = definition.name
  foot.position.set(definition.anchor.x, ctx.bodyBaseY + shoeHalfHeight, definition.anchor.z)

  const shoe = new Mesh(new SphereGeometry(footRadius, 10, 8), materialFor('hand'))
  shoe.name = `${definition.name}-shoe`
  shoe.scale.set(1, FOOT_HEIGHT_SCALE, 1.5)
  foot.add(shoe)

  if (!minimal) {
    const claw = new Mesh(
      new TorusGeometry(footRadius * 0.3, footRadius * 0.08, 4, 8, Math.PI * 1.25),
      materialFor('claw')
    )
    claw.name = `${definition.name}-claw`
    claw.position.set(0, footRadius * 0.12, footRadius * 1.15)
    claw.rotation.y = -Math.PI / 2
    foot.add(claw)
  }

  return foot
}

/**
 * Membros do personagem: mãos, braços, punhos e os quatro pés na base.
 */
export function buildLimbsPart(ctx: LimbsPartContext): LimbsPartBuild {
  const { radius } = ctx
  const anchors = scaleSkeleton(radius)

  const group = new Group()
  group.name = 'caterpillar-limbs'

  const handLeft = buildHand(ctx, 'left')
  handLeft.position.copy(anchors.handLeft)
  // Palma de frente para a câmera e dedos caídos sobre a barriga: a mão aberta
  // fica legível de frente, sem apontar para dentro do tronco.
  handLeft.rotation.set(0, 0, -2.0)
  const handRight = buildHand(ctx, 'right')
  handRight.position.copy(anchors.handRight)
  handRight.rotation.set(-0.22, 0, -0.1)
  const hands = [handLeft, handRight]
  for (const hand of hands) group.add(hand)

  const armLeft = buildArm(ctx, 'left')
  const armRight = buildArm(ctx, 'right')
  group.add(armLeft.mesh, armLeft.cuff, armRight.mesh, armRight.cuff)

  const feet = [
    buildFoot(ctx, { name: 'caterpillar-foot-back-left', anchor: anchors.footBackLeft }),
    buildFoot(ctx, { name: 'caterpillar-foot-back-right', anchor: anchors.footBackRight }),
    buildFoot(ctx, { name: 'caterpillar-foot-front-left', anchor: anchors.footFrontLeft }),
    buildFoot(ctx, { name: 'caterpillar-foot-front-right', anchor: anchors.footFrontRight })
  ]
  for (const foot of feet) group.add(foot)

  return {
    group,
    hands,
    feet,
    armCurves: { left: armLeft.curve, right: armRight.curve },
    dispose: createPartDispose(group)
  }
}
