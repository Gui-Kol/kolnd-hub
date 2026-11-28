/**
 * Robustez do backend do avatar: detecção de WebGL, recuperação de contexto e
 * o contrato do fallback estático.
 *
 * Sem Three.js e sem DOM: o detector recebe um objeto com `getContext` e o
 * guarda de contexto só lida com callbacks, o que permite testar a lógica de
 * "tenta recriar uma vez" em Node. O `three` r187 exige WebGL2; se apenas
 * WebGL1 existir, o resultado é `fallback` (não há caminho de render).
 */
export type AvatarBackend = 'webgl2' | 'fallback'

export interface CanvasContextLike {
  getContext: (type: string) => unknown
}

export function detectWebGLBackend(canvas: CanvasContextLike): AvatarBackend {
  try {
    return canvas.getContext('webgl2') ? 'webgl2' : 'fallback'
  } catch {
    return 'fallback'
  }
}

export interface ContextLossEventLike {
  preventDefault?: () => void
}

export type ContextLossResult = 'recreate' | 'fallback' | 'ignored'

export interface ContextLossGuardOptions {
  /** Chamado no máximo uma vez; deve tentar restaurar o contexto. */
  recreate: () => void
  onFallback: (reason: string) => void
  /** Tempo máximo para o contexto voltar antes do fallback. Padrão: 2000 ms. */
  restoreTimeoutMs?: number
  schedule?: (callback: () => void, delayMs: number) => unknown
  clearScheduled?: (handle: unknown) => void
}

export interface ContextLossGuard {
  handleLost: (event?: ContextLossEventLike) => ContextLossResult
  handleRestored: () => void
  attempts: () => number
  isFallback: () => boolean
  dispose: () => void
}

export function createContextLossGuard(options: ContextLossGuardOptions): ContextLossGuard {
  const schedule =
    options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs))
  const clearScheduled =
    options.clearScheduled ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const timeoutMs = Math.max(100, options.restoreTimeoutMs ?? 2000)

  let attempts = 0
  let fallback = false
  let timer: unknown = null

  function clearTimer(): void {
    if (timer !== null) {
      clearScheduled(timer)
      timer = null
    }
  }

  function triggerFallback(reason: string): void {
    if (fallback) return
    fallback = true
    clearTimer()
    options.onFallback(reason)
  }

  return {
    handleLost(event?: ContextLossEventLike): ContextLossResult {
      // Sem `preventDefault` o Chromium não tenta restaurar o contexto.
      event?.preventDefault?.()
      if (fallback) return 'ignored'

      if (attempts >= 1) {
        triggerFallback('contexto-perdido-repetido')
        return 'fallback'
      }

      attempts += 1
      try {
        options.recreate()
      } catch {
        triggerFallback('contexto-perdido-recreate-falhou')
        return 'fallback'
      }

      timer = schedule(() => triggerFallback('contexto-perdido'), timeoutMs)
      return 'recreate'
    },
    handleRestored(): void {
      clearTimer()
    },
    attempts(): number {
      return attempts
    },
    isFallback(): boolean {
      return fallback
    },
    dispose(): void {
      clearTimer()
    }
  }
}
