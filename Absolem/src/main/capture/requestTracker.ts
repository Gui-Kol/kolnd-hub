/**
 * Controle de pedidos `capture:ask` (task 04).
 *
 * - `begin` recusa um `requestId` que já está em andamento, sem criar segunda
 *   captura/sessão Live (duplicado não duplica custo);
 * - `cancel` marca o pedido; o controlador consulta antes de capturar pixels e
 *   antes de entregar a imagem;
 * - `end` sempre limpa os dois estados, inclusive em erro/cancelamento, para
 *   não crescer em sessões longas.
 *
 * Só guarda identificadores opacos; nada de pergunta, título ou imagem.
 */

export interface CaptureRequestTracker {
  /** `true` quando este pedido é o primeiro com esse id. */
  begin: (requestId: string) => boolean
  /** Encerra o pedido e libera o id para uma nova tentativa. */
  end: (requestId: string) => void
  /** Marca como cancelado somente se o pedido existe. */
  cancel: (requestId: string) => void
  isCancelled: (requestId: string) => boolean
  isInflight: (requestId: string) => boolean
  /** Ids em andamento (cópia; seguro para iterar ao cancelar em massa). */
  inflightIds: () => string[]
  size: () => number
  clear: () => void
}

export function createCaptureRequestTracker(): CaptureRequestTracker {
  const inflight = new Set<string>()
  const cancelled = new Set<string>()

  return {
    begin(requestId: string): boolean {
      if (!requestId) return false
      if (inflight.has(requestId)) return false
      inflight.add(requestId)
      cancelled.delete(requestId)
      return true
    },
    end(requestId: string): void {
      inflight.delete(requestId)
      cancelled.delete(requestId)
    },
    cancel(requestId: string): void {
      if (inflight.has(requestId)) cancelled.add(requestId)
    },
    isCancelled: (requestId) => cancelled.has(requestId),
    isInflight: (requestId) => inflight.has(requestId),
    inflightIds: () => [...inflight],
    size: () => inflight.size,
    clear(): void {
      inflight.clear()
      cancelled.clear()
    }
  }
}
