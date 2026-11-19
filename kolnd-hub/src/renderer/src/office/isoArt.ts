import type { OfficeAgentStatus } from '../../../shared/office'
import {
  BODY_ROWS,
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  type OfficeAvatarLook,
  type OfficeAvatarSex
} from '../../../shared/officeAvatar'
import { TILE_H, TILE_W, diamondPolygon } from './iso'
import type { Point } from './iso'

// Fonte única da matemática de projeção: `iso.ts`. Reexportado aqui para não
// quebrar consumidores históricos de `isoArt` — nunca copiar a implementação.
export {
  cameraToScreen,
  depthOf,
  diamondPolygon,
  fitCamera,
  pointInDiamond,
  projectIso,
  screenToWorld,
  sortByDepth,
  unprojectIso,
  worldToScreen,
  TILE_H,
  TILE_W
} from './iso'
export type { FitCameraOptions, IsoCamera, IsoViewport, Point, Rect } from './iso'

/**
 * Arte procedural isométrica do OpenOffice — dados puros, sem canvas.
 *
 * A matemática de projeção (tiles, câmera, profundidade, hit test) vive em
 * `iso.ts` e é reexportada aqui para compatibilidade; este módulo só desenha.
 * Nada aqui toca canvas, DOM, relógio ou arquivos: os testes rodam em `node`.
 * O chão é um losango 2:1 (`TILE_W`×`TILE_H`), com paredes de topo iluminado e
 * lateral escura; móveis e personagens são compostos em perspectiva.
 *
 * O personagem é uma grade de 16×24 (base por sexo + cabelo por cima), com 3
 * quadros de digitação e 1 ocioso. Mesmo look ⇒ mesma saída, sempre.
 */

/** Altura das paredes de fundo, em pixels de mundo (multiplicada pela escala). */
export const WALL_HEIGHT = 40

/** Personagem desenhado em 16×24 (base + cabelo). */
export const CHARACTER_WIDTH = 16
export const CHARACTER_HEIGHT = 24

/** Quadros de digitação antes do quadro ocioso. */
export const TYPING_FRAME_COUNT = 3

// ── Composição do personagem ────────────────────────────────────────────────

export interface CharacterArt {
  width: number
  height: number
  rows: string[]
  palette: Record<string, string>
  /** Quadros de digitação + ocioso; `working` anima, os demais são estáticos. */
  frames: string[][]
}

function patch(base: readonly string[], rows: Record<number, string>): string[] {
  return base.map((row, index) => rows[index] ?? row)
}

function withHair(body: readonly string[], look: OfficeAvatarLook): string[] {
  const style = HAIR_STYLES[look.hairStyle] ?? HAIR_STYLES[0]
  return body.map((row, index) => {
    const hair = style.rows[index]
    if (!hair) return row
    const chars = row.split('')
    for (let column = 0; column < hair.length; column++) {
      if (hair[column] !== '.') chars[column] = hair[column]
    }
    return chars.join('')
  })
}

/** Paleta resolvida do personagem (mesmos hex do `officeAvatar`). */
export function characterPalette(
  look: OfficeAvatarLook,
  status: OfficeAgentStatus
): Record<string, string> {
  const skin = SKIN_TONES[look.skin] ?? SKIN_TONES[0]
  const hair = HAIR_COLORS[look.hairColor] ?? HAIR_COLORS[0]
  const shirt = SHIRT_COLORS[look.shirt] ?? SHIRT_COLORS[0]
  const pants = PANTS_COLORS[look.pants] ?? PANTS_COLORS[0]

  if (status === 'ended') {
    // Encerrado perde identidade e vira silhueta cinza (como no render antigo).
    return {
      h: '#3b4148',
      H: '#2b3137',
      s: '#7d8894',
      S: '#5f6975',
      c: '#47525e',
      C: '#3a4651',
      p: '#3a4651',
      b: '#222d3a',
      e: '#2b3137',
      a: '#8a6239'
    }
  }

  return {
    h: hair.c,
    H: hair.C,
    s: skin.c,
    S: skin.C,
    c: shirt.c,
    C: shirt.C,
    p: pants.c,
    b: '#151b22',
    e: status === 'unknown' ? '#7d8894' : '#232b34',
    a: '#e2a33f'
  }
}

