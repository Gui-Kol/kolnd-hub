import {
  CatmullRomCurve3,
  ConeGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TubeGeometry,
  Vector3
} from 'three'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'
import { scaleSkeleton } from './skeleton'

export interface HeadPartContext extends PartContext {
  /** Ponto final da curva do corpo (pescoço). */
  neck: Vector3
}

export interface HeadPartBuild extends PartBuild {
  head: Mesh
  eyeGroups: Group[]
  pupils: Mesh[]
  lids: Group[]
  antennae: Group[]
  mandibles: Mesh[]
  mouth: Group
  jaw: Group
  mouthCorners: Group[]
  upperLip: Mesh
  lowerLip: Mesh
  mouthInterior: Mesh
  tongue: Mesh
  brows: Group[]
  browLeft: Group
  browRight: Group
  nose: Mesh
  nostrils: Mesh[]
}

/** Rotação da pálpebra quando o olho está totalmente aberto (fora da vista). */
export const EYELID_OPEN_ROTATION = -Math.PI / 2

/** Rotação da pálpebra quando ela cobre o olho inteiro. */
export const EYELID_CLOSED_ROTATION = Math.PI / 2

/**
 * Rotação de repouso: a calota cobre cerca de 35% da área visível do olho, o
 * suficiente para o olhar sonolento da referência sem esconder a íris.
 */
export const EYELID_IDLE_ROTATION = -0.32

/** Abertura de expressão usada como repouso (alvo `idle`). */
export const EYELID_IDLE_OPENNESS = 0.95

/** Proporção alvo da cabeça: mais larga que alta, como na referência. */
const HEAD_WIDTH_SCALE = 1.18

/** Fração do raio em que o topo da esfera é cortado para o turbante assentar. */
const HEAD_TOP_FLAT = 0.84

/**
 * Cabeça, rosto e olhos. Todas as posições derivam do pescoço entregue pelo
 * corpo; a pose de pálpebras e boca é aplicada por `facePose.ts` no laço da
 * cena, sem escalar o olho inteiro.
 *
 * A massa craniana é um elipsoide mais largo que alto com o topo plano. As
 * bochechas, a papada e os traços faciais são volumes separados e nomeados para
 * que a task 18 (turbante) e a task 20 (expressão) possam se apoiar neles sem
 * recalcular a cabeça inteira.
 */
