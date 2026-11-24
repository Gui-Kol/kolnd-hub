// Lógica pura da busca global (atalho "/") — sem Electron/IPC/DOM, só dados.
// Mantida em `lib/` para ser testável em vitest, no mesmo padrão de
// `lib/games.ts` e `lib/appsConfig.ts`.

import type { AppConfig, Game } from '../types'

export interface SearchResult {
  kind: 'app' | 'game'
  id: string
  label: string
  subtitle?: string
}

/** Máximo de resultados exibidos no overlay — mantém a lista navegável. */
const MAX_RESULTS = 8

const normalize = (value: string): string => value.trim().toLowerCase()

// Apps casam por nome, categoria e tags (substring simples — sem score).
function appMatches(app: AppConfig, query: string): boolean {
  if (normalize(app.name).includes(query)) return true
  if (normalize(app.category).includes(query)) return true
  return app.tags.some((tag) => normalize(tag).includes(query))
}

// Jogos só têm nome como texto livre hoje — substring no nome basta.
function gameMatches(game: Game, query: string): boolean {
  return normalize(game.name).includes(query)
}

/**
 * Filtra apps + jogos por substring case-insensitive no texto relevante.
 * Query vazia/só-espaços retorna []; o resultado preserva a ordem de entrada
 * (apps na ordem recebida, depois jogos na ordem recebida — estável) e é
 * limitado a 8 itens.
 */
export function filterSearch(
  query: string,
  apps: ReadonlyArray<AppConfig>,
  games: ReadonlyArray<Game>
): SearchResult[] {
  const q = normalize(query)
  if (q.length < 1) return []

  const results: SearchResult[] = []

  for (const app of apps) {
    if (appMatches(app, q)) {
      results.push({
        kind: 'app',
        id: app.id,
        label: app.name,
        subtitle: app.tags.length > 0 ? app.tags.join(' · ') : app.category
      })
    }
    if (results.length >= MAX_RESULTS) return results
  }

  for (const game of games) {
    if (gameMatches(game, q)) {
      results.push({
        kind: 'game',
        id: game.id,
        label: game.name,
        subtitle:
          game.origin === 'steam'
            ? 'Steam'
            : game.origin === 'epic'
              ? 'Epic Games'
              : game.origin === 'minecraft'
                ? 'Minecraft'
                : 'Personalizado'
      })
    }
    if (results.length >= MAX_RESULTS) return results
  }

  return results
}
