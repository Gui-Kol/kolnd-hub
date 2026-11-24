import { describe, expect, it } from 'vitest'
import type { Game } from '../types'
import {
  applyLibraryFilters,
  DEFAULT_LIBRARY_FILTERS,
  hasActiveLibraryFilters,
  normalizeSearchText
} from './libraryFilter'

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    name: 'Jogo',
    exePath: 'C:\\g.exe',
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const games: Game[] = [
  game({
    id: 'a',
    name: 'Água e Fogo',
    origin: 'steam',
    collections: ['RPG'],
    playtimeSeconds: 100,
    lastPlayedAt: '2026-11-20T10:00:00.000Z'
  }),
  game({
    id: 'b',
    name: 'Zelda',
    origin: 'custom',
    collections: ['Aventura'],
    playtimeSeconds: 300,
    lastPlayedAt: '2026-11-24T10:00:00.000Z'
  }),
  game({
    id: 'c',
    name: 'Beta',
    origin: 'steam',
    collections: ['rpg', 'Aventura'],
    playtimeSeconds: 200
  }),
  game({ id: 'd', name: 'Sem Dados', origin: 'epic' })
]

describe('normalizeSearchText', () => {
  it('remove acento, caixa e espaços extras', () => {
    expect(normalizeSearchText('  ÁGUA   e Fogo ')).toBe('agua e fogo')
  })
})

describe('applyLibraryFilters', () => {
  it('busca por nome sem acento e case-insensitive', () => {
    const out = applyLibraryFilters(games, {
      ...DEFAULT_LIBRARY_FILTERS,
      search: 'agua'
    })
    expect(out.map((g) => g.id)).toEqual(['a'])

    expect(
      applyLibraryFilters(games, { ...DEFAULT_LIBRARY_FILTERS, search: 'ZÉLDA' }).map((g) => g.id)
    ).toEqual(['b'])
  })

  it('filtra por origem (Steam/Epic/Minecraft/Personalizado)', () => {
    expect(
      applyLibraryFilters(games, { ...DEFAULT_LIBRARY_FILTERS, source: 'steam' }).map((g) => g.id)
    ).toEqual(['a', 'c'])
    expect(
      applyLibraryFilters(games, { ...DEFAULT_LIBRARY_FILTERS, source: 'custom' }).map((g) => g.id)
    ).toEqual(['b'])
    expect(
      applyLibraryFilters(games, { ...DEFAULT_LIBRARY_FILTERS, source: 'epic' }).map((g) => g.id)
    ).toEqual(['d'])
  })

  it('filtra por coleção sem diferenciar caixa', () => {
    const out = applyLibraryFilters(games, {
      ...DEFAULT_LIBRARY_FILTERS,
      collection: 'AVENTURA'
    })
    expect(out.map((g) => g.id).sort()).toEqual(['b', 'c'])

    expect(
      applyLibraryFilters(games, { ...DEFAULT_LIBRARY_FILTERS, collection: 'rpg' }).map((g) => g.id)
    ).toEqual(['a', 'c'])
  })

  it('filtra "sem executável" pelo conjunto de ids', () => {
    const out = applyLibraryFilters(
      games,
      { ...DEFAULT_LIBRARY_FILTERS, missingOnly: true },
      new Set(['b', 'd'])
    )
    expect(out.map((g) => g.id).sort()).toEqual(['b', 'd'])
  })

  it('ordena: nome A–Z/Z–A, tempo desc e mais recentes', () => {
    expect(applyLibraryFilters(games, DEFAULT_LIBRARY_FILTERS).map((g) => g.id)).toEqual([
      'a',
      'c',
      'd',
      'b'
    ])
    expect(
      applyLibraryFilters(games, { ...DEFAULT_LIBRARY_FILTERS, sort: 'name-desc' }).map((g) => g.id)
    ).toEqual(['b', 'd', 'c', 'a'])
    expect(
      applyLibraryFilters(games, {
        ...DEFAULT_LIBRARY_FILTERS,
        sort: 'playtime-desc'
      }).map((g) => g.id)
    ).toEqual(['b', 'c', 'a', 'd'])
    expect(
      applyLibraryFilters(games, { ...DEFAULT_LIBRARY_FILTERS, sort: 'recent' }).map((g) => g.id)
    ).toEqual(['b', 'a', 'c', 'd'])
  })
})

describe('hasActiveLibraryFilters', () => {
  it('detecta cada filtro e a ordenação não padrão', () => {
    expect(hasActiveLibraryFilters(DEFAULT_LIBRARY_FILTERS)).toBe(false)
    expect(hasActiveLibraryFilters({ ...DEFAULT_LIBRARY_FILTERS, search: 'x' })).toBe(true)
    expect(hasActiveLibraryFilters({ ...DEFAULT_LIBRARY_FILTERS, source: 'steam' })).toBe(true)
    expect(hasActiveLibraryFilters({ ...DEFAULT_LIBRARY_FILTERS, collection: 'RPG' })).toBe(true)
    expect(hasActiveLibraryFilters({ ...DEFAULT_LIBRARY_FILTERS, missingOnly: true })).toBe(true)
    expect(hasActiveLibraryFilters({ ...DEFAULT_LIBRARY_FILTERS, sort: 'recent' })).toBe(true)
  })
})
