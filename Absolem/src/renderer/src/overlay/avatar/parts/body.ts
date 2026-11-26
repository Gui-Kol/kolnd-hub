import { CatmullRomCurve3, Group, Mesh, SphereGeometry, Vector3 } from 'three'
import { createSeededRandom } from '../caterpillar'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'

export interface BodyPartBuild extends PartBuild {
  segments: Mesh[]
  curve: CatmullRomCurve3
  /** Ponto final da curva: o pescoço que a cabeça usa como âncora. */
  neck: Vector3
}

/**
 * Segmentos do corpo sobre uma curva `CatmullRomCurve3`. A seed alimenta um
 * PRNG determinístico: mesma seed, mesma malha. Cauda fina e tronco cheio
 * mantêm a leitura de lagarta.
 */
export function buildBodyPart(ctx: PartContext): BodyPartBuild {
  const { radius, materialFor, style, segments: segmentsCount, curvature, seed } = ctx
  const random = createSeededRandom(seed)

  const group = new Group()
  group.name = 'caterpillar-body'

  const bend = Math.max(0.08, curvature) * 0.18 * radius
  const curve = new CatmullRomCurve3([
    new Vector3(-1.18 * radius * 4.9, -0.03, 0),
    new Vector3(-0.68 * radius * 4.9, bend, bend * 0.7),
    new Vector3(-0.18 * radius * 4.9, -bend, bend),
    new Vector3(0.34 * radius * 4.9, bend * 0.8, bend * 0.4),
    new Vector3(0.86 * radius * 4.9, 0, 0)
  ])
  curve.curveType = 'catmullrom'
  curve.tension = 0.5

  const wideSegments = style === 'wireframe' ? 10 : 14
  const tallSegments = style === 'wireframe' ? 8 : 10
  const segments: Mesh[] = []

  for (let index = 0; index < segmentsCount; index += 1) {
    const t = segmentsCount === 1 ? 1 : (index + 0.5) / segmentsCount
    const point = curve.getPointAt(t)
    // Cauda fina, tronco cheio: a silhueta lê como lagarta.
    const taper = 0.62 + 0.38 * t
    const wobble = style === 'liquid' ? 0.86 + random() * 0.28 : 1
    const geometry = new SphereGeometry(radius * taper * wobble, wideSegments, tallSegments)
    const segment = new Mesh(geometry, materialFor('body'))
    segment.name = `caterpillar-segment-${index}`
    segment.position.copy(point)
    segment.position.y += (random() - 0.5) * radius * 0.12
    // Alonga no eixo do corpo para os segmentos se sobreporem de leve.
    segment.scale.set(1.12, 1, 1)
    group.add(segment)
    segments.push(segment)
  }

  return {
    group,
    segments,
    curve,
    neck: curve.getPointAt(1),
    dispose: createPartDispose(group)
  }
}
