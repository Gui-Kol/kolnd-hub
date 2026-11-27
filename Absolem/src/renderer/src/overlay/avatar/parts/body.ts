import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from 'three'
import { createSeededRandom } from '../caterpillar'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'
import { scaleSkeleton } from './skeleton'

const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, 1)
const IDENTITY = new Quaternion()

/** Quantidade de segmentos do corpo em detalhe cheio (referência da silhueta). */
const FULL_DETAIL_SEGMENTS = 9

/** Achatamento de profundidade (Z) dos segmentos e das placas. */
const DEPTH_SCALE = 0.72

/** Achatamento padrão no eixo do corpo (Y) para 9 segmentos. */
const AXIS_SCALE = 0.46

/** Onde o fundo da esfera é cortado para formar a base plana. */
const BASE_CLAMP = 0.8

/** Placas claras da barriga (faixa ventral). */
const BELLY_PLATES = 5

export interface BodyRing {
  index: number
  position: Vector3
  tangent: Vector3
  majorRadius: number
  tubeRadius: number
}

export interface BodyPartBuild extends PartBuild {
  segments: Mesh[]
  curve: CatmullRomCurve3
  /** Ponto final da curva: o pescoço que a cabeça usa como âncora. */
  neck: Vector3
  /** Anéis de dobra efetivamente gerados (0 no modo mínimo). */
  rings: BodyRing[]
  belly: Group
  bellyPlates: InstancedMesh
  tailCurve: CatmullRomCurve3
  tailTip: Vector3
  tailRadius: number
  /** Y local do plano de apoio; a task 22 aplica o scale do root. */
  bodyBaseY: number
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Raio do corpo em função de t (0 = quadril, 1 = pescoço). */
function bodyRadiusAt(t: number, radius: number): number {
  const factor =
    t <= 0.45 ? 1.3 + 0.15 * smoothstep(0, 0.45, t) : 1.45 - 0.7 * smoothstep(0.45, 1, t)
  return radius * factor
}

/**
 * Concatena geometrias em uma única malha não indexada. É o suficiente para
 * juntar anéis e cauda em uma draw call sem depender de addons do three.
 * As geometrias de origem são descartadas ao final.
 */
function mergeDetailGeometries(geometries: BufferGeometry[]): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const temporary: BufferGeometry[] = []

  for (const source of geometries) {
    const geometry = source.index ? source.toNonIndexed() : source
    if (geometry !== source) temporary.push(geometry)

    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')

    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index))
      if (normal) normals.push(normal.getX(index), normal.getY(index), normal.getZ(index))
      if (uv) uvs.push(uv.getX(index), uv.getY(index))
    }
  }

  const merged = new BufferGeometry()
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3))
  if (normals.length === positions.length) {
    merged.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  }
  if (uvs.length === (positions.length / 3) * 2) {
    merged.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  }
  merged.computeBoundingBox()
  merged.computeBoundingSphere()

  for (const geometry of [...geometries, ...temporary]) geometry.dispose()
  return merged
}

/**
 * Corpo sentado: curva vertical em S, segmentos achatados e anéis de dobra.
 *
 * Base em `hips`, abdômen projetado para frente, tórax inclinado para trás e
 * pescoço curto em `neck`. As âncoras vêm de `skeleton.ts`, então nenhum outro
 * módulo repete as proporções. O grupo `caterpillar-body` continua sendo o pai
 * de todos os segmentos; barriga e detalhes ficam em grupos nomeados dentro
 * dele.
 */
