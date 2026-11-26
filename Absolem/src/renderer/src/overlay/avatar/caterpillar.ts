import {
  CatmullRomCurve3,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from 'three'
import type { Material } from 'three'

/**
 * Lagarta 100% procedural.
 *
 * Nenhum asset externo: o corpo é uma sequência de esferas ao longo de uma
 * `CatmullRomCurve3`, e cabeça, olhos, pupilas, antenas, mandíbulas e boca são
 * geometrias primitivas posicionadas em código. A mesma seed produz exatamente
 * a mesma malha, o que mantém o teste de vértices estável e evita "pulos" entre
 * montagens.
 *
 * O módulo não conhece o tema: quem monta passa uma fábrica de materiais. O
 * default (MeshBasicMaterial) serve para testes em Node e para o fallback
 * visual; a cena passa o material de holograma.
 */
export const CATERPILLAR_MIN_SEGMENTS = 7
export const CATERPILLAR_MAX_SEGMENTS = 9
export const CATERPILLAR_DEFAULT_SEGMENTS = 8
export const CATERPILLAR_LOW_DETAIL_SEGMENTS = 5
export const MAX_CATERPILLAR_TRIANGLES = 12000

export const CATERPILLAR_STYLES = ['classic', 'neon', 'wireframe', 'liquid'] as const
export type CaterpillarStyle = (typeof CATERPILLAR_STYLES)[number]

export const CATERPILLAR_OUTFITS = ['none', 'scarf', 'collar', 'visor'] as const
export type CaterpillarOutfit = (typeof CATERPILLAR_OUTFITS)[number]

export type CaterpillarMaterialRole =
  'body' | 'head' | 'eye' | 'pupil' | 'antenna' | 'mandible' | 'mouth' | 'outfit' | 'accessory'

export type CaterpillarMaterialFactory = (role: CaterpillarMaterialRole) => Material

export const CATERPILLAR_ACCESSORIES = ['antenna_glow', 'back_spikes', 'visor_hud'] as const

export type CaterpillarAccessory = (typeof CATERPILLAR_ACCESSORIES)[number]

export interface CaterpillarOptions {
  /** 7 a 9; valores fora da faixa são limitados. */
  segments?: number
  radius?: number
  /** 0..1: deslocamento lateral/vertical da curva do corpo. */
  curvature?: number
  style?: CaterpillarStyle | string
  outfit?: CaterpillarOutfit | string
  accessories?: readonly string[]
  seed?: number
  /** Degradação (T7): força o corpo mínimo de 5 segmentos. */
  minimal?: boolean
  /** Fábrica externa (cena); sem ela, materiais básicos locais. */
  material?: CaterpillarMaterialFactory
  /** Cores opcionais para a fábrica default; a cena passa a própria fábrica. */
  palette?: Partial<Record<CaterpillarMaterialRole, number>>
}

export interface CaterpillarStats {
  segments: number
  vertices: number
  triangles: number
  style: CaterpillarStyle
  outfit: CaterpillarOutfit
  accessories: CaterpillarAccessory[]
}

export interface CaterpillarBuild {
  root: Group
  body: Group
  segments: Mesh[]
  head: Mesh
  eyeGroups: Group[]
  pupils: Mesh[]
  antennae: Group[]
  mandibles: Mesh[]
  mouth: Mesh
  outfit: Group | null
  stats: CaterpillarStats
  /** Libera geometrias (e materiais, se foram criados aqui). */
  dispose: () => void
}

/** PRNG determinístico (mulberry32): mesma seed, mesma lagarta. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function resolveSegmentCount(requested: number | undefined, minimal = false): number {
  if (minimal) return CATERPILLAR_LOW_DETAIL_SEGMENTS
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return CATERPILLAR_DEFAULT_SEGMENTS
  }
  return Math.min(
    CATERPILLAR_MAX_SEGMENTS,
    Math.max(CATERPILLAR_MIN_SEGMENTS, Math.round(requested))
  )
}

export function resolveCaterpillarStyle(value: unknown): CaterpillarStyle {
  return typeof value === 'string' && (CATERPILLAR_STYLES as readonly string[]).includes(value)
    ? (value as CaterpillarStyle)
    : 'classic'
}

export function resolveCaterpillarOutfit(value: unknown): CaterpillarOutfit {
  return typeof value === 'string' && (CATERPILLAR_OUTFITS as readonly string[]).includes(value)
    ? (value as CaterpillarOutfit)
    : 'none'
}

/** Acessórios: lista fechada, sem repetição, ordem preservada. */
export function resolveCaterpillarAccessories(value: unknown): CaterpillarAccessory[] {
  if (!Array.isArray(value)) return []
  const out: CaterpillarAccessory[] = []
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      !(CATERPILLAR_ACCESSORIES as readonly string[]).includes(item)
    ) {
      continue
    }
    const accessory = item as CaterpillarAccessory
    if (!out.includes(accessory)) out.push(accessory)
  }
  return out
}

/**
 * Fábrica default: usada em testes e quando a cena não injeta materiais.
 * Nenhuma cor mora neste módulo: a paleta chega por parâmetro ou o material
 * fica com a cor neutra do three.
 */