/** Quadros do corpo (sem cabelo — o cabelo é a mesma sobreposição em todos). */
function bodyFrames(status: OfficeAgentStatus, sex: OfficeAvatarSex): string[][] {
  const base = BODY_ROWS[sex]
  const typing = [
    patch(base, { 15: '..sccccccccccs..' }),
    patch(base, { 15: '..scccccccccs...' }),
    patch(base, { 15: '...scccccccccs..' })
  ]

  switch (status) {
    case 'working':
      return typing
    case 'needsYou':
      return [
        patch(base, {
          1: '....ssssssssw...',
          2: '....ssssssshc...',
          3: '....ssesseshc...',
          4: '....ssssssshc...',
          5: '....ssSSSSshc...',
          6: '....ssssssshc...',
          7: '.....ssssss.c...'
        })
      ]
    case 'idle':
      return [patch(base, { 15: '..sccccccccccsa.' })]
    case 'ended':
      return [patch(base, { 4: '....ssossoss....' })]
    default:
      return [patch(base, { 4: '....ssassass....' })]
  }
}

/** Personagem completo: base do sexo + cabelo + quadro do estado. */
export function composeCharacter(
  look: OfficeAvatarLook,
  status: OfficeAgentStatus,
  frame = 0
): CharacterArt {
  const frames = bodyFrames(status, look.sex).map((rows) => withHair(rows, look))
  const safeFrame = frames.length > 0 ? Math.abs(Math.trunc(frame)) % frames.length : 0
  return {
    width: CHARACTER_WIDTH,
    height: CHARACTER_HEIGHT,
    rows: frames[safeFrame] ?? frames[0] ?? [],
    palette: characterPalette(look, status),
    frames
  }
}

// ── Cenário ─────────────────────────────────────────────────────────────────

export interface IsoArtOrigin {
  /** Ponto de tela do canto (0,0) do piso. */
  x: number
  y: number
  scale: number
}

export type IsoShape =
  | {
      kind: 'poly'
      points: Point[]
      fill: string
      stroke?: string
      lineWidth?: number
    }
  | {
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      fill: string
      radius?: number
      stroke?: string
      lineWidth?: number
    }

export interface IsoSprite {
  kind: 'sprite'
  x: number
  y: number
  width: number
  height: number
  rows: readonly string[]
  palette: Record<string, string>
  alpha?: number
}

export interface ScenePalette {
  floorA: string
  floorB: string
  floorLine: string
  wall: string
  wallSide: string
  wallTop: string
  baseboard: string
  rugA: string
  rugB: string
  deskTop: string
  deskFront: string
  deskSide: string
  leg: string
  chairTop: string
  chairFront: string
  chairSide: string
  frame: string
  frameInner: string
  plant: string
  plantDark: string
  pot: string
  shadow: string
}

export function scenePalette(): ScenePalette {
  return {
    floorA: '#1a2531',
    floorB: '#17212c',
    floorLine: 'rgba(255, 255, 255, 0.045)',
    wall: '#22303d',
    wallSide: '#1a2530',
    wallTop: '#4a6076',
    baseboard: '#0d161d',
    rugA: 'rgba(226, 163, 63, 0.07)',
    rugB: 'rgba(226, 163, 63, 0.035)',
    deskTop: '#55412c',
    deskFront: '#3a2b1d',
    deskSide: '#463424',
    leg: '#2a2018',
    chairTop: '#33414e',
    chairFront: '#26323d',
    chairSide: '#2b3844',
    frame: '#2c2118',
    frameInner: '#2e4e5b',
    plant: '#4f9d69',
    plantDark: '#2f6b47',
    pot: '#8a5a3c',
    shadow: 'rgba(2, 8, 16, 0.35)'
  }
}

/** Converte mundo → tela relativo à origem da sala (escala aplicada). */
export function originPoint(origin: IsoArtOrigin, x: number, y: number, z = 0): Point {
  return {
    x: origin.x + (x - y) * (TILE_W / 2) * origin.scale,
    y: origin.y + (x + y) * (TILE_H / 2) * origin.scale - z * origin.scale
  }
}

function poly(points: Point[], fill: string, stroke?: string, lineWidth?: number): IsoShape {
  return {
    kind: 'poly',
    points,
    fill,
    ...(stroke ? { stroke } : {}),
    ...(lineWidth ? { lineWidth } : {})
  }
}

