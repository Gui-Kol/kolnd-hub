/**
 * Tipos do store persistente compartilhados entre main, preload e renderer.
 *
 * Os valores default e os normalizadores vivem em `src/main/store.ts` (só o
 * main toca no disco). O shared existe para o contrato IPC e para o renderer
 * conhecer as mesmas formas sem duplicar strings.
 */

import type { ThemeConfig } from './theme'

export type { ThemeConfig } from './theme'

export const STORE_KEYS = [
  'overlay',
  'theme',
  'voice',
  'gemini',
  'privacy',
  'permissions',
  'ui',
  'usage',
  'chat'
] as const

export type StoreKey = (typeof STORE_KEYS)[number]

export const OVERLAY_POSITIONS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'] as const

export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number]

/** Geometria persistida do overlay, em DIPs. */
export interface OverlayLayout {
  position: OverlayPosition
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export interface OverlayConfig extends OverlayLayout {
  visible: boolean
  shortcut: string
  hideOnFullscreen: boolean
}

export interface VoiceConfig {
  enabled: boolean
  inputDeviceId: string | null
  outputDeviceId: string | null
  outputVolume: number
  /** Limite de duração contínua da sessão Live (gate de custo). */
  maxSessionMinutes: number
  /** Fechamento automático por falta de fala (gate de custo). */
  silenceTimeoutSeconds: number
}

export interface GeminiConfig {
  model: string
  temperature: number
  /** Teto mensal de tokens (aprovação do gate de custo). */
  monthlyTokenCap: number
}

export interface PrivacyConfig {
  telemetry: boolean
  screenCapture: boolean
}

export interface PermissionsConfig {
  microphone: boolean
  screenVision: boolean
  computerControl: boolean
  fileAccess: boolean
}

export interface UiConfig {
  language: string
  reducedMotion: boolean
  startMinimized: boolean
}

/** Consumo diário de tokens do motor Gemini. */
export interface UsageDay {
  input: number
  output: number
  calls: number
}

/** Chave `usage` do store: dias `YYYY-MM-DD` + meses já avisados. */
export interface UsageConfig {
  days: Record<string, UsageDay>
  warnedMonths: string[]
}

/** Turno persistido da conversa (chave `chat`). */
export interface ChatTurn {
  role: 'user' | 'model'
  text: string
  at: number
}

export interface ChatConfig {
  turns: ChatTurn[]
}

/** Snapshot completo do store, sempre normalizado pelo main. */
export interface AbsolemConfig {
  overlay: OverlayConfig
  theme: ThemeConfig
  voice: VoiceConfig
  gemini: GeminiConfig
  privacy: PrivacyConfig
  permissions: PermissionsConfig
  ui: UiConfig
  usage: UsageConfig
  chat: ChatConfig
}
