/**
 * Orçamento de desempenho e degradação automática em três passos.
 *
 * A média de `frameMs` é medida em uma janela de tempo real (2 s de frames
 * somados), não em "N frames", para não mudar de comportamento com o fps. Se a
 * média passar de 20 ms, o nível sobe um passo; a degradação é monotônica
 * (nunca volta) e cada nível é logado uma única vez pelo callback.
 *
 * Módulo puro: a cena injeta o callback que aplica pixelRatio, partículas e
 * detalhe do corpo. `forceDegrade` existe só para a flag de desenvolvimento
 * `?slow=1`, que percorre os três passos sem esperar 6 s.
 */
export const SLOW_FRAME_MS = 20
export const SLOW_WINDOW_MS = 2000
export const MAX_DEGRADATION_LEVEL = 3

export interface DegradationStep {
  level: number
  action: 'pixel-ratio' | 'half-particles' | 'low-detail'
  detail: string
  /** Nível 2: remove contorno de partes pequenas (task 19). */
  removeSmallOutlines?: boolean
  /** Nível 3: remove todo o contorno (task 19). */
  removeOutlines?: boolean
  /** Nível 3: remove a luz direcional; só ambiente (task 19). */
  directionalToAmbientOnly?: boolean
}

export const DEGRADATION_STEPS: readonly DegradationStep[] = [
  { level: 1, action: 'pixel-ratio', detail: 'pixelRatio fixo em 1' },
  {
    level: 2,
    action: 'half-particles',
    detail: 'metade das partículas + sem contorno de partes pequenas',
    removeSmallOutlines: true
  },
  {
    level: 3,
    action: 'low-detail',
    detail: '5 segmentos + sem ruído + sem contorno + só ambiente',
    removeOutlines: true,
    directionalToAmbientOnly: true
  }
] as const

/** Efeitos de degradação por nível (puro, testável). */
export interface DegradationEffects {
  pixelRatioCap1: boolean
  halfParticles: boolean
  minimalBody: boolean
  noNoise: boolean
  removeSmallOutlines: boolean
  removeOutlines: boolean
  directionalToAmbientOnly: boolean
}

export function degradationEffectsForLevel(level: number): DegradationEffects {
  const normalized = Math.min(MAX_DEGRADATION_LEVEL, Math.max(0, Math.floor(level)))
  return {
    pixelRatioCap1: normalized >= 1,
    halfParticles: normalized >= 2,
    minimalBody: normalized >= 3,
    noNoise: normalized >= 3,
    removeSmallOutlines: normalized >= 2,
    removeOutlines: normalized >= 3,
    directionalToAmbientOnly: normalized >= 3
  }
}

export interface PerfMonitorOptions {
  slowFrameMs?: number
  windowMs?: number
  onDegrade?: (level: number, step: DegradationStep) => void
}

export interface PerfMonitor {
  /** Registra um frame e devolve o nível vigente (0..3). */
  reportFrame: (frameMs: number) => number
  getLevel: () => number
  /** Usado por `?slow=1`: sobe um passo imediatamente e loga uma vez. */
  forceDegrade: () => number
  reset: () => void
}

export function createPerfMonitor(options: PerfMonitorOptions = {}): PerfMonitor {
  const slowFrameMs = options.slowFrameMs ?? SLOW_FRAME_MS
  const windowMs = Math.max(100, options.windowMs ?? SLOW_WINDOW_MS)

  let level = 0
  let windowTotalMs = 0
  let windowFrames = 0

  function degrade(): number {
    if (level >= MAX_DEGRADATION_LEVEL) return level
    level += 1
    const step = DEGRADATION_STEPS[level - 1]
    options.onDegrade?.(level, step)
    return level
  }

  return {
    reportFrame(frameMs: number): number {
      if (typeof frameMs !== 'number' || !Number.isFinite(frameMs) || frameMs <= 0) return level

      windowTotalMs += frameMs
      windowFrames += 1

      if (windowTotalMs >= windowMs) {
        const average = windowTotalMs / windowFrames
        if (average > slowFrameMs) degrade()
        windowTotalMs = 0
        windowFrames = 0
      }

      return level
    },
    getLevel(): number {
      return level
    },
    forceDegrade(): number {
      windowTotalMs = 0
      windowFrames = 0
      return degrade()
    },
    reset(): void {
      level = 0
      windowTotalMs = 0
      windowFrames = 0
    }
  }
}
