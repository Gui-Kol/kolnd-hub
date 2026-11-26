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

export interface HeadPartContext extends PartContext {
  /** Ponto final da curva do corpo (pescoço). */
  neck: Vector3
}

export interface HeadPartBuild extends PartBuild {
  head: Mesh
  eyeGroups: Group[]
  pupils: Mesh[]
  antennae: Group[]
  mandibles: Mesh[]
  mouth: Mesh
}

/**
 * Cabeça, olhos, pupilas, antenas e mandíbulas. Todas as posições derivam do
 * pescoço entregue pelo corpo; a boca continua sendo a malha que o lip-sync
 * escala no laço da cena.
 */
export function buildHeadPart(ctx: HeadPartContext): HeadPartBuild {
  const { radius, materialFor, style, neck } = ctx

  const group = new Group()
  group.name = 'caterpillar-head-group'

  const headGeometry = new SphereGeometry(
    radius * 1.2,
    style === 'wireframe' ? 12 : 18,
    style === 'wireframe' ? 10 : 14
  )
  const head = new Mesh(headGeometry, materialFor('head'))
  head.name = 'caterpillar-head'
  head.position.set(neck.x + radius * 1.15, neck.y + radius * 0.7, 0)
  head.scale.set(1.12, 1, 1)
  group.add(head)

  const eyeWhiteGeometry = new SphereGeometry(radius * 0.42, 10, 8)
  const pupilGeometry = new SphereGeometry(radius * 0.2, 8, 6)
  const eyeGroups: Group[] = []
  const pupils: Mesh[] = []

  for (const side of [-1, 1]) {
    const eye = new Group()
    eye.name = `caterpillar-eye-${side < 0 ? 'left' : 'right'}`
    eye.position.set(
      head.position.x + radius * 0.72,
      head.position.y + radius * 0.18,
      side * radius * 0.72
    )

    const white = new Mesh(eyeWhiteGeometry, materialFor('sclera'))
    white.name = 'caterpillar-eye-white'
    eye.add(white)

    const pupil = new Mesh(pupilGeometry, materialFor('pupil'))
    pupil.name = 'caterpillar-pupil'
    pupil.position.x = radius * 0.28
    eye.add(pupil)

    group.add(eye)
    eyeGroups.push(eye)
    pupils.push(pupil)
  }

  const antennae: Group[] = []
  for (const side of [-1, 1]) {
    const antenna = new Group()
    antenna.name = `caterpillar-antenna-${side < 0 ? 'left' : 'right'}`
    antenna.position.set(
      head.position.x - radius * 0.05,
      head.position.y + radius * 0.9,
      side * radius * 0.34
    )

    const antennaCurve = new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(radius * 0.08, radius * 0.95, side * radius * 0.28),
      new Vector3(radius * 0.42, radius * 1.55, side * radius * 0.58)
    ])
    const antennaGeometry = new TubeGeometry(
      antennaCurve,
      style === 'wireframe' ? 5 : 7,
      radius * 0.06,
      style === 'wireframe' ? 4 : 6,
      false
    )
    const tube = new Mesh(antennaGeometry, materialFor('antenna'))
    tube.name = 'caterpillar-antenna-tube'
    antenna.add(tube)

    // Ponto luminoso na ponta: ajuda a ler a antena em 64 px.
    const tipGeometry = new SphereGeometry(radius * 0.13, 8, 6)
    const tip = new Mesh(tipGeometry, materialFor('antenna'))
    tip.position.copy(antennaCurve.getPointAt(1))
    antenna.add(tip)

    antenna.rotation.z = side * 0.18
    group.add(antenna)
    antennae.push(antenna)
  }

  const mandibleGeometry = new ConeGeometry(radius * 0.16, radius * 0.55, 8)
  const mandibles: Mesh[] = []
  for (const side of [-1, 1]) {
    const mandible = new Mesh(mandibleGeometry, materialFor('mandible'))
    mandible.name = `caterpillar-mandible-${side < 0 ? 'left' : 'right'}`
    mandible.position.set(
      head.position.x + radius * 0.86,
      head.position.y - radius * 0.62,
      side * radius * 0.3
    )
    mandible.rotation.z = -Math.PI / 2.6
    mandible.rotation.x = side * 0.28
    group.add(mandible)
    mandibles.push(mandible)
  }

  const mouthGeometry = new SphereGeometry(radius * 0.52, 14, 10)
  const mouth = new Mesh(mouthGeometry, materialFor('mouth'))
  mouth.name = 'caterpillar-mouth'
  mouth.position.set(head.position.x + radius * 0.82, head.position.y - radius * 0.32, 0)
  mouth.scale.set(0.55, 0.3, 0.9)
  group.add(mouth)

  return {
    group,
    head,
    eyeGroups,
    pupils,
    antennae,
    mandibles,
    mouth,
    dispose: createPartDispose(group)
  }
}
