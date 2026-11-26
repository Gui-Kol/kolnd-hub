/**
 * Loop de render puro, sem Three.js e sem DOM.
 *
 * `raf`/`cancel` são injetados para que o ciclo seja testável em Node e para
 * que a cena controle exatamente quando agenda um frame. O delta vem sempre do
 * timestamp entregue pelo `requestAnimationFrame` (tempo real), nunca de uma
 * constante fixa; valores absurdamente altos (ex.: voltar de uma aba inativa)
 * são limitados para não teleportar a animação.
 */
export interface RenderLoop {
  start: () => void
  stop: () => void
  isRunning: () => boolean
}

export interface RenderLoopOptions {
  /** Agenda um frame e devolve o handle (equivalente a `requestAnimationFrame`). */
  raf: (callback: (timeMs: number) => void) => number
  /** Cancela um frame pendente (equivalente a `cancelAnimationFrame`). */
  cancel: (handle: number) => void
  /** Recebe delta em segundos (já limitado) e o timestamp do frame. */
  onFrame: (deltaSeconds: number, timeMs: number) => void
  /** Teto do delta em segundos; evita saltos após pausa longa. Padrão: 0.25. */
  maxDeltaSeconds?: number
}

export const DEFAULT_MAX_DELTA_SECONDS = 0.25

export function createRenderLoop(options: RenderLoopOptions): RenderLoop {
  const { raf, cancel, onFrame } = options
  const maxDelta = options.maxDeltaSeconds ?? DEFAULT_MAX_DELTA_SECONDS

  let running = false
  let handle: number | null = null
  let lastTimeMs: number | null = null

  const tick = (timeMs: number): void => {
    handle = null
    if (!running) return

    const previous = lastTimeMs
    lastTimeMs = timeMs
    // O primeiro frame não tem referência anterior: delta 0 evita um salto
    // inicial e mantém a primeira pose estável.
    const rawDelta = previous === null ? 0 : Math.max(0, (timeMs - previous) / 1000)
    const delta = Math.min(rawDelta, maxDelta)

    onFrame(delta, timeMs)

    // `onFrame` pode chamar `stop()` (ex.: perda de contexto); nesse caso não
    // reagenda. Fora isso, um único frame pendente por vez.
    if (running) handle = raf(tick)
  }

  return {
    start(): void {
      if (running) return
      running = true
      lastTimeMs = null
      handle = raf(tick)
    },
    stop(): void {
      running = false
      if (handle !== null) {
        cancel(handle)
        handle = null
      }
      lastTimeMs = null
    },
    isRunning(): boolean {
      return running
    }
  }
}