/** Caixa isométrica: topo + duas faces visíveis (frente e lateral). */
export function isoBox(
  origin: IsoArtOrigin,
  x: number,
  y: number,
  width: number,
  depth: number,
  baseHeight: number,
  height: number,
  colors: { top: string; front: string; side: string }
): IsoShape[] {
  const z0 = baseHeight
  const z1 = baseHeight + height
  const a = originPoint(origin, x, y, z1)
  const b = originPoint(origin, x + width, y, z1)
  const c = originPoint(origin, x + width, y + depth, z1)
  const d = originPoint(origin, x, y + depth, z1)
  const b0 = originPoint(origin, x + width, y, z0)
  const c0 = originPoint(origin, x + width, y + depth, z0)
  const d0 = originPoint(origin, x, y + depth, z0)
  return [
    // Frente (y + depth): a face que o jogador vê de baixo.
    poly([d, c, c0, d0], colors.front),
    // Lateral (x + width).
    poly([b, c, c0, b0], colors.side),
    // Topo por último: cobre a emenda das faces.
    poly([a, b, c, d], colors.top)
  ]
}

/** Piso em losangos 2:1, com variação sutil de tom por tile. */
export function floorShapes(
  origin: IsoArtOrigin,
  width: number,
  depth: number,
  palette: ScenePalette = scenePalette()
): IsoShape[] {
  const shapes: IsoShape[] = []
  const halfW = (TILE_W / 2) * origin.scale
  const halfH = (TILE_H / 2) * origin.scale
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      const center = originPoint(origin, x + 0.5, y + 0.5)
      const fill = (x + y) % 2 === 0 ? palette.floorA : palette.floorB
      shapes.push(poly(diamondPolygon(center, halfW, halfH), fill, palette.floorLine, 1))
    }
  }
  return shapes
}

/** Paredes de fundo (norte em y=0 e oeste em x=0), com topo iluminado. */
export function wallShapes(
  origin: IsoArtOrigin,
  width: number,
  depth: number,
  palette: ScenePalette = scenePalette()
): IsoShape[] {
  const height = WALL_HEIGHT
  const topThickness = 3

  const north = [
    originPoint(origin, 0, 0),
    originPoint(origin, width, 0),
    originPoint(origin, width, 0, height),
    originPoint(origin, 0, 0, height)
  ]
  const northTop = [
    originPoint(origin, 0, 0, height),
    originPoint(origin, width, 0, height),
    originPoint(origin, width, 0, height + topThickness),
    originPoint(origin, 0, 0, height + topThickness)
  ]
  const west = [
    originPoint(origin, 0, 0),
    originPoint(origin, 0, depth),
    originPoint(origin, 0, depth, height),
    originPoint(origin, 0, 0, height)
  ]
  const westTop = [
    originPoint(origin, 0, 0, height),
    originPoint(origin, 0, depth, height),
    originPoint(origin, 0, depth, height + topThickness),
    originPoint(origin, 0, 0, height + topThickness)
  ]
  const baseboard = 5
  const northBase = [
    originPoint(origin, 0, 0),
    originPoint(origin, width, 0),
    originPoint(origin, width, 0, baseboard),
    originPoint(origin, 0, 0, baseboard)
  ]
  const westBase = [
    originPoint(origin, 0, 0),
    originPoint(origin, 0, depth),
    originPoint(origin, 0, depth, baseboard),
    originPoint(origin, 0, 0, baseboard)
  ]

  return [
    poly(west, palette.wallSide),
    poly(north, palette.wall),
    poly(westBase, palette.baseboard),
    poly(northBase, palette.baseboard),
    poly(westTop, palette.wallTop),
    poly(northTop, palette.wallTop)
  ]
}

/** Tapete central (dois losangos concêntricos discretos). */
export function rugShapes(
  origin: IsoArtOrigin,
  width: number,
  depth: number,
  palette: ScenePalette = scenePalette()
): IsoShape[] {
  const halfW = (TILE_W / 2) * origin.scale
  const halfH = (TILE_H / 2) * origin.scale
  const center = originPoint(origin, width / 2, depth / 2 + 0.6)
  const outerW = halfW * Math.max(1, width * 0.7)
  const outerH = halfH * Math.max(1, width * 0.7)
  const innerW = outerW * 0.72
  const innerH = outerH * 0.72
  return [
    poly(diamondPolygon(center, outerW, outerH), palette.rugB),
    poly(diamondPolygon(center, innerW, innerH), palette.rugA)
  ]
}