export function createDefaultCaterpillarMaterials(
  style: CaterpillarStyle,
  palette: Partial<Record<CaterpillarMaterialRole, number>> = {}
): CaterpillarMaterialFactory {
  const wireframe = style === 'wireframe'
  return (role) =>
    new MeshBasicMaterial({
      ...(palette[role] === undefined ? {} : { color: palette[role] }),
      wireframe,
      transparent: true,
      opacity: role === 'pupil' ? 0.95 : 0.62
    })
}

function countTriangles(geometry: {
  index: { count: number } | null
  attributes: { position: { count: number } }
}): number {
  if (geometry.index) return Math.floor(geometry.index.count / 3)
  return Math.floor(geometry.attributes.position.count / 3)
}

export function buildCaterpillar(options: CaterpillarOptions = {}): CaterpillarBuild {
  const style = resolveCaterpillarStyle(options.style)
  const outfit = resolveCaterpillarOutfit(options.outfit)
  const segmentsCount = resolveSegmentCount(options.segments, options.minimal === true)
  const radius = typeof options.radius === 'number' && options.radius > 0 ? options.radius : 0.22
  const curvature =
    typeof options.curvature === 'number' ? Math.min(1, Math.max(0, options.curvature)) : 0.45
  const random = createSeededRandom(options.seed ?? 1)
  const ownsMaterials = options.material === undefined
  const materialFor = options.material ?? createDefaultCaterpillarMaterials(style, options.palette)
  const accessories = resolveCaterpillarAccessories(options.accessories)

  const root = new Group()
  root.name = 'caterpillar'
  const body = new Group()
  body.name = 'caterpillar-body'
  root.add(body)

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
  const segmentMeshes: Mesh[] = []

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
    body.add(segment)
    segmentMeshes.push(segment)
  }

  const neck = curve.getPointAt(1)
  const headGeometry = new SphereGeometry(
    radius * 1.2,
    style === 'wireframe' ? 12 : 18,
    style === 'wireframe' ? 10 : 14
  )
  const head = new Mesh(headGeometry, materialFor('head'))
  head.name = 'caterpillar-head'
  head.position.set(neck.x + radius * 1.15, neck.y + radius * 0.7, 0)
  head.scale.set(1.12, 1, 1)
  root.add(head)

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

    const white = new Mesh(eyeWhiteGeometry, materialFor('eye'))
    white.name = 'caterpillar-eye-white'
    eye.add(white)

    const pupil = new Mesh(pupilGeometry, materialFor('pupil'))
    pupil.name = 'caterpillar-pupil'
    pupil.position.x = radius * 0.28
    eye.add(pupil)

    root.add(eye)
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
    root.add(antenna)
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
    root.add(mandible)
    mandibles.push(mandible)
  }

  const mouthGeometry = new SphereGeometry(radius * 0.52, 14, 10)
  const mouth = new Mesh(mouthGeometry, materialFor('mouth'))
  mouth.name = 'caterpillar-mouth'
  mouth.position.set(head.position.x + radius * 0.82, head.position.y - radius * 0.32, 0)
  mouth.scale.set(0.55, 0.3, 0.9)
  root.add(mouth)

  let outfitGroup: Group | null = null
  if (outfit !== 'none') {
    outfitGroup = buildOutfit(outfit, {
      radius,
      head,
      materialFor,
      style
    })
    outfitGroup.name = `caterpillar-outfit-${outfit}`
    root.add(outfitGroup)
  }

  if (accessories.length > 0) {
    const accessoryGroups = buildAccessories(accessories, {
      radius,
      head,
      materialFor,
      curve,
      antennae
    })
    for (const group of accessoryGroups) root.add(group)
  }

  let vertices = 0
  let triangles = 0
  root.traverse((object) => {
    if (object instanceof Mesh) {
      vertices += object.geometry.attributes.position.count
      triangles += countTriangles(
        object.geometry as unknown as {
          index: { count: number } | null
          attributes: { position: { count: number } }
        }
      )
    }
  })

  const stats: CaterpillarStats = {
    segments: segmentsCount,
    vertices,
    triangles,
    style,
    outfit,
    accessories
  }

  return {
    root,
    body,
    segments: segmentMeshes,
    head,
    eyeGroups,
    pupils,
    antennae,
    mandibles,
    mouth,
    outfit: outfitGroup,
    stats,
    dispose(): void {
      const geometries = new Set<{ dispose: () => void }>()
      const materials = new Set<Material>()
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return
        geometries.add(object.geometry as unknown as { dispose: () => void })
        const material = object.material
        if (Array.isArray(material)) material.forEach((entry) => materials.add(entry))
        else materials.add(material)
      })
      for (const geometry of geometries) geometry.dispose()
      if (ownsMaterials) for (const material of materials) material.dispose()
      root.clear()
    }
  }
}

interface AccessoryContext {
  radius: number
  head: Mesh
  materialFor: CaterpillarMaterialFactory
  curve: CatmullRomCurve3
  antennae: Group[]
}

