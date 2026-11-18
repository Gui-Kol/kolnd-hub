import type { OfficeAgent, OfficeRoom, OfficeSnapshot } from '../../../shared/office'
import { AGENT_HEIGHT, AGENT_WIDTH } from './art'

/**
 * Layout do escritório — função pura, sem DOM e sem canvas.
 *
 * Recebe o snapshot e o tamanho do canvas e devolve retângulos de salas,
 * corredor, mesas, personagens e bolhas. Tudo é derivado de forma determinística
 * (salas por `id`, personagens por `sessionID`), para que o mesmo estado pinte
 * sempre a mesma cena e o clique tenha alvos estáveis.
 *
 * Invariantes que os testes cobrem:
 * - salas ficam na grade sem sobreposição;
 * - mesa/personagem/bolha ficam dentro da célula da sua sala;
 * - mesas e personagens não se sobrepõem entre si;
 * - nomes longos de sala são truncados.
 */

const PADDING = 16
const GAP = 14
const CORRIDOR_HEIGHT = 34
const HEADER_HEIGHT = 24
const MAX_COLUMNS = 4
const MAX_SEATS_PER_ROW = 4
const MAX_ROOM_NAME = 22

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Célula de um personagem: alvo de clique + retângulos de desenho. */
export interface SeatPlacement {
  sessionID: string
  roomID: string
  /** Área reservada do piso (contém os demais retângulos). */
  cell: Rect
  /** mesa (tampo + pés) desenhada na frente do personagem. */
  desk: Rect
  /** personagem em pixel art, apoiado no topo da mesa. */
  sprite: Rect
  /** bolha de atividade acima da cabeça (altura pode ser 0 em espaço curto). */
  bubble: Rect
}

export interface RoomPlacement {
  room: OfficeRoom
  /** Nome já truncado para caber no cabeçalho. */
  label: string
  bounds: Rect
  header: Rect
  floor: Rect
  seats: SeatPlacement[]
}

export interface OfficeLayout {
  width: number
  height: number
  /** Faixa decorativa no rodapé do canvas (portas/corredor). */
  corridor: Rect
  rooms: RoomPlacement[]
  /** Todos os assentos na mesma ordem das salas — atalho para hit test. */
  seats: SeatPlacement[]
}

export interface OfficeLayoutOptions {
  width: number
  height: number
  padding?: number
  gap?: number
  corridorHeight?: number
  headerHeight?: number
}

function clampRect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width: Math.max(0, width), height: Math.max(0, height) }
}

/** Trunca o nome da sala mantendo o fim legível (…). */
export function truncateRoomName(name: string, max: number = MAX_ROOM_NAME): string {
  const flat = name.replace(/\s+/g, ' ').trim()
  if (max <= 0) return ''
  if (flat.length <= max) return flat
  if (max === 1) return '…'
  return `${flat.slice(0, max - 1)}…`
}

/** Quantas colunas a grade de salas usa para o total informado. */
function columnsFor(count: number): number {
  if (count <= 1) return 1
  return Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(Math.sqrt(count))))
}

/** Colunas internas de assentos: poucas mesas ficam lado a lado; muitas viram grade. */
function seatColumnsFor(count: number): number {
  if (count <= 1) return 1
  if (count <= 2) return 2
  if (count <= 6) return 3
  return MAX_SEATS_PER_ROW
}