export function buildBodyPart(ctx: PartContext): BodyPartBuild {
  const { radius, materialFor, style, segments: segmentsCount, seed, minimal } = ctx
  const random = createSeededRandom(seed)
  const anchors = scaleSkeleton(radius)

  const group = new Group()
  group.name = 'caterpillar-body'

  const curve = new CatmullRomCurve3([
    anchors.hips.clone(),
    anchors.bellyCenter.clone(),
    anchors.chest.clone(),
    anchors.neck.clone()
  ])
  curve.curveType = 'catmullrom'
  curve.tension = 0.35

  const count = Math.max(1, segmentsCount)
  // Com menos segmentos o corpo precisa de esferas mais altas para não abrir
  // vãos entre elas; o modo normal mantém o achatamento da referência.
  const axisScale = Math.min(0.9, (AXIS_SCALE * FULL_DETAIL_SEGMENTS) / count)

  const wideSegments = style === 'wireframe' ? 10 : 14
  const tallSegments = style === 'wireframe' ? 8 : 10
  const segments: Mesh[] = []
  const centers: Vector3[] = []
  const radii: number[] = []

  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0 : index / (count - 1)
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t).normalize()
    const radiusAt = bodyRadiusAt(t, radius)
    const wobble = style === 'liquid' ? 0.86 + random() * 0.28 : 1
    const segmentRadius = radiusAt * wobble

    const geometry = new SphereGeometry(segmentRadius, wideSegments, tallSegments)

    // O primeiro segmento tem a base plana e fica alinhado ao mundo para o
    // apoio não ficar inclinado; os demais seguem a tangente da curva.
    if (index === 0) {
      const position = geometry.getAttribute('position')
      const floor = -BASE_CLAMP * segmentRadius
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        if (position.getY(vertex) < floor) position.setY(vertex, floor)
      }
      position.needsUpdate = true
      geometry.computeVertexNormals()
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
    }

    const segment = new Mesh(geometry, materialFor('body'))
    segment.name = `caterpillar-segment-${index}`
    segment.position.copy(point)
    segment.position.x += (random() - 0.5) * radius * 0.025
    if (index > 0) segment.quaternion.setFromUnitVectors(UP, tangent)
    segment.scale.set(1, axisScale, DEPTH_SCALE)

    group.add(segment)
    segments.push(segment)
    centers.push(point.clone())
    radii.push(segmentRadius)
  }

  const bodyBaseY = centers[0].y - BASE_CLAMP * radii[0] * axisScale

  // Anéis de dobra: ficam no plano de contato entre dois segmentos e usam o
  // mesmo tom `body` (sem transparência). São juntados com a cauda em uma
  // única malha para não estourar o orçamento de draw calls.
  const rings: BodyRing[] = []
  const detailGeometries: BufferGeometry[] = []

  if (!minimal && count > 1) {
    const tubeSegments = style === 'wireframe' ? 12 : 18
    const radialSegments = style === 'wireframe' ? 5 : 6

    for (let index = 0; index < count - 1; index += 1) {
      const t = (index + 0.5) / (count - 1)
      const position = curve.getPointAt(t)
      const tangent = curve.getTangentAt(t).normalize()

      const crossRadius = (segmentIndex: number): number => {
        const distance = Math.abs(position.clone().sub(centers[segmentIndex]).dot(tangent))
        const halfAxis = radii[segmentIndex] * axisScale
        if (distance >= halfAxis) return 0
        return radii[segmentIndex] * Math.sqrt(1 - (distance / halfAxis) ** 2)
      }

      const crossA = crossRadius(index)
      const crossB = crossRadius(index + 1)
      const visibleCross = Math.min(crossA || crossB, crossB || crossA)
      const minSegmentRadius = Math.min(radii[index], radii[index + 1])
      const majorRadius = Math.max(
        radius * 0.01,
        Math.min(visibleCross * 1.03, minSegmentRadius * 0.9)
      )
      const tubeRadius = Math.max(radius * 0.006, majorRadius * 0.075)

      const geometry = new TorusGeometry(majorRadius, tubeRadius, radialSegments, tubeSegments)
      const quaternion = new Quaternion().setFromUnitVectors(FORWARD, tangent)
      const matrix = new Matrix4().compose(position, quaternion, new Vector3(1, DEPTH_SCALE, 1))
      geometry.applyMatrix4(matrix)
      detailGeometries.push(geometry)

      rings.push({
        index,
        position: position.clone(),
        tangent: tangent.clone(),
        majorRadius,
        tubeRadius
      })
    }
  }

  // Cauda: sai de `hips`, desce e se enrola para dentro, terminando em ponta
  // arredondada. A curva é curta para não invadir a área de clique.
  const tailRadius = radius * 0.18
  const tailTip = anchors.tailTip.clone()
  const tailCurve = new CatmullRomCurve3(
    [
      anchors.hips.clone().add(new Vector3(0.05 * radius, -0.05 * radius, 0.1 * radius)),
      new Vector3(-0.7 * radius, -3.72 * radius, 0.2 * radius),
      new Vector3(-1.4 * radius, -3.78 * radius, 0.22 * radius),
      new Vector3(-1.92 * radius, -3.66 * radius, 0.22 * radius),
      new Vector3(-2.08 * radius, -3.4 * radius, 0.22 * radius),
      new Vector3(-1.84 * radius, -3.28 * radius, 0.22 * radius),
      tailTip.clone()
    ],
    false,
    'catmullrom',
    0.5
  )

  const tailGeometry = new TubeGeometry(
    tailCurve,
    style === 'wireframe' ? 12 : 24,
    tailRadius,
    style === 'wireframe' ? 5 : 8,
    false
  )
  detailGeometries.push(tailGeometry)

  const tailTipGeometry = new SphereGeometry(
    radius * 0.2,
    style === 'wireframe' ? 6 : 8,
    style === 'wireframe' ? 4 : 6
  )
  tailTipGeometry.translate(tailTip.x, tailTip.y, tailTip.z)
  detailGeometries.push(tailTipGeometry)

  const detailMesh = new Mesh(mergeDetailGeometries(detailGeometries), materialFor('body'))
  detailMesh.name = 'caterpillar-body-detail'
  group.add(detailMesh)

  // Barriga: 5 placas claras, achatadas, acompanhando a curva e ligeiramente
  // à frente dos segmentos. Uma InstancedMesh mantém a faixa em uma draw call.
  const belly = new Group()
  belly.name = 'caterpillar-belly'

  const plateGeometry = new SphereGeometry(
    1,
    style === 'wireframe' ? 8 : 12,
    style === 'wireframe' ? 6 : 8
  )
  const bellyPlates = new InstancedMesh(plateGeometry, materialFor('belly'), BELLY_PLATES)
  bellyPlates.name = 'caterpillar-belly-plates'
  const plateMatrix = new Matrix4()
  const plateScale = new Vector3()

  for (let index = 0; index < BELLY_PLATES; index += 1) {
    const t = 0.1 + index * 0.17
    const point = curve.getPointAt(t)
    const radiusAt = bodyRadiusAt(t, radius)
    plateScale.set(radiusAt * 0.58, radiusAt * 0.2, radiusAt * 0.1)
    plateMatrix.compose(
      new Vector3(point.x, point.y, point.z + radiusAt * DEPTH_SCALE * 0.92),
      IDENTITY,
      plateScale
    )
    bellyPlates.setMatrixAt(index, plateMatrix)
  }
  bellyPlates.instanceMatrix.needsUpdate = true
  bellyPlates.computeBoundingSphere()
  belly.add(bellyPlates)
  group.add(belly)

  return {
    group,
    segments,
    curve,
    neck: anchors.neck.clone(),
    rings,
    belly,
    bellyPlates,
    tailCurve,
    tailTip,
    tailRadius: radius * 0.2,
    bodyBaseY,
    dispose: createPartDispose(group)
  }
}
