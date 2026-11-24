import { describe, expect, it, vi } from 'vitest'
import {
  applyPlaytime,
  createPlaytimeTracker,
  localDateKey,
  PLAYTIME_FLUSH_INTERVAL_MS,
  PLAYTIME_MAX_TICK_SECONDS,
  runningBaseNames,
  type PlaytimeProcess
} from './playtime'
import type { StoredGame } from '../store'

function game(overrides: Partial<StoredGame> = {}): StoredGame {
  return {
    id: 'g1',
    name: 'Jogo',
    exePath: 'C:\\Jogos\\Jogo.exe',
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const DAY_MS = 24 * 3600_000

describe('localDateKey / applyPlaytime', () => {
  it('usa a data LOCAL em YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDateKey(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })

  it('acumula total + dia sem mutar o jogo e ignora valores inválidos', () => {
    const original = game({ playtimeSeconds: 100, playtimeDays: { '2026-11-24': 40 } })
    const out = applyPlaytime(original, 61.9, new Date(2026, 10, 25, 10, 0))
    expect(out.playtimeSeconds).toBe(161)
    expect(out.playtimeDays).toEqual({ '2026-11-25': 61, '2026-11-24': 40 })
    expect(original.playtimeSeconds).toBe(100)
    expect(applyPlaytime(original, 0, new Date())).toBe(original)
    expect(applyPlaytime(original, -5, new Date())).toBe(original)
    expect(applyPlaytime(original, Number.NaN, new Date())).toBe(original)
  })

  it('mantém só os 60 dias mais recentes', () => {
    let current = game()
    const base = new Date(2026, 0, 1, 12, 0)
    for (let i = 0; i < 65; i += 1) {
      current = applyPlaytime(current, 60, new Date(base.getTime() + i * DAY_MS))
    }
    expect(Object.keys(current.playtimeDays ?? {})).toHaveLength(60)
    expect(current.playtimeDays?.['2026-01-01']).toBeUndefined()
    expect(current.playtimeDays?.['2026-03-06']).toBe(60)
  })
})

describe('runningBaseNames', () => {
  it('inclui nome e base do caminho, sem extensão e em minúsculas', () => {
    const bases = runningBaseNames([
      { name: 'Jogo', path: 'C:\\X\\Outro.exe' },
      { name: '', path: 'C:\\Y\\Terceiro.Exe' }
    ])
    expect([...bases].sort()).toEqual(['jogo', 'outro', 'terceiro'])
  })
})

describe('createPlaytimeTracker', () => {
  let now: number
  let stored: StoredGame[]
  let processes: PlaytimeProcess[]
  let failPersist: boolean
  const persistGames = vi.fn((games: StoredGame[]) => {
    if (failPersist) return false
    stored = games
    return true
  })

  function tracker(): ReturnType<typeof createPlaytimeTracker> {
    return createPlaytimeTracker({
      now: () => now,
      listRunningProcesses: async () => processes,
      getGames: () => stored,
      persistGames
    })
  }

  function reset(): void {
    now = new Date(2026, 10, 25, 9, 0, 0).getTime()
    stored = [game()]
    processes = [{ name: 'Jogo', path: 'C:\\Jogos\\Jogo.exe' }]
    failPersist = false
    persistGames.mockClear()
  }

  it('start grava lastPlayedAt no launch e abre a sessão', () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    expect(t.isTracking('g1')).toBe(true)
    expect(stored[0].lastPlayedAt).toBe(new Date(now).toISOString())
  })

  it('tick acumula e flush persiste; ausência do processo finaliza', async () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')

    now += 20_000
    await t.tick()
    expect(stored[0].playtimeSeconds).toBeUndefined()
    t.flush()
    expect(stored[0].playtimeSeconds).toBe(20)
    expect(stored[0].playtimeDays?.['2026-11-25']).toBe(20)

    processes = []
    now += 20_000
    await t.tick()
    expect(t.isTracking('g1')).toBe(false)
  })

  it('clampa o delta por tick em 60 s (sleep/suspensão)', async () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    now += 10 * 60_000
    await t.tick()
    t.flush()
    expect(stored[0].playtimeSeconds).toBe(PLAYTIME_MAX_TICK_SECONDS)
  })

  it('flush periódico de ~5 min acontece dentro do tick', async () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    now += PLAYTIME_FLUSH_INTERVAL_MS
    await t.tick()
    expect(stored[0].playtimeSeconds).toBe(PLAYTIME_MAX_TICK_SECONDS)
  })

  it('finish persiste o pendente; listagem que falha mantém a sessão', async () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    now += 20_000
    await t.tick()
    t.finish('g1')
    expect(t.isTracking('g1')).toBe(false)
    expect(stored[0].playtimeSeconds).toBe(20)

    reset()
    const flaky = createPlaytimeTracker({
      now: () => now,
      listRunningProcesses: async () => {
        throw new Error('sem PowerShell')
      },
      getGames: () => stored,
      persistGames
    })
    flaky.start('g1', 'C:\\Jogos\\Jogo.exe')
    await flaky.tick()
    expect(flaky.isTracking('g1')).toBe(true)
  })

  it('falha ao persistir não descarta o pendente', async () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    now += 20_000
    await t.tick()
    failPersist = true
    t.flush()
    expect(stored[0].playtimeSeconds).toBeUndefined()

    failPersist = false
    t.flush()
    expect(stored[0].playtimeSeconds).toBe(20)
  })

  it('reiniciar a sessão do mesmo jogo persiste o pendente anterior', async () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    now += 20_000
    await t.tick()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    expect(stored[0].playtimeSeconds).toBe(20)
  })

  it('jogo removido da biblioteca não quebra o tick', async () => {
    reset()
    const t = tracker()
    t.start('g1', 'C:\\Jogos\\Jogo.exe')
    stored = []
    now += 20_000
    await t.tick()
    t.flush()
    expect(persistGames).not.toHaveBeenCalledWith([])
  })
})
