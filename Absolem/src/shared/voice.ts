/**
 * Contrato da voz em tempo real (task 06).
 *
 * O main é o dono do estado: o renderer só reflete o push `voice:state`. As
 * transições válidas ficam aqui para que main, preload e renderer usem a mesma
 * tabela (a task 11 também lê os rótulos para leitores de tela).
 */

export const VOICE_STATES = [
  'off',
  'connecting',
  'listening',
  'thinking',
  'speaking',
  'error'
] as const

export type VoiceState = (typeof VOICE_STATES)[number]

export const DEFAULT_VOICE_STATE: VoiceState = 'off'

/** Atalho global de alternância (clique no avatar faz o mesmo). */
export const VOICE_DEFAULT_SHORTCUT = 'Control+Alt+Space'

/** Motivos estáveis usados no `reason` do push e no log. */
export const VOICE_REASONS = {
  user: 'user',
  shortcut: 'shortcut',
  hide: 'hide',
  timeoutSilence: 'timeout-silence',
  timeoutMaxDuration: 'timeout-max-duration',
  deviceChanged: 'device-changed',
  consentDenied: 'consent-denied',
  bargeIn: 'barge-in',
  interrupted: 'interrupted',
  turnComplete: 'turn-complete',
  shutdown: 'shutdown',
  reconnecting: 'reconnecting',
  error: 'error'
} as const

export type VoiceReason = (typeof VOICE_REASONS)[keyof typeof VOICE_REASONS]

/** Texto curto exibido/exposto a leitores de tela (task 11 consome). */
export const VOICE_STATE_LABELS: Record<VoiceState, string> = {
  off: 'Voz desligada',
  connecting: 'Conectando ao Gemini',
  listening: 'Ouvindo',
  thinking: 'Pensando',
  speaking: 'Falando',
  error: 'Erro na voz'
}

/**
 * Tabela única de transições. Regra de ouro: `speaking` só nasce de
 * `thinking`; `error` pode vir de qualquer estado ativo e preserva o motivo.
 */
const TRANSITIONS: Record<VoiceState, readonly VoiceState[]> = {
  off: ['connecting', 'error'],
  connecting: ['listening', 'error', 'off'],
  listening: ['thinking', 'off', 'error'],
  thinking: ['speaking', 'listening', 'off', 'error'],
  speaking: ['listening', 'thinking', 'off', 'error'],
  error: ['off', 'connecting']
}

export function isVoiceState(value: unknown): value is VoiceState {
  return typeof value === 'string' && (VOICE_STATES as readonly string[]).includes(value)
}

/** Estado desconhecido nunca quebra a UI: cai em `off`. */
export function normalizeVoiceState(value: unknown): VoiceState {
  return isVoiceState(value) ? value : DEFAULT_VOICE_STATE
}

export function canTransition(from: VoiceState, to: VoiceState): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Nome das transições para mensagens de erro legíveis. */
export function describeTransition(from: VoiceState, to: VoiceState): string {
  return `${from} -> ${to}`
}

export interface VoiceStateChange {
  state: VoiceState
  reason?: string
}

/** Payload do push `voice:state`. */
export type VoiceStatePush = VoiceStateChange

/** Payload do push `voice:audio` (PCM16 do modelo, taxa informada). */
export interface VoiceAudioPush {
  data: Uint8Array
  sampleRate: number
}

/** Payload do push `voice:transcript`. */
export interface VoiceTranscriptPush {
  role: 'user' | 'model'
  text: string
  final: boolean
  interrupted: boolean
}

/** `voice:set-consent` (persiste em `permissions.microphone`). */
export interface VoiceSetConsentRequest {
  granted: boolean
}

/** `voice:set-device`: campos ausentes preservam o valor vigente. */
export interface VoiceSetDeviceRequest {
  inputDeviceId?: string | null
  outputDeviceId?: string | null
}

/** Status devolvido por `voice:status` e pelas ações do toggle. */
export interface VoiceStatus {
  state: VoiceState
  reason: string | null
  consentGranted: boolean
  sessionActive: boolean
  inputDeviceId: string | null
  outputDeviceId: string | null
  outputVolume: number
  /** Barge-in habilitado (padrão ligado). */
  bargeIn?: boolean
}
