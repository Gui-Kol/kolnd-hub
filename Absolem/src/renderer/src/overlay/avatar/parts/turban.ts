import { Box3, Group, Mesh, SphereGeometry, TorusGeometry } from 'three'
import type { HeadPartBuild } from './head'
import type { CaterpillarMaterialRole } from '../caterpillar'
import type { PartBuild, PartContext } from './types'
import { createPartDispose } from './types'

/** Inclinação do turbante para a direita, em graus (faixa pedida: 10-15). */
export const TURBAN_TILT_DEGREES = 12

/**
 * Raio horizontal da calota em múltiplos do raio da cabeça. Fica ligeiramente
 * maior que o crânio (1.18 R de meia-largura) e abaixo do teto de 1.35 R.
 */
export const TURBAN_RADIUS_SCALE = 1.26

/** Achatamento vertical da calota: pano enrolado, não um capacete alto. */
const TURBAN_CAP_HEIGHT_SCALE = 0.42

/** A calota passa um pouco da linha do equador para não abrir fresta. */
const TURBAN_CAP_THETA = Math.PI * 0.62

/** Quanto a base da calota desce sobre o topo plano da cabeça. */
const TURBAN_CAP_SINK = 0.06

/** Faixas enroladas em arco parcial (a referência tem listras largas). */
export const TURBAN_WRAP_COUNT = 5

/** Largura mínima de uma listra, em frações do raio da cabeça. */
export const TURBAN_STRIPE_MIN_WIDTH = 0.03

/**
 * Alturas relativas ao topo da cabeça, raios e espessuras das faixas. As faixas
 * sobem acompanhando a cúpula; a espessura muda para sugerir pano sobreposto.
 */
const WRAP_HEIGHTS = [0.03, 0.1, 0.18, 0.25, 0.32]
const WRAP_RADII = [1.27, 1.23, 1.17, 1.09, 0.99]
const WRAP_TUBES = [0.085, 0.11, 0.075, 0.1, 0.08]
const WRAP_SPINS = [0.24, -0.34, 0.52, -0.16, 0.74]
const WRAP_ARCS = [1.62, 1.44, 1.7, 1.5, 1.58]
const WRAP_STARTS = [0.15, -0.35, 0.6, -0.1, 0.95]
const WRAP_WOBBLES = [0.04, -0.03, 0.05, -0.02, 0.03]

export interface TurbanPartContext extends PartContext {
  head: HeadPartBuild
}

export interface TurbanPartBuild extends PartBuild {
  /** Calota base; os enrolamentos da T2 ficam em `wraps`. */
  cap: Mesh
  wraps: Group
  /** Nó frontal com duas lóbulos, dobra e ponto de luz. */
  knot: Group
  /** Pingente de duas esferas; a task 20 anima como `antennaLift`. */
  tassel: Group
  /** Inclinação aplicada à calota, em radianos. */
  tiltRadians: number
  /** No look novo as antenas ficam escondidas sob o pano. */
  hidesAntennae: boolean
}

function detailSegments(ctx: PartContext): { wide: number; tall: number } {
  return ctx.style === 'wireframe' ? { wide: 12, tall: 7 } : { wide: 20, tall: 10 }
}

/**
 * Turbante procedural: calota achatada sobre o topo plano do crânio da task 16,
 * inclinada para a direita. A cabeça tem o topo cortado em 0.84 R, então a
 * calota desce alguns centésimos de R sobre esse plano e envolve a borda sem
 * deixar fresta. As antenas continuam existindo no contrato (o acessório
 * `antenna_glow` depende delas), mas ficam invisíveis: o pano é o novo topo da
 * silhueta, como na referência.
 */
