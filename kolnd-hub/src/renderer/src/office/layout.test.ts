import { describe, expect, it } from 'vitest'
import {
  deriveOfficeSnapshot,
  type OfficeDepartment,
  type OfficeSessionInput,
  type OfficeSnapshot
} from '../../../shared/office'
import {
  findAgentAt,
  findRoomAt,
  layoutOffice,
  MAX_VISIBLE_SEATS,
  truncateRoomName,
  type IsoOfficeLayout
} from './layout'
import type { Point, Rect } from './iso'
import { pointInPolygon } from './iso'

const NOW = 1_700_000_000_000
const CANVAS = { width: 1200, height: 760 }

function workingSession(id: string, directory = `C:\\proj\\${id}`): OfficeSessionInput {
  return {
    id,
    title: `Sessão ${id}`,
    agent: 'general',
    model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
    cost: 0.02,
    tokens: { input: 1200, output: 300 },
    time: { created: NOW - 60_000, busy: NOW - 1000, idle: NOW - 30_000 },
    location: { directory }
  }
}

function department(id: string, sessionIDs: string[], name = `Sala ${id}`): OfficeDepartment {
  return {
    id,
    name,
    agentID: 'general',
    sessionIDs,
    createdAt: NOW
  }
}

/** Uma sala-departamento por sessão (para testar a grade). */
function snapshotWithRooms(rooms: number, perRoom = 1): OfficeSnapshot {
  const sessions: OfficeSessionInput[] = []
  const departments: OfficeDepartment[] = []
  for (let room = 0; room < rooms; room++) {
    const ids: string[] = []
    for (let index = 0; index < perRoom; index++) {
      const id = `ses_${room}_${index}`
      ids.push(id)
      sessions.push(workingSession(id))
    }
    departments.push(department(`dep_${room.toString(16).padStart(8, '0')}`, ids, `Sala ${room}`))
  }
  return deriveOfficeSnapshot({ sessions, departments, now: NOW })
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** SAT para quadriláteros convexos (piso isométrico não é AABB). */
function polygonsOverlap(left: readonly Point[], right: readonly Point[]): boolean {
  const axes: Point[] = []
  for (const polygon of [left, right]) {
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index]
      const b = polygon[(index + 1) % polygon.length]
      const edge = { x: b.x - a.x, y: b.y - a.y }
      const length = Math.hypot(edge.x, edge.y) || 1
      axes.push({ x: -edge.y / length, y: edge.x / length })
    }
  }
  for (const axis of axes) {
    const project = (polygon: readonly Point[]): [number, number] => {
      let min = Infinity
      let max = -Infinity
      for (const point of polygon) {
        const value = point.x * axis.x + point.y * axis.y
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
      return [min, max]
    }
    const [aMin, aMax] = project(left)
    const [bMin, bMax] = project(right)
    if (aMax <= bMin + 1e-6 || bMax <= aMin + 1e-6) return false
  }
  return true
}

function expectRoomsDisjoint(layout: IsoOfficeLayout): void {
  for (let left = 0; left < layout.rooms.length; left++) {
    for (let right = left + 1; right < layout.rooms.length; right++) {
      expect(polygonsOverlap(layout.rooms[left].polygon, layout.rooms[right].polygon)).toBe(false)
    }
  }
}

const EPSILON = 1e-6