function buildSeats(room: OfficeRoom, agentIDs: readonly string[], floor: Rect): SeatPlacement[] {
  const count = agentIDs.length
  if (count === 0) return []
  const cols = Math.min(seatColumnsFor(count), count)
  const rows = Math.ceil(count / cols)
  // Nunca divide por zero em canvas degenerado (0×0 durante a primeira medição).
  const cellW = floor.width / cols
  const cellH = floor.height / rows

  const seats: SeatPlacement[] = []
  for (let index = 0; index < count; index++) {
    const col = index % cols
    const row = Math.floor(index / cols)
    const cell = clampRect(floor.x + col * cellW, floor.y + row * cellH, cellW, cellH)

    const inset = Math.min(6, cell.width * 0.08)
    const deskHeight = Math.min(14, Math.max(2, cell.height * 0.22))
    const desk = clampRect(
      cell.x + inset,
      cell.y + cell.height - deskHeight,
      cell.width - inset * 2,
      deskHeight
    )

    // Bolha ocupa até 30% da altura livre; o sprite usa o resto, preservando 12:20.
    const freeHeight = Math.max(0, desk.y - cell.y)
    const bubbleHeight = Math.min(16, freeHeight * 0.3)
    const spriteSpace = Math.max(0, freeHeight - bubbleHeight - 2)
    const spriteHeight = Math.min(AGENT_HEIGHT, spriteSpace, cell.width * 2.4)
    const spriteWidth = spriteHeight * (AGENT_WIDTH / AGENT_HEIGHT)
    const sprite = clampRect(
      cell.x + (cell.width - spriteWidth) / 2,
      desk.y - spriteHeight,
      spriteWidth,
      spriteHeight
    )
    const bubble = clampRect(cell.x + 2, cell.y, cell.width - 4, bubbleHeight)

    seats.push({ sessionID: agentIDs[index], roomID: room.id, cell, desk, sprite, bubble })
  }
  return seats
}

/**
 * Monta a cena. Salas entram em grade (até 4 colunas) e o rodapé é sempre o
 * corredor — o mesmo desenho para 1 ou 30 sessões, só muda a escala das células.
 */
export function spaceLayout(snapshot: OfficeSnapshot, options: OfficeLayoutOptions): OfficeLayout {
  const width = Math.max(0, options.width)
  const height = Math.max(0, options.height)
  const padding = options.padding ?? PADDING
  const gap = options.gap ?? GAP
  const corridorHeight = options.corridorHeight ?? CORRIDOR_HEIGHT
  const headerHeight = options.headerHeight ?? HEADER_HEIGHT

  const byID = new Map<string, OfficeAgent>()
  for (const agent of snapshot.agents) byID.set(agent.sessionID, agent)

  // Ordem por id (não a do snapshot): embaralhar a entrada não muda a cena.
  const rooms = [...snapshot.rooms].sort((a, b) => a.id.localeCompare(b.id))
  const columns = columnsFor(rooms.length)
  const rows = Math.max(1, Math.ceil(rooms.length / columns))

  const innerWidth = Math.max(0, width - padding * 2)
  const innerHeight = Math.max(0, height - padding * 2 - corridorHeight - gap)
  const roomWidth = columns > 0 ? Math.max(0, (innerWidth - gap * (columns - 1)) / columns) : 0
  const roomHeight = Math.max(0, (innerHeight - gap * (rows - 1)) / rows)

  const corridor = clampRect(padding, padding + innerHeight + gap, innerWidth, corridorHeight)

  const placements: RoomPlacement[] = []
  const allSeats: SeatPlacement[] = []

  rooms.forEach((room, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const bounds = clampRect(
      padding + col * (roomWidth + gap),
      padding + row * (roomHeight + gap),
      roomWidth,
      roomHeight
    )
    const header = clampRect(
      bounds.x,
      bounds.y,
      bounds.width,
      Math.min(headerHeight, bounds.height * 0.4)
    )
    const floor = clampRect(
      bounds.x,
      bounds.y + header.height,
      bounds.width,
      bounds.height - header.height
    )

    const agentIDs = [...new Set(room.agentIDs)]
      .filter((sessionID) => byID.has(sessionID))
      .sort((a, b) => a.localeCompare(b))
    const seats = buildSeats(room, agentIDs, floor)
    allSeats.push(...seats)

    placements.push({
      room,
      label: truncateRoomName(room.name || 'Sem projeto'),
      bounds,
      header,
      floor,
      seats
    })
  })

  return { width, height, corridor, rooms: placements, seats: allSeats }
}

/**
 * Hit test dos personagens: bolha, sprite e mesa, na ordem em que o usuário
 * percebe o alvo. Devolve o `sessionID` ou `null` quando o clique é no vazio.
 */
export function findAgentAt(layout: OfficeLayout, x: number, y: number): string | null {
  const inside = (rect: Rect): boolean =>
    x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height

  for (const seat of layout.seats) {
    if (inside(seat.sprite) || inside(seat.desk) || inside(seat.bubble)) return seat.sessionID
  }
  return null
}
