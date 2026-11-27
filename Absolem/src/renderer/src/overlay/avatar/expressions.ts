import type { AvatarState } from '../../../../shared/avatar'

/**
 * Alvos de expressão por estado e interpolação por delta real.
 *
 * Constantes em segundos (nunca por frame): a taxa de quadros varia e a
 * transição precisa durar o mesmo tempo em 30 ou 144 fps. `delta` é limitado a
 * `MAX_STEP_SECONDS` para que um frame perdido não teleporte a animação; um
 * delta maior não acelera além desse teto.
 *
 * Piscar acontece só fora de `speaking`, a cada 4-7 s, com uma duração curta;
 * a frequência fica bem abaixo do limite fotossensível de 3 Hz.
 */
export interface ExpressionTargets {
  eyeOpenness: number
  antennaLift: number
  headTilt: number
  mouthOpen: number
  particleSpeed: number
  pulse: number
  sway: number
  alert: number
  aura: number
  /** 0..1: peso da pálpebra superior somado à piscada. */
  lidDroop: number
  /** 0..1: elevação da sobrancelha (atenção). */
  browRaise: number
  /** 0..1: franzido da sobrancelha (erro). */
  browFurrow: number
  /** 0..1: canto da boca para cima em repouso e ao falar. */
  smile: number
  /** 0..1: amplitude da respiração (o ritmo de 0.25 Hz fica na cena). */
  breathe: number
  /** -1..1: desvio lateral das pupilas (negativo para a esquerda). */
  lookAside: number
  /** 0..1: força da baforada do cachimbo. */
  smokeStrength: number
}

export interface ExpressionFrame extends ExpressionTargets {
  /** 1 = olho aberto, 0 = fechado pela piscada. */
  blink: number
  /**
   * Leitura final da pálpebra (0 = aberta, 1 = cobrindo o olho). Combina a
   * piscada, a abertura do estado e `lidDroop` numa única conta do motor, para
   * que a cena não multiplique os três fatores de novo.
   */
  lidClosure: number
  /** Tempo acumulado do motor (segundos), útil para pulso/partículas. */
  time: number
}

export const TRANSITION_TAU_SECONDS = 0.12
export const MAX_STEP_SECONDS = 0.05
export const ERROR_RETURN_SECONDS = 2.5
export const BLINK_DURATION_SECONDS = 0.16
export const BLINK_MIN_INTERVAL_SECONDS = 4
export const BLINK_MAX_INTERVAL_SECONDS = 7
/**
 * Quanto da abertura ocular o peso da pálpebra conserva no máximo. Em `idle`
 * (droop 0.6) a pálpebra cobre cerca de 42% do olho; em `listening` (droop 0)
 * a abertura é total.
 */
export const LID_DROOP_OPEN_FACTOR = 0.6

export const EXPRESSION_TARGETS: Record<AvatarState, ExpressionTargets> = {
  idle: {
    eyeOpenness: 0.95,
    antennaLift: 0.45,
    headTilt: 0,
    mouthOpen: 0,
    particleSpeed: 1,
    pulse: 0.15,
    sway: 1,
    alert: 0,
    aura: 0.12,
    lidDroop: 0.6,
    browRaise: 0.08,
    browFurrow: 0,
    smile: 0.5,
    breathe: 0.5,
    lookAside: 0,
    smokeStrength: 0.25
  },
  listening: {
    eyeOpenness: 1,
    antennaLift: 0.95,
    headTilt: 0.12,
    mouthOpen: 0,
    particleSpeed: 1.35,
    pulse: 0.38,
    sway: 0.6,
    alert: 0,
    aura: 0.62,
    lidDroop: 0,
    browRaise: 0.4,
    browFurrow: 0,
    smile: 0.3,
    breathe: 0.35,
    lookAside: 0,
    smokeStrength: 0.15
  },
  speaking: {
    eyeOpenness: 0.88,
    antennaLift: 0.7,
    headTilt: 0.05,
    mouthOpen: 0,
    particleSpeed: 1.7,
    pulse: 0.5,
    sway: 0.8,
    alert: 0,
    aura: 0.38,
    lidDroop: 0.3,
    browRaise: 0.12,
    browFurrow: 0,
    smile: 0.6,
    breathe: 0.7,
    lookAside: 0,
    smokeStrength: 0
  },
  thinking: {
    eyeOpenness: 0.42,
    antennaLift: 0.32,
    headTilt: -0.16,
    mouthOpen: 0,
    particleSpeed: 2.3,
    pulse: 0.24,
    sway: 0.4,
    alert: 0,
    aura: 0.3,
    lidDroop: 0.75,
    browRaise: 0.2,
    browFurrow: 0.1,
    smile: 0.15,
    breathe: 0.3,
    lookAside: 0.7,
    smokeStrength: 0.6
  },
  error: {
    eyeOpenness: 0.68,
    antennaLift: 0.12,
    headTilt: -0.22,
    mouthOpen: 0.14,
    particleSpeed: 2,
    pulse: 0.85,
    sway: 0.5,
    alert: 1,
    aura: 0.85,
    lidDroop: 0.2,
    browRaise: 0,
    browFurrow: 1,
    smile: 0,
    breathe: 0.2,
    lookAside: 0,
    smokeStrength: 0.1
  }
}

