import { describe, expect, it } from 'vitest'
import type { Game } from '../types'
import { formatLastPlayed, formatPlaytime, recentGames, weekPlaytimeSeconds } from './gameStats'

describe('formatPlaytime', () => {
  it('formata minutos e horas em pt-BR', () => {
    expect(formatPlaytime(undefined)).toBe('Sem tempo')
    expect(formatPlaytime(0)).toBe('Sem tempo')
    expect(formatPlaytime(59)).toBe('menos de 1 min')
    expect(formatPlaytime(60)).toBe('1 min')
    expect(formatPlaytime(59 * 60)).toBe('59 min')
    expect(formatPlaytime(60 * 60)).toBe('1 h')
    expect(formatPlaytime(3 * 3600 + 20 * 60)).toBe('3 h 20 min')
  })

  it('ignora valores não finitos/negativos', () => {
    expect(formatPlaytime(Number.NaN)).toBe('Sem tempo')
    expect(formatPlaytime(-10)).toBe('Sem tempo')
  })
})

describe('weekPlaytimeSeconds', () => {
  // Quarta-feira, 25/11/2026 (semana começa segunda 23/11).
  const now = new Date(2026, 10, 25, 12, 0, 0)

  it('soma de segunda 00:00 local até hoje e ignora o resto', () => {
    const seconds = weekPlaytimeSeconds(
      {
        '2026-11-22': 999, // domingo da semana anterior
        '2026-11-23': 100,
        '2026-11-24': 200,
        '2026-11-25': 300,
        '2026-11-26': 999, // futuro
        invalido: 999,
        '2026-11-20': -5
      },
      now
    )
    expect(seconds).toBe(600)
  })

  it('sem dados → 0', () => {
    expect(weekPlaytimeSeconds(undefined, now)).toBe(0)
    expect(weekPlaytimeSeconds({}, now)).toBe(0)
  })
})

describe('formatLastPlayed', () => {
  const now = new Date(2026, 10, 25, 12, 0, 0)
  const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString()

  it('usa tempo relativo', () => {
    expect(formatLastPlayed(ago(10_000), now)).toBe('agora')
    expect(formatLastPlayed(ago(5 * 60_000), now)).toBe('há 5 min')
    expect(formatLastPlayed(ago(2 * 3600_000), now)).toBe('há 2 h')
    expect(formatLastPlayed(ago(3 * 24 * 3600_000), now)).toBe('há 3 dias')
    expect(formatLastPlayed(ago(14 * 24 * 3600_000), now)).toBe('há 2 semanas')
    expect(formatLastPlayed(ago(90 * 24 * 3600_000), now)).toBe('há 3 meses')
    expect(formatLastPlayed(ago(800 * 24 * 3600_000), now)).toBe('há 2 anos')
  })

  it('ISO inválido/ausente → string vazia', () => {
    expect(formatLastPlayed(undefined, now)).toBe('')
    expect(formatLastPlayed('', now)).toBe('')
    expect(formatLastPlayed('ontem', now)).toBe('')
  })
})

describe('recentGames', () => {
  function game(id: string, lastPlayedAt?: string, name = id): Game {
    return {
      id,
      name,
      exePath: `C:\\${id}.exe`,
      iconPath: null,
      origin: 'custom',
      addedAt: '2026-01-01T00:00:00.000Z',
      lastPlayedAt
    }
  }

  it('ordena por lastPlayedAt desc, exclui sem data e limita', () => {
    const list = [
      game('a', '2026-11-20T10:00:00.000Z'),
      game('sem-data'),
      game('b', '2026-11-24T10:00:00.000Z'),
      game('invalido', 'ontem'),
      game('c', '2026-11-22T10:00:00.000Z')
    ]
    expect(recentGames(list).map((g) => g.id)).toEqual(['b', 'c', 'a'])
    expect(recentGames(list, 2).map((g) => g.id)).toEqual(['b', 'c'])
    expect(recentGames(list, 0)).toEqual([])
    expect(recentGames(list, Number.NaN)).toEqual([])
  })

  it('empate de data cai no nome (pt-BR)', () => {
    const list = [
      game('z', '2026-11-20T10:00:00.000Z', 'Zelda'),
      game('a', '2026-11-20T10:00:00.000Z', 'Água')
    ]
    expect(recentGames(list).map((g) => g.id)).toEqual(['a', 'z'])
  })
})
