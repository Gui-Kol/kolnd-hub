/**
 * Ícones da Biblioteca no renderer: cache por id e retentativa com backoff.
 *
 * O main pode terminar a materialização/extração/aquisição depois do primeiro
 * `getGameIcon`; um `null` cacheado congelaria o card até remontar. Cada id que
 * voltou `null` ganha até 3 novas tentativas (1 s, 2 s e 4 s), sem laço infinito.
 */

export interface GameIdLike {
  id: string
}

/** Atrasos das tentativas 1, 2 e 3. */
export const ICON_RETRY_DELAYS_MS = [1000, 2000, 4000] as const

/** Nº máximo de tentativas por id. */
export const ICON_RETRY_MAX = ICON_RETRY_DELAYS_MS.length

/** Atraso da tentativa `attempt` (1-based); null quando o limite acabou. */
export function retryDelayForAttempt(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1) return null
  return ICON_RETRY_DELAYS_MS[attempt - 1] ?? null
}

/**
 * `true` para o data URL do fallback gerado. Ao terminar o reload do main,
 * esses cards também precisam ser re-pedidos: a arte real pode ter substituído
 * o SVG gerado no cofre.
 */
export function isGeneratedIconDataUrl(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('data:image/svg+xml')
}

/**
 * Descarta do cache do renderer o que deve ser re-pedido após o reload:
 * `null` (sem ícone) e SVG gerado (upgrade para arte real). Devolve o mesmo
 * objeto quando nada muda, evitando re-render desnecessário.
 */
export function pruneIconsForReload(
  icons: Record<string, string | null>
): Record<string, string | null> {
  let changed = false
  const next = { ...icons }
  for (const [id, value] of Object.entries(icons)) {
    if (value !== null && !isGeneratedIconDataUrl(value)) continue
    delete next[id]
    changed = true
  }
  return changed ? next : icons
}

/**
 * Ids que voltaram `null`, ainda têm tentativa disponível e não estão com
 * timer agendado. A ordem é a dos jogos e cada id aparece uma única vez.
 */
export function nextIconRetryIds(
  games: ReadonlyArray<GameIdLike>,
  icons: Readonly<Record<string, string | null>>,
  attempts: ReadonlyMap<string, number>,
  scheduled: ReadonlySet<string> = new Set()
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const game of games) {
    const id = game.id
    if (icons[id] !== null) continue
    if (scheduled.has(id) || seen.has(id)) continue
    if ((attempts.get(id) ?? 0) >= ICON_RETRY_MAX) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}
