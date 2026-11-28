/**
 * Tipos do store persistente compartilhados entre main, preload e renderer.
 *
 * Os valores default e os normalizadores vivem em `src/main/store.ts` (só o
 * main toca no disco). O shared existe para o contrato IPC e para o renderer
 * conhecer as mesmas formas sem duplicar strings.
 */

import type { ThemeConfig } from './theme'
import type { PrivacyScreenConfig } from './screen'
import type { PermissionsState } from './permissions'
import type { Routine } from './routines'

export type { ThemeConfig } from './theme'
export type { Routine, RoutineAction, RoutineWeekday, RoutineWhen } from './routines'
export type { PrivacyScreenConfig, ScreenMode } from './screen'
export type {
  PermissionCategories,
  PermissionCategory,
  PermissionDecision,
  PermissionsState
} from './permissions'

export const STORE_KEYS = [
  'overlay',
  'theme',
  'voice',
  'gemini',
  'privacy',
  'permissions',
  'ui',
  'usage',
  'chat',
  'memory',
  'web'
] as const

export type StoreKey = (typeof STORE_KEYS)[number]

/** Abas do painel de Configurações (task 11). */
export const SETTINGS_TABS = [
  'appearance',
  'voice',
  'permissions',
  'memory',
  'key',
  'diagnostics',
  'about'
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const DEFAULT_SETTINGS_TAB: SettingsTab = 'appearance'

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value)
}

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
  /** Falar durante a resposta interrompe o modelo (padrão ligado). */
  bargeIn?: boolean
  /** Atalho global de escuta (aplicado quando a sessão de voz inicia). */
  shortcut?: string
}

export interface GeminiConfig {
  /** @deprecated Campo legado; o runtime usa exclusivamente o Live. */
  model: string
  /** Modelo cognitivo único usado por conversa, visão e ferramentas. */
  liveModel: string
  temperature: number
  /** Teto mensal de tokens (aprovação do gate de custo). */
  monthlyTokenCap: number
  /** Desliga somente o teto mensal interno; quotas/rate limits do Google continuam. */
  unlimitedUsage: boolean
}

export interface PrivacyConfig {
  telemetry: boolean
  /**
   * Política da visão de tela (task 07). `mode:'off'` é o default; a captura só
   * acontece depois de o usuário escolher `ask` ou `on`.
   */
  screen: PrivacyScreenConfig
}

/**
 * Permissões do app: consentimento do microfone (task 06), pausa global e a
 * decisão por categoria de ação (task 08). O formato legado com
 * `screenVision`/`computerControl`/`fileAccess` é aceito pelo schema do store
 * apenas para migrar e descartar.
 */
export type PermissionsConfig = PermissionsState

export interface UiConfig {
  language: string
  reducedMotion: boolean
  startMinimized: boolean
  /** Aba ativa do painel de Configurações (task 11). */
  lastSettingsTab?: SettingsTab
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
  /** `true` quando o turno foi interrompido (histórico da task 11). */
  interrupted?: boolean
}

export interface ChatConfig {
  turns: ChatTurn[]
}

/**
 * Chave `memory` (task 09). `enabled:false` pausa extração e recuperação sem
 * apagar nada; `autoExtract:false` mantém a memória existente e só desliga a
 * extração automática.
 */
export interface MemoryConfig {
  enabled: boolean
  autoExtract: boolean
  /** Epoch ms da última consolidação concluída. */
  lastConsolidationAt: number | null
  /**
   * Texto livre editável na aba Memória. Sempre entra no prompt de sistema,
   * mesmo com a memória automática pausada.
   */
  note: string
}

/**
 * Chave `web` (task 10). `enabled:false` remove `web_search`/`fetch_url` do
 * registro (o modelo nem sabe que existem) e bloqueia os canais de pesquisa.
 */
export interface WebConfig {
  enabled: boolean
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
  memory: MemoryConfig
  web: WebConfig
  /** Rotinas agendadas (task 08, T8). Não é chave do IPC genérico do store. */
  routines: Routine[]
}