export function buildTurbanPart(ctx: TurbanPartContext): TurbanPartBuild {
  const { head, materialFor, style } = ctx
  const group = new Group()
  group.name = 'caterpillar-turban'

  head.head.updateWorldMatrix(true, false)
  head.head.geometry.computeBoundingSphere()
  const headBox = new Box3().setFromObject(head.head)
  const headRadius = head.head.geometry.boundingSphere?.radius ?? ctx.radius
  const headTop = headBox.max.y
  const headCenter = head.head.position
  const { wide, tall } = detailSegments(ctx)
  const tiltRadians = (TURBAN_TILT_DEGREES * Math.PI) / 180
  const capRadius = headRadius * TURBAN_RADIUS_SCALE

  const capGeometry = new SphereGeometry(capRadius, wide, tall, 0, Math.PI * 2, 0, TURBAN_CAP_THETA)
  capGeometry.computeBoundingSphere()
  const cap = new Mesh(capGeometry, materialFor('turban'))
  cap.name = 'caterpillar-turban-cap'
  cap.userData.materialRole = 'turban'
  cap.scale.set(1, TURBAN_CAP_HEIGHT_SCALE, 1)
  cap.position.set(headCenter.x, headTop - headRadius * TURBAN_CAP_SINK, headCenter.z)
  cap.rotation.z = -tiltRadians
  group.add(cap)

  const wraps = new Group()
  wraps.name = 'caterpillar-turban-wraps'
  group.add(wraps)

  if (!ctx.minimal) {
    const wrapRadial = style === 'wireframe' ? 4 : 6
    const wrapTubular = style === 'wireframe' ? 9 : 14

    for (let index = 0; index < TURBAN_WRAP_COUNT; index += 1) {
      const role: CaterpillarMaterialRole = index % 2 === 0 ? 'turban' : 'turbanStripe'
      const band = new Group()
      band.name = `caterpillar-turban-wrap-${index + 1}`
      band.position.set(headCenter.x, headTop + headRadius * WRAP_HEIGHTS[index], headCenter.z)
      band.rotation.z = -tiltRadians + WRAP_WOBBLES[index]
      band.rotation.y = WRAP_SPINS[index]

      const bandGeometry = new TorusGeometry(
        headRadius * WRAP_RADII[index],
        headRadius * WRAP_TUBES[index],
        wrapRadial,
        wrapTubular,
        Math.PI * WRAP_ARCS[index]
      )
      // O toro nasce no plano XY; girar em X o deita em volta do eixo Y.
      bandGeometry.rotateX(Math.PI / 2)
      bandGeometry.rotateY(Math.PI * WRAP_STARTS[index])

      const cloth = new Mesh(bandGeometry, materialFor(role))
      cloth.name = `${band.name}-cloth`
      cloth.userData.materialRole = role
      cloth.userData.wrapIndex = index
      band.add(cloth)
      wraps.add(band)
    }
  }

  // Nó frontal: dois lóbulos achatados, uma dobra e um ponto de luz. Fica
  // acima da testa e à direita, sem encostar na sobrancelha esquerda.
  const knot = new Group()
  knot.name = 'caterpillar-turban-knot'
  knot.position.set(
    headCenter.x + headRadius * 0.58,
    headTop + headRadius * 0.05,
    headCenter.z + headRadius * 1.02
  )

  const lobeA = new Mesh(
    new SphereGeometry(
      headRadius * 0.12,
      style === 'wireframe' ? 8 : 14,
      style === 'wireframe' ? 6 : 10
    ),
    materialFor('turbanStripe')
  )
  lobeA.name = 'caterpillar-turban-knot-lobe-a'
  lobeA.position.set(-headRadius * 0.07, headRadius * 0.01, 0)
  lobeA.scale.set(1, 0.72, 0.85)
  lobeA.userData.volume = true

  const lobeB = new Mesh(
    new SphereGeometry(
      headRadius * 0.1,
      style === 'wireframe' ? 8 : 14,
      style === 'wireframe' ? 6 : 10
    ),
    materialFor('turbanStripe')
  )
  lobeB.name = 'caterpillar-turban-knot-lobe-b'
  lobeB.position.set(headRadius * 0.08, -headRadius * 0.015, headRadius * 0.01)
  lobeB.scale.set(0.9, 0.65, 0.8)
  lobeB.userData.volume = true

  const fold = new Mesh(
    new TorusGeometry(
      headRadius * 0.09,
      headRadius * 0.028,
      style === 'wireframe' ? 4 : 6,
      style === 'wireframe' ? 6 : 12,
      Math.PI * 1.15
    ),
    materialFor('turbanStripe')
  )
  fold.name = 'caterpillar-turban-knot-fold'
  fold.position.set(0, -headRadius * 0.03, headRadius * 0.035)
  fold.rotation.set(0.3, 0.2, -0.6)
  fold.userData.knotDetail = 'fold'

  const knotHighlight = new Mesh(
    new SphereGeometry(headRadius * 0.05, style === 'wireframe' ? 6 : 10, 8),
    materialFor('turban')
  )
  knotHighlight.name = 'caterpillar-turban-knot-highlight'
  knotHighlight.position.set(0, headRadius * 0.04, headRadius * 0.085)
  knotHighlight.scale.set(1, 1, 0.6)
  knotHighlight.userData.knotDetail = 'highlight'

  knot.add(lobeA, lobeB, fold, knotHighlight)
  group.add(knot)

  // Pingente de duas esferas preso ao nó. Mantém o nome para a task 20.
  const tassel = new Group()
  tassel.name = 'caterpillar-turban-tassel'
  tassel.position.set(headRadius * 0.02, -headRadius * 0.16, headRadius * 0.01)

  const tasselTop = new Mesh(
    new SphereGeometry(headRadius * 0.055, style === 'wireframe' ? 6 : 10, 8),
    materialFor('turbanStripe')
  )
  tasselTop.name = 'caterpillar-turban-tassel-top'
  tasselTop.position.set(0, headRadius * 0.03, 0)
  tasselTop.scale.set(1, 0.85, 1)

  const tasselBottom = new Mesh(
    new SphereGeometry(headRadius * 0.04, style === 'wireframe' ? 6 : 10, 8),
    materialFor('turbanStripe')
  )
  tasselBottom.name = 'caterpillar-turban-tassel-bottom'
  tasselBottom.position.set(0, -headRadius * 0.045, 0)
  tasselBottom.scale.set(0.85, 1, 0.85)

  tassel.add(tasselTop, tasselBottom)
  knot.add(tassel)

  for (const antenna of head.antennae) antenna.visible = false

  return {
    group,
    cap,
    wraps,
    knot,
    tassel,
    tiltRadians,
    hidesAntennae: true,
    dispose: createPartDispose(group)
  }
}
