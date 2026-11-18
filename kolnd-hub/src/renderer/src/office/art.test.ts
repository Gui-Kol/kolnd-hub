import { describe, expect, it } from 'vitest'
import {
  AGENT_HEIGHT,
  AGENT_WIDTH,
  FURNITURE,
  WORKING_FRAME_COUNT,
  agentFrames,
  agentPalette,
  officePalette
} from './art'
import type { OfficeAgentStatus } from '../../../shared/office'

const STATUSES: OfficeAgentStatus[] = ['working', 'needsYou', 'idle', 'ended', 'unknown']

function validChars(rows: readonly string[], palette: Record<string, string>): string[] {
  const invalid: string[] = []
  for (const row of rows) {
    for (const char of row) {
      if (char === '.') continue
      if (!palette[char]) invalid.push(char)
    }
  }
  return invalid
}

describe('arte procedural do escritório', () => {
  it('todos os quadros têm as dimensões do avatar', () => {
    for (const status of STATUSES) {
      const frames = agentFrames(status)
      expect(frames.length).toBeGreaterThan(0)
      for (const frame of frames) {
        expect(frame).toHaveLength(AGENT_HEIGHT)
        for (const row of frame) expect(row).toHaveLength(AGENT_WIDTH)
      }
    }
  })

  it('trabalhando tem quadros de digitação', () => {
    expect(agentFrames('working')).toHaveLength(WORKING_FRAME_COUNT)
    // Os quadros precisam diferir entre si, senão não há animação.
    const signatures = new Set(agentFrames('working').map((frame) => frame.join('|')))
    expect(signatures.size).toBe(WORKING_FRAME_COUNT)
  })

  it('só usa índices presentes na paleta', () => {
    const seeds = [0, 1, 42, 4_294_967_295]
    for (const seed of seeds) {
      for (const status of STATUSES) {
        const palette = agentPalette(seed, status)
        for (const frame of agentFrames(status)) {
          expect(validChars(frame, palette)).toEqual([])
        }
      }
    }
  })

  it('mesma seed ⇒ mesmo visual (determinístico)', () => {
    for (const status of STATUSES) {
      expect(agentPalette(1234, status)).toEqual(agentPalette(1234, status))
      expect(agentFrames(status).map((frame) => frame.join('|'))).toEqual(
        agentFrames(status).map((frame) => frame.join('|'))
      )
    }
  })

  it('seeds diferentes produzem variação de cabelo/pele/camisa', () => {
    const looks = new Set(
      Array.from({ length: 24 }, (_, seed) =>
        JSON.stringify({
          hair: agentPalette(seed, 'working').h,
          skin: agentPalette(seed, 'working').s,
          shirt: agentPalette(seed, 'working').c
        })
      )
    )
    expect(looks.size).toBeGreaterThan(1)
    expect(agentPalette(1, 'working')).not.toEqual(agentPalette(2, 'working'))
  })

  it('encerrado fica acinzentado, independente da seed', () => {
    expect(agentPalette(1, 'ended')).toEqual(agentPalette(999, 'ended'))
    expect(agentPalette(1, 'ended').c).toBe('#47525e')
  })

  it('a mão levantada usa o tom de aviso', () => {
    const frame = agentFrames('needsYou')[0]
    expect(frame.join('')).toContain('w')
    const palette = agentPalette(7, 'needsYou')
    expect(palette.w).toBe('#f5d76e')
  })

  it('móveis têm linhas de largura consistente e paleta válida', () => {
    const palette = officePalette()
    for (const sprite of Object.values(FURNITURE)) {
      expect(sprite.width).toBeGreaterThan(0)
      expect(sprite.height).toBe(sprite.rows.length)
      for (const row of sprite.rows) expect(row).toHaveLength(sprite.width)
      expect(validChars(sprite.rows, palette)).toEqual([])
    }
    // Dimensões explícitas usadas pelo layout (desk 24×12, monitor 16×12).
    expect(FURNITURE.desk.width).toBe(24)
    expect(FURNITURE.monitor.width).toBe(16)
  })
})
