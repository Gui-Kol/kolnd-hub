import type { OfficeRoom, OfficeSnapshot } from '../../../shared/office'
import { CHARACTER_HEIGHT, CHARACTER_WIDTH, WALL_HEIGHT } from './isoArt'
import {
  cameraToScreen,
  depthOf,
  fitCamera,
  pointInPolygon,
  projectIso,
  type IsoCamera,
  type Point,
  type Rect
} from './iso'

/**
 * Layout do escritório isométrico — puro, sem DOM/canvas.
 *
 * Cada departamento é uma ilha de piso (losangos 2:1) com duas paredes de
 * fundo e até 8 mesas visíveis; o restante vira "mais N" no rótulo. As ilhas
 * ficam numa grade de até 4 colunas e a câmera enquadra a cena inteira. Tudo é
 * determinístico por `id` — a mesma entrada pinta sempre a mesma cena e o
 * clique tem alvos estáveis.
 */

export const ISLAND_WIDTH = 8.6
export const ISLAND_DEPTH = 7.6
export const ISLAND_GAP = 3
export const MAX_VISIBLE_SEATS = 8
/** Quantas ilhas cabem por linha (o resto quebra para a próxima). */
export const MAX_ISLANDS_PER_ROW = 4

const MAX_ROOM_LABEL = 22

/** Posições de mesa dentro da ilha (2 colunas × 4 fileiras). */
const DESK_SLOTS: ReadonlyArray<{ x: number; y: number }> = Array.from(
  { length: MAX_VISIBLE_SEATS },
  (_, index) => ({
    x: 0.72 + (index % 2) * 3.72,
    y: 0.55 + Math.floor(index / 2) * 1.72
  })
)

export interface IsoSeatPlacement {
  sessionID: string
  roomID: string
  /** Posição do "pé" do personagem (mundo e tela). */
  world: Point
  anchor: Point
  /** Origem da mesa no mundo (o renderer desenha a mesa em `deskWorld`). */
  deskWorld: Point
  /** Retângulo de clique do boneco (tela). */
  hit: Rect
  /** Ponto de ancoragem do popover (topo da cabeça). */
  popover: Point
  /** Profundidade de pintura (maior = mais à frente). */
  depth: number
}

export interface IsoRoomPlacement {
  room: OfficeRoom
  label: string
  /** Quantos funcionários não caberam nas 8 mesas visíveis. */
  more: number
  /** Canto (0,0) da ilha no mundo. */
  world: Point
  /** Piso (paralelogramo) em tela. */
  polygon: Point[]
  /** Paredes norte/oeste em tela (hit test e desenho). */
  wallPolygons: Point[][]
  /** Caixa de tela que contém piso, paredes e chip. */
  bounds: Rect
  /** Chip do nome da sala (clique abre as configurações). */
  chip: Rect
  /** Origem de tela da arte (canto 0,0 do piso). */
  artOrigin: { x: number; y: number; scale: number }
  seats: IsoSeatPlacement[]
  depth: number
}

export interface IsoOfficeLayout {
  width: number
  height: number
  camera: IsoCamera
  rooms: IsoRoomPlacement[]
  /** Todos os assentos em ordem de pintura (fundo → frente). */
  seats: IsoSeatPlacement[]
}

