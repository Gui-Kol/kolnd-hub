/**
 * Máquina de estados do clique atravessando o overlay.
 *
 * Estado padrão: NÃO interativo (`setIgnoreMouseEvents(true, { forward: true })`),
 * então cliques vão para a janela de trás e o movimento do mouse ainda chega ao
 * renderer. Quando o ponteiro entra na área do avatar, o renderer pede
 * `setInteractive(true)` e o main passa a capturar cliques; ao sair, volta para
 * não interativo.
 *
 * A segurança fica concentrada aqui: esconder, recriar ou destruir a janela
 * SEMPRE reseta para não interativo. Sem isso, uma janela recriada poderia
 * nascer capturando a área de trabalho inteira.
 */

let interactive = false
let applier: ((interactive: boolean) => void) | null = null

function apply(): void {
  try {
    applier?.(interactive)
  } catch {
    // Janela em processo de fechamento: o próximo bind/show reaplica o estado.
  }
}

/**
 * Liga o estado à janela viva. O controlador da janela chama isto ao criar e
 * desliga ao fechar (`unbind`), para não guardar referência a janela morta.
 */
export function bindOverlayInteractivity(next: (interactive: boolean) => void): void {
  applier = next
  apply()
}

export function unbindOverlayInteractivity(): void {
  applier = null
  interactive = false
}

/** `true` somente quando o valor é exatamente `true`. */
export function setInteractive(value: unknown): boolean {
  interactive = value === true
  apply()
  return interactive
}

export function isInteractive(): boolean {
  return interactive
}

/** Volta para não interativo (hide, show, close, destroy). */
export function resetInteractive(): void {
  if (!interactive) return
  interactive = false
  apply()
}

/** Hook exclusivo de teste. */
export function resetInteractiveForTests(): void {
  interactive = false
  applier = null
}
