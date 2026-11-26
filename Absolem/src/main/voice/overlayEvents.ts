/**
 * Aviso interno de "overlay escondido".
 *
 * O controlador do overlay não importa o módulo de voz (evita ciclo); ele só
 * emite este evento e o controlador de voz assina. Esconder o overlay precisa
 * fechar a sessão e o microfone (gate de privacidade).
 */

const listeners = new Set<() => void>()

export function onOverlayHidden(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitOverlayHidden(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Um assinante com falha não impede os demais nem o hide.
    }
  }
}

export function resetOverlayHiddenListenersForTests(): void {
  listeners.clear()
}