export interface IsoLayoutOptions {
  width: number
  height: number
  padding?: number
  maxScale?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Trunca o nome da sala mantendo o fim legível (…). */
export function truncateRoomName(name: string, max: number = MAX_ROOM_LABEL): string {
  const flat = name.replace(/\s+/g, ' ').trim()
  if (max <= 0) return ''
  if (flat.length <= max) return flat
  if (max === 1) return '…'
  return `${flat.slice(0, max - 1)}…`
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function boundsOf(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Monta a cena: ilhas em grade (até 4 por linha), câmera única e assentos
 * ordenados por profundidade. Canvas 0×0 (primeira medição) não quebra: a
 * câmera só fica degenerada por um instante.
 */
export function layoutOffice(snapshot: OfficeSnapshot, options: IsoLayoutOptions): IsoOfficeLayout {
  const width = Math.max(0, options.width)
  const height = Math.max(0, options.height)
  const padding = options.padding ?? 18

  // Ordem por id (não a do snapshot): embaralhar a entrada não muda a cena.
  const rooms = [...snapshot.rooms].sort((a, b) => a.id.localeCompare(b.id))
  const columns = rooms.length <= 1 ? 1 : Math.min(MAX_ISLANDS_PER_ROW, rooms.length)
  const rows = Math.max(1, Math.ceil(rooms.length / columns))
  const gridWidth = columns * ISLAND_WIDTH + Math.max(0, columns - 1) * ISLAND_GAP
  const gridDepth = rows * ISLAND_DEPTH + Math.max(0, rows - 1) * ISLAND_GAP

  const fitPoints: Array<{ x: number; y: number; z?: number }> = []
  for (const [x, y] of [
    [0, 0],
    [gridWidth, 0],
    [0, gridDepth],
    [gridWidth, gridDepth]
  ] as const) {
    fitPoints.push({ x, y })
    fitPoints.push({ x, y, z: WALL_HEIGHT + 34 })
  }
  const camera = fitCamera(
    fitPoints,
    { width, height },
    {
      padding,
      maxScale: options.maxScale ?? 1.35,
      minScale: 0.02
    }
  )

  const screenAt = (x: number, y: number, z = 0): Point =>
    cameraToScreen(projectIso(x, y, z), camera)

  const placements: IsoRoomPlacement[] = []

  rooms.forEach((room, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const ox = column * (ISLAND_WIDTH + ISLAND_GAP)
    const oy = row * (ISLAND_DEPTH + ISLAND_GAP)

    const polygon = [
      screenAt(ox, oy),
      screenAt(ox + ISLAND_WIDTH, oy),
      screenAt(ox + ISLAND_WIDTH, oy + ISLAND_DEPTH),
      screenAt(ox, oy + ISLAND_DEPTH)
    ]
    const wallPolygons = [
      [
        screenAt(ox, oy),
        screenAt(ox + ISLAND_WIDTH, oy),
        screenAt(ox + ISLAND_WIDTH, oy, WALL_HEIGHT + 3),
        screenAt(ox, oy, WALL_HEIGHT + 3)
      ],
      [
        screenAt(ox, oy),
        screenAt(ox, oy + ISLAND_DEPTH),
        screenAt(ox, oy + ISLAND_DEPTH, WALL_HEIGHT + 3),
        screenAt(ox, oy, WALL_HEIGHT + 3)
      ]
    ]

    const label = truncateRoomName(room.name || 'Sem sala')
    const top = screenAt(ox, oy)
    const topOfWall = screenAt(ox, oy, WALL_HEIGHT + 3)
    const chipWidth = clamp(label.length * 7 + 46, 84, 200)
    const chipX = clamp(top.x - chipWidth / 2, 4, Math.max(4, width - chipWidth - 4))
    const chipY = Math.max(2, topOfWall.y - 24)
    const chip = { x: chipX, y: chipY, width: chipWidth, height: 18 }

    const agentIDs = [...new Set(room.agentIDs)]
    const visible = agentIDs.slice(0, MAX_VISIBLE_SEATS)

    const seats: IsoSeatPlacement[] = visible.map((sessionID, seatIndex) => {
      const slot = DESK_SLOTS[seatIndex] ?? DESK_SLOTS[0]
      const deskWorld = { x: ox + slot.x, y: oy + slot.y }
      const world = { x: deskWorld.x + 0.92, y: deskWorld.y + 1.18 }
      const anchor = screenAt(world.x, world.y)
      const spriteWidth = Math.max(9, CHARACTER_WIDTH * camera.scale)
      const spriteHeight = Math.max(12, CHARACTER_HEIGHT * camera.scale)
      return {
        sessionID,
        roomID: room.id,
        world,
        anchor,
        deskWorld,
        hit: {
          x: anchor.x - spriteWidth / 2 - 2,
          y: anchor.y - spriteHeight - 2,
          width: spriteWidth + 4,
          height: spriteHeight + 4
        },
        popover: { x: anchor.x, y: anchor.y - spriteHeight - 6 },
        depth: depthOf(world.x, world.y, 100)
      }
    })

    const allPoints = [...polygon, ...wallPolygons.flat()]
    const withChip = boundsOf([
      ...allPoints,
      { x: chip.x, y: chip.y },
      { x: chip.x + chip.width, y: chip.y + chip.height }
    ])
    const bounds: Rect = {
      x: withChip.x - 2,
      y: withChip.y - 2,
      width: withChip.width + 4,
      height: withChip.height + 4
    }

    placements.push({
      room,
      label,
      more: Math.max(0, agentIDs.length - visible.length),
      world: { x: ox, y: oy },
      polygon,
      wallPolygons,
      bounds,
      chip,
      artOrigin: { x: top.x, y: top.y, scale: camera.scale },
      seats,
      depth: depthOf(ox, oy, 0)
    })
  })

  const allSeats = placements
    .flatMap((placement) => placement.seats)
    .sort((left, right) => left.depth - right.depth)

  return {
    width,
    height,
    camera,
    rooms: placements,
    seats: allSeats
  }
}

/**
 * Hit test dos personagens (do mais à frente para o mais atrás). Devolve o
 * `sessionID` ou `null` quando o clique cai no piso vazio/corredor.
 */
export function findAgentAt(layout: IsoOfficeLayout, x: number, y: number): string | null {
  const point = { x, y }
  for (let index = layout.seats.length - 1; index >= 0; index--) {
    const seat = layout.seats[index]
    if (contains(seat.hit, point)) return seat.sessionID
  }
  return null
}

/**
 * Hit test das salas: chip do nome, piso ou paredes. A ordem é a de pintura
 * invertida — a sala na frente vence quando as áreas encostam.
 */
export function findRoomAt(layout: IsoOfficeLayout, x: number, y: number): string | null {
  const point = { x, y }
  const ordered = [...layout.rooms].sort((left, right) => right.depth - left.depth)
  for (const room of ordered) {
    if (contains(room.chip, point)) return room.room.id
    if (pointInPolygon(point, room.polygon)) return room.room.id
    if (room.wallPolygons.some((polygon) => pointInPolygon(point, polygon))) {
      return room.room.id
    }
  }
  return null
}
