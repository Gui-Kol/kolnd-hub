import { describe, expect, it } from 'vitest'
import {
  deriveOfficeSnapshot,
  type OfficeSessionInput,
  type OfficeSnapshot
} from '../../../shared/office'
import { findAgentAt, spaceLayout, truncateRoomName, type Rect } from './layout'

const NOW = 1_700_000_000_000
const CANVAS = { width: 1200, height: 800 }

function workingSession(id: string, directory: string, title?: string): OfficeSessionInput {
  return {
    id,
    title: title ?? `Sessão ${id}`,
    agent: 'general',
    model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
    cost: 0.02,
    tokens: { input: 1200, output: 300 },
    time: { created: NOW - 60_000, busy: NOW - 1000, idle: NOW - 30_000 },
    location: { directory }
  }
}

/** Snapshot realista: `rooms` projetos, `perRoom` sessões trabalhando em cada. */
function snapshotWith(rooms: number, perRoom = 1, nameLength = 0): OfficeSnapshot {
  const sessions: OfficeSessionInput[] = []
  for (let room = 0; room < rooms; room++) {
    const suffix = nameLength > 0 ? `-${'x'.repeat(nameLength)}` : ''
    for (let index = 0; index < perRoom; index++) {
      sessions.push(workingSession(`ses_${room}_${index}`, `C:\\proj-${room}${suffix}`))
    }
  }
  return deriveOfficeSnapshot({ sessions, now: NOW })
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function expectDisjoint(rects: readonly Rect[]): void {
  for (let left = 0; left < rects.length; left++) {
    for (let right = left + 1; right < rects.length; right++) {
      expect(overlaps(rects[left], rects[right])).toBe(false)
    }
  }
}

const EPSILON = 1e-6

describe('layout do escritório', () => {
  it('escala para 1, 4, 12 e 30 salas sem sobreposição', () => {
    for (const count of [1, 4, 12, 30]) {
      const layout = spaceLayout(snapshotWith(count), CANVAS)
      expect(layout.rooms).toHaveLength(count)
      expect(layout.seats).toHaveLength(count)
      expectDisjoint(layout.rooms.map((room) => room.bounds))

      for (const room of layout.rooms) {
        expect(room.bounds.x).toBeGreaterThanOrEqual(0)
        expect(room.bounds.y).toBeGreaterThanOrEqual(0)
        expect(room.bounds.x + room.bounds.width).toBeLessThanOrEqual(CANVAS.width + EPSILON)
        expect(room.bounds.y + room.bounds.height).toBeLessThanOrEqual(CANVAS.height + EPSILON)
        // Cabeçalho e piso não se sobrepõem.
        expect(room.header.y + room.header.height).toBeLessThanOrEqual(room.floor.y + EPSILON)
        expect(room.floor.y + room.floor.height).toBeLessThanOrEqual(
          room.bounds.y + room.bounds.height + EPSILON
        )
      }

      expect(layout.corridor.y + layout.corridor.height).toBeLessThanOrEqual(
        CANVAS.height + EPSILON
      )
      for (const room of layout.rooms) {
        expect(overlaps(room.bounds, layout.corridor)).toBe(false)
      }
    }
  })

  it('30 sessões em 3 salas cabem sem mesas/personagens sobrepostos', () => {
    const layout = spaceLayout(snapshotWith(3, 10), CANVAS)
    expect(layout.seats).toHaveLength(30)
    expectDisjoint(layout.seats.map((seat) => seat.desk))
    expectDisjoint(layout.seats.map((seat) => seat.sprite))
    expectDisjoint(layout.seats.map((seat) => seat.cell))

    for (const seat of layout.seats) {
      const room = layout.rooms.find((entry) => entry.room.id === seat.roomID)
      expect(room).toBeDefined()
      if (!room) continue
      // Tudo dentro do piso da sala e fora de sobreposição vertical.
      expect(seat.cell.x).toBeGreaterThanOrEqual(room.floor.x - EPSILON)
      expect(seat.cell.y).toBeGreaterThanOrEqual(room.floor.y - EPSILON)
      expect(seat.cell.x + seat.cell.width).toBeLessThanOrEqual(
        room.floor.x + room.floor.width + EPSILON
      )
      expect(seat.cell.y + seat.cell.height).toBeLessThanOrEqual(
        room.floor.y + room.floor.height + EPSILON
      )
      expect(seat.bubble.y + seat.bubble.height).toBeLessThanOrEqual(seat.sprite.y + EPSILON)
      expect(seat.sprite.y + seat.sprite.height).toBeLessThanOrEqual(seat.desk.y + EPSILON)
    }
  })

  it('é determinístico e estável por id (entrada embaralhada, mesma cena)', () => {
    const snapshot = snapshotWith(12, 2)
    const first = spaceLayout(snapshot, { width: 1000, height: 700 })
    const shuffled: OfficeSnapshot = {
      ...snapshot,
      rooms: [...snapshot.rooms].reverse(),
      agents: [...snapshot.agents].reverse()
    }
    const second = spaceLayout(shuffled, { width: 1000, height: 700 })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    // Repetir com a mesma entrada também não muda nada.
    expect(JSON.stringify(spaceLayout(snapshot, { width: 1000, height: 700 }))).toBe(
      JSON.stringify(first)
    )
  })

  it('trunca nomes longos de sala', () => {
    expect(truncateRoomName('Kolnd Hub')).toBe('Kolnd Hub')
    const long = truncateRoomName('a'.repeat(60))
    expect(long).toHaveLength(22)
    expect(long.endsWith('…')).toBe(true)

    const layout = spaceLayout(snapshotWith(30, 1, 80), CANVAS)
    for (const room of layout.rooms) {
      expect(room.label.length).toBeLessThanOrEqual(22)
      expect(room.label.endsWith('…')).toBe(true)
    }
  })

  it('hit test devolve o personagem pelo rect e nulo fora', () => {
    const layout = spaceLayout(snapshotWith(2), { width: 900, height: 600 })
    const seat = layout.seats[0]
    const centerX = seat.sprite.x + seat.sprite.width / 2
    const centerY = seat.sprite.y + seat.sprite.height / 2
    expect(findAgentAt(layout, centerX, centerY)).toBe(seat.sessionID)
    expect(findAgentAt(layout, seat.desk.x + seat.desk.width / 2, seat.desk.y + 1)).toBe(
      seat.sessionID
    )
    expect(findAgentAt(layout, -50, -50)).toBeNull()
  })

  it('snapshot vazio não gera salas nem assentos', () => {
    const empty = deriveOfficeSnapshot({ sessions: [], now: NOW })
    const layout = spaceLayout(empty, { width: 800, height: 600 })
    expect(layout.rooms).toEqual([])
    expect(layout.seats).toEqual([])
    expect(layout.corridor.width).toBe(800 - 32)
    expect(layout.corridor.height).toBe(34)
  })
})
