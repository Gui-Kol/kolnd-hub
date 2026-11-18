// useAnnouncer — canal único de anúncios do Big Picture para leitores de tela.
//
// Problema: o gamepad/teclado move o foco visualmente, sem equivalente textual.
// Solução: um store minúsculo + uma região `aria-live="polite"` visualmente
// oculta (montada no contêiner do Big Picture). Qualquer ponto do Big Picture
// chama `announce("texto")` — sem providers, sem contexto.
//
// Debounce (~150 ms): cada anúncio substitui o pendente e zera o timer. Só
// depois de ~150 ms sem novas mudanças o texto é publicado na região live.
// Nunca enfileira falas — navegação rápida em grade de jogos gera UMA fala
// (a do item onde a mão parou), não N falas.
//
// Detalhe anti-"mesmo texto": um leitor de tela não re-anuncia a região se o
// texto não muda. Para cobrir o caso A → B → A (mesmo rótulo de novo), a
// versão publicada alterna um zero-width space no fim — invisível e mudo
// para sínteses. Por isso o snapshot pode vir com um \u200B extra; use
// `visibleAnnouncement()` para exibição/asserções.

import { useSyncExternalStore } from 'react'

export const ANNOUNCE_DEBOUNCE_MS = 150

// Zero-width space (U+200B): invisível para o leitor de tela — usado para
// forçar mutação na região live quando o mesmo texto se repete. Escrito via
// fromCharCode para não depender de caractere invisível no fonte.
const ZWSP = String.fromCharCode(0x200b)

/** Formata "<área>, <i> de <n>: <nome>" — ex.: "Jogos, 3 de 12: Hades". */
export function formatFocusItem(area: string, index: number, total: number, name: string): string {
  return `${area}, ${index} de ${total}: ${name}`
}

let committed = ''
let pending: string | null = null
let flip = false
let timer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function commit(): void {
  timer = null
  const text = pending
  pending = null
  if (text === null || text === '') return
  // Mesmo texto de antes: alterna o ZWSP para forçar a mutação na região
  // live (sem mutação, o leitor de tela não fala de novo).
  flip = !flip
  committed = flip ? `${text}${ZWSP}` : text
  for (const listener of listeners) listener()
}

/** Publica um anúncio (após o debounce). Anúncio vazio é ignorado. */
export function announce(text: string): void {
  if (!text) return
  pending = text
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(commit, ANNOUNCE_DEBOUNCE_MS)
}

/** Texto atualmente na região live (pode conter o ZWSP de alternância). */
export function getAnnouncementSnapshot(): string {
  return committed
}

export function subscribeAnnouncements(listener: () => void): () => void {
  listeners.add(listener)
  return (): void => {
    listeners.delete(listener)
  }
}

/** Texto sem o ZWSP de alternância (para contextos de exibição/teste). */
export function visibleAnnouncement(snapshot: string): string {
  return snapshot.endsWith(ZWSP) ? snapshot.slice(0, -ZWSP.length) : snapshot
}

/** Hook da região live do Big Picture. Retorna a fala a renderizar sr-only. */
export function useAnnouncer(): string {
  return useSyncExternalStore(subscribeAnnouncements, getAnnouncementSnapshot)
}

/** Apenas para testes: zera o store entre cenários. */
export function __resetAnnouncerForTests(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  pending = null
  committed = ''
  flip = false
  listeners.clear()
}
