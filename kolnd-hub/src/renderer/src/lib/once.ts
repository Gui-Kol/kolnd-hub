/**
 * Memoiza uma promise por processo.
 *
 * No dev o React StrictMode monta os efeitos duas vezes; sem esse dedupe o
 * processo principal pagaria IPC caro (WMI/PowerShell) em dobro a cada
 * abertura. A factory roda no máximo 1× e a promise — resolvida OU rejeitada —
 * fica memoizada, então o segundo consumidor vê o mesmo resultado do primeiro.
 */
export function once<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null
  return (): Promise<T> => {
    promise ??= factory()
    return promise
  }
}
