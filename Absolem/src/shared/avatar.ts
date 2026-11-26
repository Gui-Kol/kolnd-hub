/**
 * Contrato de estado do avatar, compartilhado entre main, preload e renderer.
 *
 * O renderer é agnóstico de tema: recebe cores como parâmetro (a task 04
 * alimenta o tema real; nesta task o default é o accent do store).
 */
export const AVATAR_STATES = ['idle', 'listening', 'speaking', 'thinking', 'error'] as const

export type AvatarState = (typeof AVATAR_STATES)[number]

export const DEFAULT_AVATAR_STATE: AvatarState = 'idle'

/** Accent padrão do store (`#3b82f6`, task 00). */
export const DEFAULT_AVATAR_ACCENT = '#3b82f6'

/** Cor de alerta do estado `error`; não entra no store nesta task. */
export const AVATAR_ERROR_ACCENT = '#f87171'

export interface AvatarTheme {
  accent: string
  accentMuted?: string
}

export interface AvatarStatus {
  state: AvatarState
  level: number
}

/** Payload de `avatar:set-state`. */
export interface AvatarSetStateRequest {
  state: AvatarState
}

/** Payload de `avatar:set-level` (RMS normalizado 0..1). */
export interface AvatarSetLevelRequest {
  level: number
}

/** Push main -> overlay `avatar:apply`; campos ausentes mantêm o valor. */
export interface AvatarApplyPush {
  state?: AvatarState
  level?: number
}

export function isAvatarState(value: unknown): value is AvatarState {
  return typeof value === 'string' && (AVATAR_STATES as readonly string[]).includes(value)
}

/** Estado desconhecido nunca quebra a cena: cai em `idle`. */
export function normalizeAvatarState(value: unknown): AvatarState {
  return isAvatarState(value) ? value : DEFAULT_AVATAR_STATE
}

/** Nível fora da faixa ou não numérico é limitado a 0..1. */
export function clampAvatarLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
