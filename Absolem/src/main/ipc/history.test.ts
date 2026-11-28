import { describe, expect, it, vi } from 'vitest'
import type { ChatTurn } from '../../shared/config'
import { listHistory, toHistoryTurn } from './history'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

function turns(count: number): ChatTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'model',
    text: `t${index}`,
    at: index
  }))
}

describe('history:list', () => {
  it('devolve os últimos turnos com limite', () => {
    const result = listHistory(
      { getTurns: () => turns(30), memoryEnabled: () => true },
      { limit: 20 }
    )

    expect(result).toMatchObject({ ok: true, enabled: true })
    if (!result.ok) throw new Error('falha')
    expect(result.turns).toHaveLength(20)
    expect(result.turns[0]?.text).toBe('t10')
    expect(result.turns.at(-1)?.text).toBe('t29')
  })

  it('marca interrompido', () => {
    const result = listHistory(
      {
        getTurns: () => [{ role: 'model', text: 'cortado', at: 1, interrupted: true }],
        memoryEnabled: () => true
      },
      undefined
    )
    expect(result.ok && result.turns[0]?.interrupted).toBe(true)
    expect(toHistoryTurn({ role: 'user', text: 'oi', at: 2 }).interrupted).toBe(false)
  })

  it('memória pausada devolve vazio', () => {
    const result = listHistory({ getTurns: () => turns(5), memoryEnabled: () => false }, undefined)
    expect(result).toEqual({ ok: true, enabled: false, turns: [] })
  })

  it('limite inválido vira erro sem lançar', () => {
    const result = listHistory(
      { getTurns: () => turns(1), memoryEnabled: () => true },
      { limit: 0 }
    )
    expect(result).toMatchObject({ ok: false })
  })
})
