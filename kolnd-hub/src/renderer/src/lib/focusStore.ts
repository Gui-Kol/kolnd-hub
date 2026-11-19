// Store externo do id focado do Big Picture.
//
// Por que ele existe: o id focado muda a cada movimento do D-pad. Se morasse no
// `value` do contexto de foco, TODO consumidor re-renderizaria a cada movimento
// (a grade inteira de jogos). Aqui cada focável assina o store e re-renderiza
// apenas quando o SEU booleano `focused` muda (useSyncExternalStore).
//
// Puro e sem React: a notificação é testável no Vitest (environment node) e o
// provider só guarda a instância — mudar o foco não re-renderiza o provider.

export interface FocusStore {
  /** Id focado atual (`null` = nada focado). */
  get: () => string | null
  /** Define o id focado; notifica assinantes só quando o id muda de fato. */
  set: (id: string | null) => void
  /** Assina mudanças; retorna a função de cancelamento. */
  subscribe: (listener: () => void) => () => void
}

export function createFocusStore(initial: string | null = null): FocusStore {
  let current = initial
  const listeners = new Set<() => void>()

  return {
    get: (): string | null => current,
    set: (id: string | null): void => {
      // Mesmo id: nada mudou — notificar aqui re-renderizaria todos os focáveis
      // à toa (ex.: re-focar o item que já estava focado).
      if (id === current) return
      current = id
      // Cópia da lista: um assinante pode cancelar a assinatura durante o aviso
      // (desmonte de card no meio da navegação) sem quebrar a iteração.
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return (): void => {
        listeners.delete(listener)
      }
    }
  }
}
