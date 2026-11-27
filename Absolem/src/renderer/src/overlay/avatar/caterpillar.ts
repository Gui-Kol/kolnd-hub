import { Group, InstancedMesh, Mesh, MeshBasicMaterial } from 'three'
import type { Material } from 'three'
import { normalizePalette } from './palettes'
import { buildBodyPart } from './parts/body'
import { buildHeadPart } from './parts/head'
import { buildLimbsPart } from './parts/limbs'
import { buildOutfitPart } from './parts/outfit'
import { buildAccessoriesPart } from './parts/accessories'
import type { PartContext } from './parts/types'

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
export const CATERPILLAR_DEFAULT_SEGMENTS = 9
export const CATERPILLAR_LOW_DETAIL_SEGMENTS = 5
export const MAX_CATERPILLAR_TRIANGLES = 24000

export const CATERPILLAR_STYLES = ['classic', 'neon', 'wireframe', 'liquid'] as const
export type CaterpillarStyle = (typeof CATERPILLAR_STYLES)[number]

export const CATERPILLAR_OUTFITS = ['none', 'scarf', 'collar', 'visor'] as const
export type CaterpillarOutfit = (typeof CATERPILLAR_OUTFITS)[number]

/**
 * Papéis de material do personagem. A ordem é estável: a paleta nomeada e os
 * testes de contrato dependem dela, e a fábrica de materiais da cena percorre a
 * lista uma única vez para criar um material por papel no acabamento sólido.
 */
export const CATERPILLAR_MATERIAL_ROLES = [
  'body',
  'belly',
  'head',
  'eyelid',
  'brow',
  'sclera',
  'iris',
  'pupil',
  'highlight',
  'lip',
  'mouth',
  'tongue',
  'antenna',
  'mandible',
  'hand',
  'sleeve',
  'claw',
  'turban',
  'turbanStripe',
  'pipe',
  'hose',
  'smoke',
  'outfit',
  'accessory'
] as const

export type CaterpillarMaterialRole = (typeof CATERPILLAR_MATERIAL_ROLES)[number]

export type CaterpillarMaterialFactory = (role: CaterpillarMaterialRole) => Material

export const CATERPILLAR_ACCESSORIES = ['antenna_glow', 'back_spikes', 'visor_hud'] as const

export type CaterpillarAccessory = (typeof CATERPILLAR_ACCESSORIES)[number]

/**
 * Grupos estáveis do contrato de partes. As tasks 15-18 preenchem os grupos
 * que hoje nascem vazios (`face`, `limbs`, `turban`, `pipe`) sem renomear os
 * que já existem.
 */
export const CATERPILLAR_PART_NAMES = [
  'body',
  'head',
  'face',
  'limbs',
  'turban',
  'pipe',
  'outfit',
  'accessories'
] as const

export type CaterpillarPartName = (typeof CATERPILLAR_PART_NAMES)[number]

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
  /** Y local do plano de apoio; a task 22 aplica o scale da cena. */
  bodyBaseY: number
}

export interface CaterpillarBuild {
  root: Group
  body: Group
  segments: Mesh[]
  head: Mesh
  eyeGroups: Group[]
  pupils: Mesh[]
  lids: Group[]
  antennae: Group[]
  mandibles: Mesh[]
  mouth: Group
  jaw: Group
  mouthCorners: Group[]
  brows: Group[]
  browLeft: Group
  browRight: Group
  nose: Mesh
  nostrils: Mesh[]
  /** Grupos das mãos e dos pés, expostos para a task 20 animar os membros. */
  hands: Group[]
  feet: Group[]
  outfit: Group | null
  /** Grupos estáveis por parte; `face`, `turban` e `pipe` seguem reservados. */
  parts: Record<string, Group>
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
  const ownsMaterials = options.material === undefined
  const materialFor = options.material ?? createDefaultCaterpillarMaterials(style, options.palette)
  const accessories = resolveCaterpillarAccessories(options.accessories)

  const partContext: PartContext = {
    radius,
    materialFor,
    palette: normalizePalette(options.palette),
    seed: options.seed ?? 1,
    minimal: options.minimal === true,
    style,
    segments: segmentsCount,
    curvature
  }

  const bodyPart = buildBodyPart(partContext)
  const headPart = buildHeadPart({ ...partContext, neck: bodyPart.neck })
  const limbsPart = buildLimbsPart({ ...partContext, bodyBaseY: bodyPart.bodyBaseY })
  const outfitPart =
    outfit === 'none' ? null : buildOutfitPart(outfit, { ...partContext, head: headPart.head })
  const accessoriesPart = buildAccessoriesPart(accessories, {
    ...partContext,
    head: headPart.head,
    curve: bodyPart.curve,
    antennae: headPart.antennae
  })

  const outfitGroup = outfitPart?.group ?? new Group()
  if (!outfitPart) outfitGroup.name = 'caterpillar-outfit'

  const partGroup = (name: string): Group => {
    const group = new Group()
    group.name = name
    return group
  }

  const parts: Record<string, Group> = {
    body: bodyPart.group,
    head: headPart.group,
    face: partGroup('caterpillar-face'),
    limbs: limbsPart.group,
    turban: partGroup('caterpillar-turban'),
    pipe: partGroup('caterpillar-pipe'),
    outfit: outfitGroup,
    accessories: accessoriesPart.group
  }

  const root = new Group()
  root.name = 'caterpillar'
  // A ordem herdada (corpo, cabeça, roupa, acessórios) é preservada: o
  // holograma usa blending aditivo e depende da mesma sequência de montagem.
  for (const name of CATERPILLAR_PART_NAMES) root.add(parts[name])

  let vertices = 0
  let triangles = 0
  root.traverse((object) => {
    if (object instanceof Mesh) {
      const copies = object instanceof InstancedMesh ? object.count : 1
      vertices += object.geometry.attributes.position.count * copies
      triangles +=
        countTriangles(
          object.geometry as unknown as {
            index: { count: number } | null
            attributes: { position: { count: number } }
          }
        ) * copies
    }
  })

  const stats: CaterpillarStats = {
    segments: segmentsCount,
    vertices,
    triangles,
    style,
    outfit,
    accessories,
    bodyBaseY: bodyPart.bodyBaseY
  }

  const partDisposers: Array<() => void> = [bodyPart.dispose, headPart.dispose, limbsPart.dispose]
  if (outfitPart) partDisposers.push(outfitPart.dispose)
  partDisposers.push(accessoriesPart.dispose)

  let disposed = false

  return {
    root,
    body: bodyPart.group,
    segments: bodyPart.segments,
    head: headPart.head,
    eyeGroups: headPart.eyeGroups,
    pupils: headPart.pupils,
    lids: headPart.lids,
    antennae: headPart.antennae,
    mandibles: headPart.mandibles,
    mouth: headPart.mouth,
    jaw: headPart.jaw,
    mouthCorners: headPart.mouthCorners,
    brows: headPart.brows,
    browLeft: headPart.browLeft,
    browRight: headPart.browRight,
    nose: headPart.nose,
    nostrils: headPart.nostrils,
    hands: limbsPart.hands,
    feet: limbsPart.feet,
    outfit: outfitPart?.group ?? null,
    parts,
    stats,
    dispose(): void {
      if (disposed) return
      disposed = true
      const materials = new Set<Material>()
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return
        const material = object.material
        if (Array.isArray(material)) material.forEach((entry) => materials.add(entry))
        else materials.add(material)
      })
      for (const disposePart of partDisposers) disposePart()
      if (ownsMaterials) for (const material of materials) material.dispose()
      root.clear()
    }
  }
}
