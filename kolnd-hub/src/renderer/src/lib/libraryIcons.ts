/**
 * Ícones da Biblioteca no renderer: cache por id e retentativa única.
 *
 * O main pode terminar o reparo/re materialização depois do primeiro
 * `getGameIcon`; um `null` cacheado congelaria o card até remontar. Depois do
 * carregamento inicial, uma única nova tentativa por id resolve a corrida sem
 * criar um laço de requisições.
 */

export interface GameIdLike {
  id: string
}

/**
 * Ids que voltaram `null` e ainda não tiveram a segunda tentativa. A ordem é a
 * dos jogos (estável) e cada id aparece uma única vez.
 */
export function nextIconRetryIds(
  games: ReadonlyArray<GameIdLike>,
  icons: Readonly<Record<string, string | null>>,
  attempted: ReadonlySet<string>
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const game of games) {
    if (icons[game.id] !== null) continue
    if (attempted.has(game.id) || seen.has(game.id)) continue
    seen.add(game.id)
    ids.push(game.id)
  }
  return ids
}
