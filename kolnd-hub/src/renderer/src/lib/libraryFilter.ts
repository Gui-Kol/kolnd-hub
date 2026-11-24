// Filtros/busca/ordenação da Biblioteca (T4) — puro, sem React/Electron.
// A busca ignora acento e caixa (NFD + remoção de diacríticos); o estado
// desses filtros vive só em memória no componente (nunca no localStorage).

import type { Game, GameOrigin } from '../types'

// 'all' ou qualquer origem existente no modelo (steam/epic/minecraft/custom) —
// fica em sincronia automática com `GameOrigin` (fonte: src/renderer/src/types.ts).
export type LibrarySourceFilter = 'all' | GameOrigin
export type LibrarySort = 'name-asc' | 'name-desc' | 'playtime-desc' | 'recent'

export interface LibraryFilterState {
  /** Texto livre da busca por nome. */
  search: string
  /** Origem: todas ou uma origem específica (Steam, Epic, Minecraft, Personalizado). */
  source: LibrarySourceFilter
  /** Nome da coleção ('' = todas). */
  collection: string
  /** Só jogos com o executável ausente no disco. */
  missingOnly: boolean
  sort: LibrarySort
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilterState = {
  search: '',
  source: 'all',
  collection: '',
  missingOnly: false,
  sort: 'name-asc'
}

/** Texto comparável: sem acento, minúsculo e com espaços normalizados. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Comparação de nome pt-BR sem diferenciar acento/caixa (empate estável por id). */
function compareNames(a: Game, b: Game): number {
  const byName = a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  return byName !== 0 ? byName : a.id.localeCompare(b.id)
}

/** `true` quando algum filtro (inclusive ordenação não padrão) está ativo. */
export function hasActiveLibraryFilters(filters: LibraryFilterState): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.source !== DEFAULT_LIBRARY_FILTERS.source ||
    filters.collection.trim() !== '' ||
    filters.missingOnly ||
    filters.sort !== DEFAULT_LIBRARY_FILTERS.sort
  )
}

/**
 * Aplica busca, origem, coleção, "sem executável" e ordenação.
 * `missingIds` é o conjunto já calculado por `findMissingGameIds`.
 */
export function applyLibraryFilters(
  games: readonly Game[],
  filters: LibraryFilterState,
  missingIds: ReadonlySet<string> = new Set()
): Game[] {
  const query = normalizeSearchText(filters.search)
  const collection = filters.collection.trim().toLowerCase()

  const filtered = games.filter((game) => {
    if (query && !normalizeSearchText(game.name).includes(query)) return false
    if (filters.source !== 'all' && game.origin !== filters.source) return false
    if (
      collection &&
      !(game.collections ?? []).some((name) => name.trim().toLowerCase() === collection)
    ) {
      return false
    }
    if (filters.missingOnly && !missingIds.has(game.id)) return false
    return true
  })

  const sorted = [...filtered]
  switch (filters.sort) {
    case 'name-desc':
      sorted.sort((a, b) => compareNames(b, a))
      break
    case 'playtime-desc':
      sorted.sort((a, b) => {
        const diff = (b.playtimeSeconds ?? 0) - (a.playtimeSeconds ?? 0)
        return diff !== 0 ? diff : compareNames(a, b)
      })
      break
    case 'recent':
      sorted.sort((a, b) => {
        const aAt = a.lastPlayedAt ? Date.parse(a.lastPlayedAt) : Number.NaN
        const bAt = b.lastPlayedAt ? Date.parse(b.lastPlayedAt) : Number.NaN
        const aValid = !Number.isNaN(aAt)
        const bValid = !Number.isNaN(bAt)
        if (aValid && bValid && aAt !== bAt) return bAt - aAt
        if (aValid !== bValid) return aValid ? -1 : 1
        return compareNames(a, b)
      })
      break
    case 'name-asc':
    default:
      sorted.sort(compareNames)
      break
  }
  return sorted
}
