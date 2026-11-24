import { describe, it, expect } from 'vitest'
import { filterSearch } from './globalSearch'
import type { AppConfig, Game } from '../types'

const app = (over: Partial<AppConfig>): AppConfig => ({
  id: 'app-x',
  name: 'App X',
  description: 'd',
  icon: '📦',
  color: '#000',
  gradient: 'g',
  command: 'x.exe',
  cwd: 'C:\\x',
  category: 'dev',
  tags: [],
  ...over
})

const game = (over: Partial<Game>): Game => ({
  id: 'game-x',
  name: 'Game X',
  exePath: 'C:\\games\\x.exe',
  iconPath: null,
  origin: 'custom',
  addedAt: '2026-01-01T00:00:00.000Z',
  ...over
})

describe('filterSearch', () => {
  it('retorna vazio para query vazia ou só espaços', () => {
    const apps = [app({ name: 'Mark LVI' })]
    expect(filterSearch('', apps, [])).toEqual([])
    expect(filterSearch('   ', apps, [])).toEqual([])
  })

  it('ignora espaços ao redor da query (trim)', () => {
    const apps = [app({ id: 'a1', name: 'Mark LVI' })]
    const out = filterSearch('  mark  ', apps, [])
    expect(out.map((r) => r.id)).toEqual(['a1'])
  })

  it('casa substring case-insensitive no nome', () => {
    const apps = [app({ id: 'a1', name: 'Mark LVI' })]
    expect(filterSearch('MARK', apps, []).map((r) => r.id)).toEqual(['a1'])
    expect(filterSearch('lvi', apps, []).map((r) => r.id)).toEqual(['a1'])
    expect(filterSearch('kloud', apps, [])).toEqual([])
  })

  it('casa categoria e tags de app', () => {
    const apps = [
      app({ id: 'a1', name: 'Alpha', category: 'streaming', tags: [] }),
      app({ id: 'a2', name: 'Beta', category: 'dev', tags: ['cloud', 'render'] })
    ]
    expect(filterSearch('stream', apps, []).map((r) => r.id)).toEqual(['a1'])
    expect(filterSearch('cloud', apps, []).map((r) => r.id)).toEqual(['a2'])
    expect(filterSearch('RENDER', apps, []).map((r) => r.id)).toEqual(['a2'])
  })

  it('limita o resultado a 8 itens', () => {
    const apps = Array.from({ length: 12 }, (_, i) => app({ id: `a${i}`, name: `Ferramenta ${i}` }))
    const out = filterSearch('ferramenta', apps, [])
    expect(out).toHaveLength(8)
    expect(out.map((r) => r.id)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])
  })

  it('combina apps e jogos (apps primeiro, jogos depois)', () => {
    const apps = [app({ id: 'a1', name: 'Kloud App' })]
    const games = [game({ id: 'g1', name: 'Kloud Quest' }), game({ id: 'g2', name: 'Outro' })]
    const out = filterSearch('kloud', apps, games)
    expect(out.map((r) => r.kind)).toEqual(['app', 'game'])
    expect(out.map((r) => r.id)).toEqual(['a1', 'g1'])
  })

  it('preserva a ordem de entrada (ordenação estável)', () => {
    const apps = [
      app({ id: 'a1', name: 'Beta Suite' }),
      app({ id: 'a2', name: 'Alpha Suite' }),
      app({ id: 'a3', name: 'Gamma Suite' })
    ]
    const games = [game({ id: 'g1', name: 'Zeta Suite' }), game({ id: 'g2', name: 'Delta Suite' })]
    const out = filterSearch('suite', apps, games)
    expect(out.map((r) => r.id)).toEqual(['a1', 'a2', 'a3', 'g1', 'g2'])
  })

  it('preenche subtitle e badge por tipo', () => {
    const apps = [app({ id: 'a1', name: 'Kloud App', tags: ['ia', 'local'] })]
    const games = [
      game({ id: 'g1', name: 'Kloud Steam', origin: 'steam' }),
      game({ id: 'g2', name: 'Kloud Custom', origin: 'custom' }),
      game({ id: 'g3', name: 'Kloud Epic', origin: 'epic' }),
      game({ id: 'g4', name: 'Kloud Minecraft', origin: 'minecraft' })
    ]
    const out = filterSearch('kloud', apps, games)
    expect(out[0]).toMatchObject({ kind: 'app', subtitle: 'ia · local' })
    expect(out[1]).toMatchObject({ kind: 'game', subtitle: 'Steam' })
    expect(out[2]).toMatchObject({ kind: 'game', subtitle: 'Personalizado' })
    expect(out[3]).toMatchObject({ kind: 'game', subtitle: 'Epic Games' })
    expect(out[4]).toMatchObject({ kind: 'game', subtitle: 'Minecraft' })
  })

  it('usa a categoria como subtitle quando o app não tem tags', () => {
    const apps = [app({ id: 'a1', name: 'Kloud App', category: 'gaming', tags: [] })]
    expect(filterSearch('kloud', apps, [])[0].subtitle).toBe('gaming')
  })
})