/**
 * Acessórios procedurais. Cada um é um `Group` próprio para a cena remover e
 * reconstruir sem tocar no resto da malha.
 */
function buildAccessories(accessories: CaterpillarAccessory[], ctx: AccessoryContext): Group[] {
  const groups: Group[] = []
  const { radius, head, materialFor, curve, antennae } = ctx

  if (accessories.includes('antenna_glow')) {
    const group = new Group()
    group.name = 'caterpillar-accessory-antenna_glow'
    const glowGeometry = new SphereGeometry(radius * 0.24, 8, 6)
    for (const antenna of antennae) {
      const side = antenna.name.includes('left') ? -1 : 1
      const glow = new Mesh(glowGeometry, materialFor('accessory'))
      glow.position.set(radius * 0.42, radius * 1.55, side * radius * 0.58)
      glow.scale.set(1, 1, 1)
      group.add(glow)
    }
    groups.push(group)
  }

  if (accessories.includes('back_spikes')) {
    const group = new Group()
    group.name = 'caterpillar-accessory-back_spikes'
    const spikeGeometry = new ConeGeometry(radius * 0.16, radius * 0.62, 6)
    for (const t of [0.26, 0.48, 0.7]) {
      const point = curve.getPointAt(t)
      const spike = new Mesh(spikeGeometry, materialFor('accessory'))
      spike.position.set(point.x, point.y + radius * 0.92, point.z)
      spike.rotation.z = -0.12
      group.add(spike)
    }
    groups.push(group)
  }

  if (accessories.includes('visor_hud')) {
    const group = new Group()
    group.name = 'caterpillar-accessory-visor_hud'
    const bandGeometry = new TorusGeometry(radius * 0.9, radius * 0.08, 6, 18, Math.PI)
    const band = new Mesh(bandGeometry, materialFor('accessory'))
    band.position.set(head.position.x + radius * 0.18, head.position.y + radius * 0.2, 0)
    band.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    group.add(band)

    const lensGeometry = new SphereGeometry(radius * 0.18, 8, 6)
    for (const side of [-1, 1]) {
      const lens = new Mesh(lensGeometry, materialFor('accessory'))
      lens.position.set(
        head.position.x + radius * 0.82,
        head.position.y + radius * 0.18,
        side * radius * 0.36
      )
      lens.scale.set(0.45, 1, 1)
      group.add(lens)
    }
    groups.push(group)
  }

  return groups
}

interface OutfitContext {
  radius: number
  head: Mesh
  materialFor: CaterpillarMaterialFactory
  style: CaterpillarStyle
}

function buildOutfit(outfit: CaterpillarOutfit, ctx: OutfitContext): Group {
  const group = new Group()
  const { radius, head, materialFor } = ctx

  if (outfit === 'scarf') {
    const ringGeometry = new TorusGeometry(radius * 1.25, radius * 0.22, 8, 20)
    const ring = new Mesh(ringGeometry, materialFor('outfit'))
    ring.position.set(head.position.x - radius * 0.85, head.position.y - radius * 0.45, 0)
    ring.rotation.y = Math.PI / 2
    ring.scale.set(1, 0.8, 1)
    group.add(ring)

    const tailGeometry = new SphereGeometry(radius * 0.3, 8, 6)
    for (let index = 0; index < 2; index += 1) {
      const tail = new Mesh(tailGeometry, materialFor('outfit'))
      tail.position.set(
        head.position.x - radius * 0.85,
        head.position.y - radius * (1.05 + index * 0.45),
        radius * (0.55 - index * 0.2)
      )
      tail.scale.set(0.8, 1.4, 0.5)
      group.add(tail)
    }
  } else if (outfit === 'collar') {
    for (let index = 0; index < 2; index += 1) {
      const collarGeometry = new TorusGeometry(radius * (1.3 + index * 0.14), radius * 0.12, 8, 20)
      const collar = new Mesh(collarGeometry, materialFor('outfit'))
      collar.position.set(
        head.position.x - radius * (0.9 + index * 0.16),
        head.position.y - radius * 0.5,
        0
      )
      collar.rotation.y = Math.PI / 2
      collar.rotation.x = index * 0.18
      group.add(collar)
    }
  } else if (outfit === 'visor') {
    const bandGeometry = new TorusGeometry(radius * 0.95, radius * 0.12, 6, 18, Math.PI)
    const band = new Mesh(bandGeometry, materialFor('outfit'))
    band.position.set(head.position.x + radius * 0.2, head.position.y + radius * 0.18, 0)
    band.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    band.scale.set(1, 1, 0.55)
    group.add(band)

    const lensGeometry = new SphereGeometry(radius * 0.22, 8, 6)
    for (const side of [-1, 1]) {
      const lens = new Mesh(lensGeometry, materialFor('outfit'))
      lens.position.set(
        head.position.x + radius * 0.8,
        head.position.y + radius * 0.16,
        side * radius * 0.38
      )
      lens.scale.set(0.5, 1, 1)
      group.add(lens)
    }
  }

  return group
}
