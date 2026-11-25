// Tipos canônicos do registro de uso local (task logs-uso-detalhados).
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única compartilhada pelos três processos (mesmo
// padrão de `hwmon.ts`/`hud.ts`). Tipos puros, sem runtime de plataforma.
//
// Privacidade: o registro é LOCAL (JSONL em `%APPDATA%\kolnd-hub\logs`).
// Nunca entram linha de comando, caminho de executável, IP, token, URL nem
// título de janela — só ids, nomes exibidos, página e duração.

export type UsageEventType =
  | 'session-start'
  | 'session-end'
  | 'page-view'
  | 'app-launch'
  | 'app-stop'
  | 'game-launch'
  | 'action'

/** Páginas do app que geram `page-view` (whitelist). */
export type UsagePage = 'dashboard' | 'settings' | 'inicializacao' | 'biblioteca'

/** Ações explícitas registradas no evento `action`. */
export type UsageAction = 'config-export' | 'config-import'

export interface UsageEvent {
  /** ISO do momento do evento. */
  ts: string
  type: UsageEventType
  /** Preenchido em `session-start`/`session-end`. */
  sessionId?: string
  page?: UsagePage
  appId?: string
  /** Rótulo exibido (app/jogo) — nunca caminho. */
  name?: string
  gameId?: string
  /** Versão do Hub no `session-start` (ex.: `1.2.1`). */
  version?: string
  action?: UsageAction
  /** Duração da sessão do Hub, em segundos (`session-end`). */
  durationSeconds?: number
}

export interface UsageLogPrefs {
  enabled: boolean
  retentionDays: number
}

/** Filtros aceitos por `usage:read` / `usage:summary`. */
export interface UsageReadOptions {
  /** Data local inicial (`YYYY-MM-DD`, inclusiva). */
  from?: string
  /** Data local final (`YYYY-MM-DD`, inclusiva). */
  to?: string
  type?: UsageEventType
  page?: UsagePage
  /** Quantidade máxima de eventos (mais recentes primeiro). */
  limit?: number
}

export interface UsageReadResult {
  ok: boolean
  events: UsageEvent[]
  error?: string
}

export interface UsageSummaryResult {
  ok: boolean
  summary: UsageSummary
  error?: string
}

export interface UsageExportResult {
  success: boolean
  path?: string
  canceled?: boolean
  error?: string
}

export interface ClearUsageResult {
  success: boolean
  removed: number
  error?: string
}

/** Opções de retenção oferecidas na UI (dias). */
export const USAGE_RETENTION_OPTIONS = [7, 30, 90] as const
/** Retenção padrão (dias). */
export const USAGE_RETENTION_DEFAULT = 30
/** Tamanho máximo do arquivo do dia; acima disso o dia para de anexar. */
export const USAGE_MAX_FILE_BYTES = 2 * 1024 * 1024

export const USAGE_EVENT_TYPES: readonly UsageEventType[] = [
  'session-start',
  'session-end',
  'page-view',
  'app-launch',
  'app-stop',
  'game-launch',
  'action'
] as const

export const USAGE_PAGES: readonly UsagePage[] = [
  'dashboard',
  'settings',
  'inicializacao',
  'biblioteca'
] as const

export const USAGE_ACTIONS: readonly UsageAction[] = ['config-export', 'config-import'] as const

export interface UsageSummary {
  totalSessions: number
  totalSeconds: number
  byDay: Array<{ date: string; events: number; seconds: number }>
  topApps: Array<{ id: string; name: string; launches: number }>
  topGames: Array<{ id: string; name: string; launches: number }>
  pageViews: Record<UsagePage, number>
}

/** Preferências padrão do registro de uso. */
export function defaultUsageLogPrefs(): UsageLogPrefs {
  return { enabled: true, retentionDays: USAGE_RETENTION_DEFAULT }
}

/** `true` quando `value` é uma retenção permitida (7/30/90). */
export function isUsageRetentionDays(value: unknown): value is number {
  return typeof value === 'number' && USAGE_RETENTION_OPTIONS.includes(value as never)
}