/** Mesa isométrica: tampo + quatro pés (nada de PNG). */
export function deskShapes(
  origin: IsoArtOrigin,
  tileX: number,
  tileY: number,
  palette: ScenePalette = scenePalette()
): IsoShape[] {
  const shapes: IsoShape[] = []
  const x = tileX + 0.08
  const y = tileY + 0.12
  const width = 1.84
  const depth = 0.92
  const legTop = 13
  const legWidth = 0.14
  const legDepth = 0.14
  for (const [lx, ly] of [
    [x + 0.08, y + 0.08],
    [x + width - legWidth - 0.08, y + 0.08],
    [x + 0.08, y + depth - legDepth - 0.08],
    [x + width - legWidth - 0.08, y + depth - legDepth - 0.08]
  ] as const) {
    shapes.push(
      ...isoBox(origin, lx, ly, legWidth, legDepth, 0, legTop, {
        top: palette.leg,
        front: palette.leg,
        side: palette.leg
      })
    )
  }
  shapes.push(
    ...isoBox(origin, x, y, width, depth, legTop, 5, {
      top: palette.deskTop,
      front: palette.deskFront,
      side: palette.deskSide
    })
  )
  return shapes
}

/** Cadeira: assento + encosto, posicionada atrás do personagem. */
export function chairShapes(
  origin: IsoArtOrigin,
  tileX: number,
  tileY: number,
  palette: ScenePalette = scenePalette()
): IsoShape[] {
  const x = tileX + 0.55
  const y = tileY - 0.05
  return [
    ...isoBox(origin, x, y, 0.7, 0.22, 10, 11, {
      top: palette.chairTop,
      front: palette.chairFront,
      side: palette.chairSide
    }),
    ...isoBox(origin, x + 0.08, y + 0.28, 0.54, 0.34, 0, 9, {
      top: palette.chairTop,
      front: palette.chairFront,
      side: palette.chairSide
    })
  ]
}

/** Quadro na parede norte (y=0), entre duas alturas. */
export function frameShapes(
  origin: IsoArtOrigin,
  wallX: number,
  baseZ = 18,
  palette: ScenePalette = scenePalette()
): IsoShape[] {
  const size = 0.9
  const height = 12
  const outer = [
    originPoint(origin, wallX, 0, baseZ),
    originPoint(origin, wallX + size, 0, baseZ),
    originPoint(origin, wallX + size, 0, baseZ + height),
    originPoint(origin, wallX, 0, baseZ + height)
  ]
  const inner = [
    originPoint(origin, wallX + 0.08, 0, baseZ + 2),
    originPoint(origin, wallX + size - 0.08, 0, baseZ + 2),
    originPoint(origin, wallX + size - 0.08, 0, baseZ + height - 2),
    originPoint(origin, wallX + 0.08, 0, baseZ + height - 2)
  ]
  return [poly(outer, palette.frame), poly(inner, palette.frameInner)]
}

const PLANT_ROWS = [
  '...tttt...',
  '..ttTTtt..',
  '.ttTTTTtt.',
  '.tTTttTTt.',
  '..tTTTTt..',
  '...tTTt...',
  '....Tt....',
  '...uuuu...',
  '...uuuu...',
  '...uuuu...',
  '...uuuu...',
  '...uuuu...',
  '....uu....',
  '..........'
]

/** Planta em sprite (mesma grade do escritório antigo). */
export function plantSprite(
  origin: IsoArtOrigin,
  tileX: number,
  tileY: number,
  palette: ScenePalette = scenePalette()
): IsoSprite {
  const scale = origin.scale
  const center = originPoint(origin, tileX, tileY)
  const width = 10 * scale
  const height = 14 * scale
  return {
    kind: 'sprite',
    x: center.x - width / 2,
    y: center.y - height + TILE_H * 0.4 * scale,
    width,
    height,
    rows: PLANT_ROWS,
    palette: {
      t: palette.plant,
      T: palette.plantDark,
      u: palette.pot
    }
  }
}

/** Sombra elíptica sob o personagem (mantém o boneco "no chão"). */
export function characterShadow(center: Point, scale: number, palette: ScenePalette): IsoShape {
  return {
    kind: 'rect',
    x: center.x - 9 * scale,
    y: center.y - 2.5 * scale,
    width: 18 * scale,
    height: 5 * scale,
    fill: palette.shadow,
    radius: 4 * scale
  }
}
