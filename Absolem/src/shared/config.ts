/**
 * Tipos do store persistente compartilhados entre main, preload e renderer.
 *
 * Os valores default e os normalizadores vivem em `src/main/store.ts` (só o
 * main toca no disco). O shared existe para o contrato IPC e para o renderer
 * conhecer as mesmas formas sem duplicar strings.
 */

export const STORE_KEYS = [
  'overlay',
  'theme',
  'voice',
  'gemini',
  'privacy',
  'permissions',
  'ui'
] as const

export type StoreKey = (typeof STORE_KEYS)[number]

export const OVERLAY_POSITIONS = ['bottom-left', 'bottom-right', 'top-left', 'top-right'] as const

export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number]

export interface OverlayConfig {
  enabled: boolean
  position: OverlayPosition
  scale: number
}

export const THEME_MODES = ['dark', 'light', 'system'] as const

export type ThemeMode = (typeof THEME_MODES)[number]

export interface ThemeConfig {
  mode: ThemeMode
  accent: string
}

export interface VoiceConfig {
  enabled: boolean
  inputDeviceId: string | null
  outputVolume: number
}

export interface GeminiConfig {
  model: string
  temperature: number
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

/** Snapshot completo do store, sempre normalizado pelo main. */
export interface AbsolemConfig {
  overlay: OverlayConfig
  theme: ThemeConfig
  voice: VoiceConfig
  gemini: GeminiConfig
  privacy: PrivacyConfig
  permissions: PermissionsConfig
  ui: UiConfig
}
