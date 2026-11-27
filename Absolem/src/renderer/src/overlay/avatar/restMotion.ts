import type { AvatarState } from '../../../../shared/avatar'

/**
 * Movimento de repouso do personagem sentado.
 *
 * Funções puras, sem estado e sem alocação: recebem tempo/canais e devolvem
 * números. `reducedMotion` zera sway, respiração e baforada, mas não é
 * consultado pela piscada nem pela troca de estado (essas continuam no motor de
 * expressões).
 */

/** Balanço lateral do tronco em repouso, em radianos. */
export const REST_SWAY_AMPLITUDE = 0.03
/** Velocidade angular do sway (bem abaixo de 3 Hz). */
export const REST_SWAY_OMEGA = 0.45
/** Balanço secundário do corpo, menor que o do tronco. */
export const BODY_SWAY_AMPLITUDE = 0.012
/** Frequência da respiração em Hz. */
export const BREATHE_HZ = 0.25
/** Micro-movimento da cabeça (duas senoides lentas somadas). */
export const HEAD_MICRO_AMPLITUDE = 0.006
export const HEAD_MICRO_OMEGA = 0.55
export const HEAD_MICRO_SECONDARY_AMPLITUDE = 0.003
export const HEAD_MICRO_SECONDARY_OMEGA = 1.1

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function scalar(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

/** Rotação lateral do tronco; 0 com movimento reduzido. */
export function restSway(timeSeconds: number, sway: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return Math.sin(timeSeconds * REST_SWAY_OMEGA) * REST_SWAY_AMPLITUDE * scalar(sway)
}

/** Rotação lateral do corpo, menor e mais rápida que o tronco. */
export function bodySway(timeSeconds: number, sway: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return Math.sin(timeSeconds * REST_SWAY_OMEGA * 1.6) * BODY_SWAY_AMPLITUDE * scalar(sway)
}

/** Micro-movimento da cabeça; 0 com movimento reduzido. */
export function headMicroTilt(timeSeconds: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return (
    Math.sin(timeSeconds * HEAD_MICRO_OMEGA) * HEAD_MICRO_AMPLITUDE +
    Math.sin(timeSeconds * HEAD_MICRO_SECONDARY_OMEGA) * HEAD_MICRO_SECONDARY_AMPLITUDE
  )
}

/**
 * Amplitude instantânea da respiração (0..1) a 0.25 Hz. A cena multiplica pelo
 * ganho de escala; com movimento reduzido a leitura é 0 e o corpo fica parado.
 */
export function breatheAmount(
  breathe: number,
  timeSeconds: number,
  reducedMotion: boolean
): number {
  if (reducedMotion) return 0
  const oscillator = 0.5 + 0.5 * Math.sin(timeSeconds * Math.PI * 2 * BREATHE_HZ)
  return clamp01(breathe) * oscillator
}

/** Baforada efetiva: some em `speaking` e com movimento reduzido. */
export function smokeStrengthForState(
  state: AvatarState,
  smokeStrength: number,
  reducedMotion: boolean
): number {
  if (reducedMotion || state === 'speaking') return 0
  return clamp01(smokeStrength)
}