export function buildHeadPart(ctx: HeadPartContext): HeadPartBuild {
  const { radius, materialFor, style, neck } = ctx
  const anchors = scaleSkeleton(radius)
  const headCenter = neck.clone().add(anchors.head.clone().sub(anchors.neck))

  const group = new Group()
  group.name = 'caterpillar-head-group'

  const headRadius = radius * 1.12
  const wideSegments = style === 'wireframe' ? 10 : 18
  const tallSegments = style === 'wireframe' ? 8 : 14

  const headGeometry = new SphereGeometry(headRadius, wideSegments, tallSegments)
  const headPosition = headGeometry.getAttribute('position')
  const flatY = headRadius * HEAD_TOP_FLAT
  for (let vertex = 0; vertex < headPosition.count; vertex += 1) {
    if (headPosition.getY(vertex) > flatY) headPosition.setY(vertex, flatY)
  }
  headPosition.needsUpdate = true
  headGeometry.computeVertexNormals()
  headGeometry.computeBoundingBox()
  headGeometry.computeBoundingSphere()

  const head = new Mesh(headGeometry, materialFor('head'))
  head.name = 'caterpillar-head'
  head.position.copy(headCenter)
  head.scale.set(HEAD_WIDTH_SCALE, 1, 1)
  group.add(head)

  const cheekGeometry = new SphereGeometry(
    headRadius * 0.52,
    style === 'wireframe' ? 8 : 14,
    style === 'wireframe' ? 6 : 10
  )
  for (const side of [-1, 1]) {
    const cheek = new Mesh(cheekGeometry, materialFor('head'))
    cheek.name = `caterpillar-cheek-${side < 0 ? 'left' : 'right'}`
    cheek.position.set(
      headCenter.x + side * headRadius * 0.78,
      headCenter.y - headRadius * 0.3,
      headCenter.z + headRadius * 0.66
    )
    cheek.scale.set(1.05, 0.92, 0.82)
    group.add(cheek)
  }

  const jowlGeometry = new SphereGeometry(
    headRadius * 0.62,
    style === 'wireframe' ? 8 : 14,
    style === 'wireframe' ? 6 : 10
  )
  const jowl = new Mesh(jowlGeometry, materialFor('head'))
  jowl.name = 'caterpillar-jowl'
  jowl.position.set(
    headCenter.x,
    headCenter.y - headRadius * 0.92,
    headCenter.z + headRadius * 0.34
  )
  jowl.scale.set(1.15, 0.42, 0.72)
  group.add(jowl)

  // Sobrancelha em arco contínuo: um tubo fino sobre uma curva suave, com um
  // reforço no centro para a espessura variar como na referência.
  const brows: Group[] = []
  let browLeft: Group | null = null
  let browRight: Group | null = null

  for (const side of [-1, 1]) {
    const brow = new Group()
    brow.name = `caterpillar-brow-${side < 0 ? 'left' : 'right'}`
    brow.position.set(
      headCenter.x + side * headRadius * 0.44,
      headCenter.y + headRadius * 0.55,
      headCenter.z + headRadius * 0.8
    )

    const browCurve = new CatmullRomCurve3([
      new Vector3(-headRadius * 0.3, -headRadius * 0.03, 0),
      new Vector3(-headRadius * 0.12, headRadius * 0.07, headRadius * 0.01),
      new Vector3(0, headRadius * 0.1, headRadius * 0.02),
      new Vector3(headRadius * 0.12, headRadius * 0.06, headRadius * 0.01),
      new Vector3(headRadius * 0.3, -headRadius * 0.02, 0)
    ])
    const browGeometry = new TubeGeometry(
      browCurve,
      style === 'wireframe' ? 5 : 10,
      headRadius * 0.055,
      style === 'wireframe' ? 4 : 6,
      false
    )
    const browTube = new Mesh(browGeometry, materialFor('brow'))
    browTube.name = 'caterpillar-brow-tube'
    brow.add(browTube)

    const browThickGeometry = new SphereGeometry(
      headRadius * 0.12,
      style === 'wireframe' ? 6 : 10,
      style === 'wireframe' ? 4 : 8
    )
    const browThick = new Mesh(browThickGeometry, materialFor('brow'))
    browThick.name = 'caterpillar-brow-thick'
    browThick.position.set(0, headRadius * 0.06, headRadius * 0.03)
    browThick.scale.set(0.9, 0.55, 0.5)
    brow.add(browThick)

    group.add(brow)
    brows.push(brow)
    if (side < 0) browLeft = brow
    else browRight = brow
  }

  if (!browLeft || !browRight) throw new Error('caterpillar: sobrancelhas incompletas')

  const eyeRadius = headRadius * 0.27
  const eyeGroups: Group[] = []
  const pupils: Mesh[] = []
  const lids: Group[] = []

  for (const side of [-1, 1]) {
    const eye = new Group()
    eye.name = `caterpillar-eye-${side < 0 ? 'left' : 'right'}`
    eye.position.set(
      headCenter.x + side * headRadius * 0.42,
      headCenter.y + headRadius * 0.14,
      headCenter.z + headRadius * 0.8
    )

    const sclera = new Mesh(
      new SphereGeometry(eyeRadius, style === 'wireframe' ? 8 : 14, style === 'wireframe' ? 6 : 10),
      materialFor('sclera')
    )
    sclera.name = 'caterpillar-sclera'
    sclera.scale.set(1, 1, 0.85)
    eye.add(sclera)

    const iris = new Mesh(
      new SphereGeometry(
        eyeRadius * 0.45,
        style === 'wireframe' ? 6 : 12,
        style === 'wireframe' ? 4 : 8
      ),
      materialFor('iris')
    )
    iris.name = 'caterpillar-iris'
    iris.position.set(0, -eyeRadius * 0.02, eyeRadius * 0.76)
    iris.scale.set(1, 1, 0.25)
    eye.add(iris)

    const pupil = new Mesh(
      new SphereGeometry(
        eyeRadius * 0.18,
        style === 'wireframe' ? 6 : 10,
        style === 'wireframe' ? 4 : 8
      ),
      materialFor('pupil')
    )
    pupil.name = 'caterpillar-pupil'
    pupil.position.set(0, -eyeRadius * 0.02, eyeRadius * 0.8)
    pupil.scale.set(1, 1, 0.8)
    eye.add(pupil)
    pupils.push(pupil)

    const highlight = new Mesh(new SphereGeometry(eyeRadius * 0.14, 8, 6), materialFor('highlight'))
    highlight.name = 'caterpillar-highlight'
    highlight.position.set(-eyeRadius * 0.18, eyeRadius * 0.18, eyeRadius * 0.88)
    eye.add(highlight)

    // Pálpebra superior: calota esférica em um pivô próprio. Girar o pivô
    // fecha o olho sem esmagar a pupila, ao contrário do scale.y antigo.
    const lid = new Group()
    lid.name = 'caterpillar-eyelid'
    const lidGeometry = new SphereGeometry(
      eyeRadius * 1.06,
      style === 'wireframe' ? 8 : 12,
      style === 'wireframe' ? 5 : 8,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2
    )
    const lidShell = new Mesh(lidGeometry, materialFor('eyelid'))
    lidShell.name = 'caterpillar-eyelid-shell'
    lid.add(lidShell)
    lid.rotation.x = EYELID_IDLE_ROTATION
    eye.add(lid)
    lids.push(lid)

    group.add(eye)
    eyeGroups.push(eye)
  }

  // Focinho largo e achatado, entre os olhos e a boca. A distância em Z até o
  // lábio superior fica registrada em docs/avatar-appearance.md para a task 19
  // calibrar a sombra sem endurecer o contorno.
  const nose = new Mesh(
    new SphereGeometry(
      headRadius * 0.22,
      style === 'wireframe' ? 8 : 14,
      style === 'wireframe' ? 6 : 10
    ),
    materialFor('head')
  )
  nose.name = 'caterpillar-nose'
  nose.position.set(headCenter.x, headCenter.y, headCenter.z + headRadius * 0.93)
  nose.scale.set(1.35, 0.55, 0.55)
  group.add(nose)

  const nostrilGroup = new Group()
  nostrilGroup.name = 'caterpillar-nostrils'
  nostrilGroup.position.set(
    nose.position.x,
    nose.position.y - headRadius * 0.02,
    nose.position.z + headRadius * 0.09
  )
  const nostrilGeometry = new SphereGeometry(
    headRadius * 0.045,
    style === 'wireframe' ? 6 : 10,
    style === 'wireframe' ? 4 : 6
  )
  const nostrils: Mesh[] = []
  for (const side of [-1, 1]) {
    const nostril = new Mesh(nostrilGeometry, materialFor('mouth'))
    nostril.name = `caterpillar-nostril-${side < 0 ? 'left' : 'right'}`
    nostril.position.set(side * headRadius * 0.11, 0, 0)
    nostril.scale.set(1, 0.6, 0.5)
    nostrilGroup.add(nostril)
    nostrils.push(nostril)
  }
  group.add(nostrilGroup)

  const antennae: Group[] = []
  for (const side of [-1, 1]) {
    const antenna = new Group()
    antenna.name = `caterpillar-antenna-${side < 0 ? 'left' : 'right'}`
    antenna.position.set(
      headCenter.x + side * headRadius * 0.18,
      headCenter.y + headRadius * 0.78,
      headCenter.z + headRadius * 0.56
    )

    const antennaCurve = new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(side * headRadius * 0.05, headRadius * 0.55, headRadius * 0.08),
      new Vector3(side * headRadius * 0.16, headRadius * 1.05, headRadius * 0.22)
    ])
    const antennaGeometry = new TubeGeometry(
      antennaCurve,
      style === 'wireframe' ? 5 : 8,
      headRadius * 0.035,
      style === 'wireframe' ? 4 : 6,
      false
    )
    const tube = new Mesh(antennaGeometry, materialFor('antenna'))
    tube.name = 'caterpillar-antenna-tube'
    antenna.add(tube)

    const tipGeometry = new SphereGeometry(headRadius * 0.05, 8, 6)
    const tip = new Mesh(tipGeometry, materialFor('antenna'))
    tip.name = 'caterpillar-antenna-tip'
    tip.position.copy(antennaCurve.getPointAt(1))
    antenna.add(tip)

    antenna.rotation.z = side * 0.12
    group.add(antenna)
    antennae.push(antenna)
  }

  // Mandíbulas herdadas do contrato: pequenas e encostadas no canto da boca
  // para não competir com o rosto humano da referência.
  const mandibleGeometry = new ConeGeometry(headRadius * 0.045, headRadius * 0.14, 8)
  const mandibles: Mesh[] = []
  for (const side of [-1, 1]) {
    const mandible = new Mesh(mandibleGeometry, materialFor('mandible'))
    mandible.name = `caterpillar-mandible-${side < 0 ? 'left' : 'right'}`
    mandible.position.set(
      headCenter.x + side * headRadius * 0.52,
      headCenter.y - headRadius * 0.36,
      headCenter.z + headRadius * 0.84
    )
    mandible.rotation.x = Math.PI - 0.25
    group.add(mandible)
    mandibles.push(mandible)
  }

  // Boca grande e sorridente: dois lábios em arco sobre a mesma linha de
  // sorriso, cantos próprios, interior escuro e língua. O `jaw` gira em torno
  // de um pivô atrás da boca e leva o lábio inferior junto ao abrir; em
  // repouso os lábios se tocam, sem fresta.
  const mouth = new Group()
  mouth.name = 'caterpillar-mouth'
  mouth.position.set(
    headCenter.x,
    headCenter.y - headRadius * 0.42,
    headCenter.z + headRadius * 0.95
  )
  group.add(mouth)

  const mouthInterior = new Mesh(
    new SphereGeometry(
      headRadius * 0.42,
      style === 'wireframe' ? 8 : 16,
      style === 'wireframe' ? 6 : 12
    ),
    materialFor('mouth')
  )
  mouthInterior.name = 'caterpillar-mouth-interior'
  mouthInterior.position.set(0, -headRadius * 0.02, -headRadius * 0.02)
  mouthInterior.scale.set(0.95, 0.38, 0.12)
  mouth.add(mouthInterior)

  const jaw = new Group()
  jaw.name = 'caterpillar-jaw'
  jaw.position.set(0, 0, -headRadius * 0.52)
  mouth.add(jaw)

  const tongue = new Mesh(
    new SphereGeometry(
      headRadius * 0.2,
      style === 'wireframe' ? 6 : 12,
      style === 'wireframe' ? 4 : 8
    ),
    materialFor('tongue')
  )
  tongue.name = 'caterpillar-tongue'
  tongue.position.set(0, -headRadius * 0.1, headRadius * 0.52)
  tongue.scale.set(0.9, 0.35, 0.35)
  jaw.add(tongue)

  const smilePoints = [
    new Vector3(-headRadius * 0.55, headRadius * 0.16, 0),
    new Vector3(-headRadius * 0.28, 0, headRadius * 0.02),
    new Vector3(0, -headRadius * 0.05, headRadius * 0.035),
    new Vector3(headRadius * 0.28, 0, headRadius * 0.02),
    new Vector3(headRadius * 0.55, headRadius * 0.16, 0)
  ]
  const upperLipCurve = new CatmullRomCurve3(
    smilePoints.map((point) => new Vector3(point.x, point.y + headRadius * 0.04, point.z))
  )
  const lowerLipCurve = new CatmullRomCurve3(
    smilePoints.map(
      (point) => new Vector3(point.x, point.y - headRadius * 0.04, point.z + headRadius * 0.52)
    )
  )
  const lipSegments = style === 'wireframe' ? 7 : 12
  const lipRadial = style === 'wireframe' ? 4 : 6

  const upperLip = new Mesh(
    new TubeGeometry(upperLipCurve, lipSegments, headRadius * 0.045, lipRadial, false),
    materialFor('lip')
  )
  upperLip.name = 'caterpillar-lip-upper'
  mouth.add(upperLip)

  const lowerLip = new Mesh(
    new TubeGeometry(lowerLipCurve, lipSegments, headRadius * 0.045, lipRadial, false),
    materialFor('lip')
  )
  lowerLip.name = 'caterpillar-lip-lower'
  jaw.add(lowerLip)

  const mouthCorners: Group[] = []
  for (const side of [-1, 1]) {
    const corner = new Group()
    corner.name = `caterpillar-mouth-corner-${side < 0 ? 'left' : 'right'}`
    corner.position.set(side * headRadius * 0.55, headRadius * 0.16, 0)
    mouth.add(corner)
    mouthCorners.push(corner)
  }

  return {
    group,
    head,
    eyeGroups,
    pupils,
    lids,
    antennae,
    mandibles,
    mouth,
    jaw,
    mouthCorners,
    upperLip,
    lowerLip,
    mouthInterior,
    tongue,
    brows,
    browLeft,
    browRight,
    nose,
    nostrils,
    dispose: createPartDispose(group)
  }
}
