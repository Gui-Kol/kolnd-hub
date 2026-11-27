/**
 * Avisos internos de visibilidade do overlay.
 *
 * O controlador do overlay não importa o módulo de voz (evita ciclo); ele só
 * emite estes eventos e o controlador de voz assina. Esconder o overlay precisa
 * fechar a sessão e o microfone (gate de privacidade); exibir dispara a
 * saudação curta por horário.
 */

const hiddenListeners = new Set<() => void>()
const shownListeners = new Set<() => void>()

function notify(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Um assinante com falha não impede os demais nem a transição.
    }
  }
}

export function onOverlayHidden(listener: () => void): () => void {
  hiddenListeners.add(listener)
  return () => {
    hiddenListeners.delete(listener)
  }
}

export function emitOverlayHidden(): void {
  notify(hiddenListeners)
}

export function onOverlayShown(listener: () => void): () => void {
  shownListeners.add(listener)
  return () => {
    shownListeners.delete(listener)
  }
}

export function emitOverlayShown(): void {
  notify(shownListeners)
}

export function resetOverlayHiddenListenersForTests(): void {
  hiddenListeners.clear()
  shownListeners.clear()
}
