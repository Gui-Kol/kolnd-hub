// Lógica pura da Biblioteca — sem Electron/IPC/DOM, só dados.
// Extraída de `components/Biblioteca.tsx` para ser testável em vitest.

/**
 * Marca quais jogos têm o executável ausente no disco.
 * `flags[i] === false` significa "não existe" (mesma semântica de
 * `games:check-exes`); qualquer outro valor (`true`, ou `undefined` quando o
 * array de flags vem mais curto que a lista de jogos) conta como existente.
 */
export function findMissingGameIds(
  games: ReadonlyArray<{ id: string }>,
  flags: ReadonlyArray<boolean>
): Set<string> {
  const missing = new Set<string>()
  games.forEach((game, index) => {
    if (flags[index] === false) missing.add(game.id)
  })
  return missing
}
