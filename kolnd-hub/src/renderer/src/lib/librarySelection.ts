// Seleção em lote da Biblioteca (modo de seleção) — puro, sem React/Electron.
// O estado é um `Set` de ids mantido em memória no componente (nunca persistido).
// Funções devolvem conjuntos novos para o React detectar a mudança; a única
// exceção é `pruneSelected`, que devolve a MESMA instância quando nada muda
// (evita re-render da grade a cada recarga da lista).

/** Marca/desmarca um id (sempre devolve uma instância nova). */
export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Marca todos os ids visíveis ou, se TODOS já estão marcados, desmarca só os
 * visíveis — seleções de itens filtrados para fora permanecem intactas.
 */
export function toggleSelectAllVisible(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[]
): Set<string> {
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const next = new Set(selected)
  if (allVisibleSelected) {
    for (const id of visibleIds) next.delete(id)
  } else {
    for (const id of visibleIds) next.add(id)
  }
  return next
}

/**
 * Remove da seleção os ids que não existem mais na biblioteca (jogo removido
 * ou lista recarregada). Devolve a mesma instância quando nada mudou.
 */
export function pruneSelected(
  selected: ReadonlySet<string>,
  existingIds: readonly string[]
): Set<string> {
  const existing = new Set(existingIds)
  let changed = false
  for (const id of selected) {
    if (!existing.has(id)) {
      changed = true
      break
    }
  }
  if (!changed) return selected as Set<string>
  return new Set([...selected].filter((id) => existing.has(id)))
}