export interface ExpressionEngineOptions {
  random?: () => number
  transitionTauSeconds?: number
  errorReturnSeconds?: number
}

export interface ExpressionEngine {
  setState: (state: AvatarState) => void
  getState: () => AvatarState
  getCurrent: () => ExpressionTargets
  update: (deltaSeconds: number) => ExpressionFrame
}

const TARGET_KEYS = [
  'eyeOpenness',
  'antennaLift',
  'headTilt',
  'mouthOpen',
  'particleSpeed',
  'pulse',
  'sway',
  'alert',
  'aura',
  'lidDroop',
  'browRaise',
  'browFurrow',
  'smile',
  'breathe',
  'lookAside',
  'smokeStrength'
] as const

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value))
}

function copyTargets(source: ExpressionTargets): ExpressionTargets {
  return {
    eyeOpenness: source.eyeOpenness,
    antennaLift: source.antennaLift,
    headTilt: source.headTilt,
    mouthOpen: source.mouthOpen,
    particleSpeed: source.particleSpeed,
    pulse: source.pulse,
    sway: source.sway,
    alert: source.alert,
    aura: source.aura,
    lidDroop: source.lidDroop,
    browRaise: source.browRaise,
    browFurrow: source.browFurrow,
    smile: source.smile,
    breathe: source.breathe,
    lookAside: source.lookAside,
    smokeStrength: source.smokeStrength
  }
}

export function createExpressionEngine(options: ExpressionEngineOptions = {}): ExpressionEngine {
  const random = options.random ?? Math.random
  const tau = Math.max(0.02, options.transitionTauSeconds ?? TRANSITION_TAU_SECONDS)
  const errorReturn = Math.max(0.1, options.errorReturnSeconds ?? ERROR_RETURN_SECONDS)

  let state: AvatarState = 'idle'
  const current = copyTargets(EXPRESSION_TARGETS.idle)
  let elapsed = 0
  let errorElapsed = 0

  let nextBlinkIn = BLINK_MIN_INTERVAL_SECONDS + random() * 3
  let blinkElapsed: number | null = null

  function scheduleNextBlink(): void {
    const span = BLINK_MAX_INTERVAL_SECONDS - BLINK_MIN_INTERVAL_SECONDS
    nextBlinkIn = BLINK_MIN_INTERVAL_SECONDS + random() * span
  }

  function updateBlink(step: number): number {
    if (state === 'speaking') {
      // Sem piscar enquanto fala: a boca é o foco.
      blinkElapsed = null
      scheduleNextBlink()
      return 1
    }

    if (blinkElapsed === null) {
      nextBlinkIn -= step
      if (nextBlinkIn <= 0) blinkElapsed = 0
    }

    if (blinkElapsed === null) return 1

    blinkElapsed += step
    const progress = Math.min(1, blinkElapsed / BLINK_DURATION_SECONDS)
    const openness = 1 - Math.sin(Math.PI * progress)
    if (progress >= 1) {
      blinkElapsed = null
      scheduleNextBlink()
    }
    return clamp01(openness)
  }

  return {
    setState(next: AvatarState): void {
      if (next === state) return
      state = next
      errorElapsed = 0
      if (next === 'speaking') blinkElapsed = null
    },
    getState(): AvatarState {
      return state
    },
    getCurrent(): ExpressionTargets {
      return copyTargets(current)
    },
    update(deltaSeconds: number): ExpressionFrame {
      const raw = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
      const step = Math.min(raw, MAX_STEP_SECONDS)
      elapsed += step

      if (state === 'error') {
        errorElapsed += step
        if (errorElapsed >= errorReturn) state = 'idle'
      }

      const target = EXPRESSION_TARGETS[state]
      // Curva exponencial: independente do fps e sem overshoot.
      const factor = 1 - Math.exp(-step / tau)
      for (const key of TARGET_KEYS) {
        current[key] += (target[key] - current[key]) * factor
      }

      const blink = updateBlink(step)
      const pulse = current.pulse * (0.5 + 0.5 * Math.sin((elapsed * Math.PI * 2) / 2.4))
      // Uma única leitura: o estado abre, a piscada fecha e o peso da pálpebra
      // reduz a abertura. A cena consome `lidClosure` sem refazer a conta.
      const droopKeep = 1 - clamp01(current.lidDroop) * LID_DROOP_OPEN_FACTOR
      const lidClosure = clamp01(1 - clamp01(current.eyeOpenness * blink * droopKeep))

      return {
        eyeOpenness: clamp01(current.eyeOpenness * blink),
        lidClosure,
        antennaLift: clamp01(current.antennaLift),
        headTilt: current.headTilt,
        mouthOpen: clamp01(current.mouthOpen),
        particleSpeed: Math.max(0, current.particleSpeed),
        pulse: clamp01(pulse),
        sway: Math.max(0, current.sway),
        alert: clamp01(current.alert),
        aura: clamp01(current.aura),
        lidDroop: clamp01(current.lidDroop),
        browRaise: clamp01(current.browRaise),
        browFurrow: clamp01(current.browFurrow),
        smile: clamp01(current.smile),
        breathe: clamp01(current.breathe),
        lookAside: clampSigned(current.lookAside),
        smokeStrength: clamp01(current.smokeStrength),
        blink,
        time: elapsed
      }
    }
  }
}