describe('layout isométrico', () => {
  it('escala para 1, 4, 12 e 30 sessões sem sobrepor ilhas/personagens', () => {
    for (const count of [1, 4, 12, 30]) {
      const snapshot = snapshotWithRooms(count)
      const layout = layoutOffice(snapshot, CANVAS)
      expect(layout.rooms).toHaveLength(count)
      expect(layout.seats).toHaveLength(count)
      expectRoomsDisjoint(layout)

      for (const room of layout.rooms) {
        expect(room.bounds.x).toBeGreaterThanOrEqual(-EPSILON)
        expect(room.bounds.y).toBeGreaterThanOrEqual(-EPSILON)
        expect(room.bounds.x + room.bounds.width).toBeLessThanOrEqual(CANVAS.width + EPSILON)
        expect(room.bounds.y + room.bounds.height).toBeLessThanOrEqual(CANVAS.height + EPSILON)
        expect(room.polygon).toHaveLength(4)
        expect(room.wallPolygons).toHaveLength(2)
        expect(room.chip.width).toBeGreaterThan(0)
      }

      const hits = layout.seats.map((seat) => seat.hit)
      for (let left = 0; left < hits.length; left++) {
        for (let right = left + 1; right < hits.length; right++) {
          expect(overlaps(hits[left], hits[right])).toBe(false)
        }
      }
    }
  })

  it('até 8 mesas visíveis por sala; o resto vira "mais N"', () => {
    const snapshot = snapshotWithRooms(1, 12)
    const layout = layoutOffice(snapshot, CANVAS)
    expect(layout.rooms).toHaveLength(1)
    expect(layout.rooms[0].seats).toHaveLength(MAX_VISIBLE_SEATS)
    expect(layout.rooms[0].more).toBe(4)
    expect(layout.seats).toHaveLength(MAX_VISIBLE_SEATS)

    const room = layout.rooms[0]
    for (const seat of room.seats) {
      expect(seat.roomID).toBe(room.room.id)
      // O pé do personagem fica dentro do piso da sua sala.
      expect(pointInPolygon(seat.anchor, room.polygon)).toBe(true)
    }
  })

  it('é determinístico por id (entrada embaralhada, mesma cena)', () => {
    const snapshot = snapshotWithRooms(12, 2)
    const first = layoutOffice(snapshot, { width: 1000, height: 700 })
    const shuffled: OfficeSnapshot = {
      ...snapshot,
      rooms: [...snapshot.rooms].reverse(),
      agents: [...snapshot.agents].reverse()
    }
    const second = layoutOffice(shuffled, { width: 1000, height: 700 })
    expect(JSON.stringify(second.seats)).toBe(JSON.stringify(first.seats))
    expect(JSON.stringify(second.rooms)).toBe(JSON.stringify(first.rooms))
  })

  it('sessões sem departamento caem em "Sem sala" com chip próprio', () => {
    const snapshot = deriveOfficeSnapshot({
      now: NOW,
      sessions: [workingSession('ses_a'), workingSession('ses_b')]
    })
    expect(snapshot.rooms).toHaveLength(1)
    const layout = layoutOffice(snapshot, CANVAS)
    expect(layout.rooms).toHaveLength(1)
    expect(layout.rooms[0].room.unassigned).toBe(true)
    expect(layout.rooms[0].room.name).toBe('Sem sala')
    expect(layout.seats).toHaveLength(2)
  })

  it('hit test: personagem, sala (piso/chip) e vazio', () => {
    const layout = layoutOffice(snapshotWithRooms(2, 2), { width: 900, height: 600 })
    const seat = layout.seats[0]
    const center = { x: seat.hit.x + seat.hit.width / 2, y: seat.hit.y + seat.hit.height / 2 }
    expect(findAgentAt(layout, center.x, center.y)).toBe(seat.sessionID)
    expect(findAgentAt(layout, -100, -100)).toBeNull()

    const room = layout.rooms[0]
    const floorCenter = {
      x: (room.polygon[0].x + room.polygon[1].x + room.polygon[2].x + room.polygon[3].x) / 4,
      y: (room.polygon[0].y + room.polygon[1].y + room.polygon[2].y + room.polygon[3].y) / 4
    }
    expect(findRoomAt(layout, floorCenter.x, floorCenter.y)).toBe(room.room.id)
    expect(findRoomAt(layout, room.chip.x + 4, room.chip.y + 4)).toBe(room.room.id)
    expect(findRoomAt(layout, -100, -100)).toBeNull()
  })

  it('trunca nomes longos e lida com snapshot vazio', () => {
    expect(truncateRoomName('Kolnd Hub')).toBe('Kolnd Hub')
    const long = truncateRoomName('a'.repeat(60))
    expect(long).toHaveLength(22)
    expect(long.endsWith('…')).toBe(true)

    const layout = layoutOffice(snapshotWithRooms(2), CANVAS)
    for (const room of layout.rooms) expect(room.label.length).toBeLessThanOrEqual(22)

    const empty = layoutOffice(deriveOfficeSnapshot({ sessions: [], now: NOW }), {
      width: 800,
      height: 600
    })
    expect(empty.rooms).toEqual([])
    expect(empty.seats).toEqual([])
    expect(empty.width).toBe(800)
  })

  it('cada clique de personagem fica contido na caixa da sua sala', () => {
    const layout = layoutOffice(snapshotWithRooms(4, 2), CANVAS)
    for (const seat of layout.seats) {
      const room = layout.rooms.find((entry) => entry.room.id === seat.roomID)
      expect(room).toBeDefined()
      if (!room) continue
      expect(rectContains(room.bounds, seat.anchor)).toBe(true)
    }
  })
})
