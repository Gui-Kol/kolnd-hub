/**
 * Contrato compartilhado da faixa de FPS do HUD.
 *
 * FRONTEIRA: este arquivo não importa `main/`, `preload/` nem `renderer/` — é
 * a fonte única dos três processos (mesmo padrão de `hwmon.ts`). O main monta a
 * leitura a partir do sink elevado, o preload só transporta e o renderer valida
 * de novo antes de desenhar qualquer número.
 *
 * Regra central: um número SÓ existe com `state === 'live'`. Todo estado de
 * erro é `—` + motivo curto; nunca 0, 60 ou o último valor congelado.
 */

/** Janela de agregação publicada pelo agente (1 s). */
export const FPS_WINDOW_MS = 1_000
/** Sink mais velho que isso é `unavailable` (o agente publica a cada 1 s). */
export const FPS_SINK_STALE_MS = 3_000
/** O main reescreve o heartbeat a cada 2 s; o agente para após ~5 s sem ele. */
export const FPS_HEARTBEAT_INTERVAL_MS = 2_000
export const FPS_HEARTBEAT_STALE_MS = 5_000
/** Cache de leitura do sink no main. */
export const FPS_READ_CACHE_MS = 500
export const FPS_MAX_SINK_BYTES = 64 * 1024
export const FPS_MAX_PIDS = 64
/** Sanidade do que a UI pode exibir. */
export const FPS_MAX_FPS = 1_000
export const FPS_MAX_FRAMETIME_MS = 1_000
export const FPS_MAX_PROCESS_NAME_LENGTH = 260

/** Estados possíveis da faixa. Só `live` carrega número. */
export const HUD_FPS_STATES = [
  'live',
  'warming',
  'no-target',
  'no-presents',
  'unavailable',
  'outdated',
  'not-activated'
] as const
export type HudFpsState = (typeof HUD_FPS_STATES)[number]

/**
 * Motivos (whitelist curta). A UI traduz para texto; o motivo nunca é um
 * número e nunca vem do sink sem validação.
 */
export const HUD_FPS_REASONS = [
  'self-focus',
  'foreground-ignored',
  'no-foreground',
  'no-presents',
  'stale',
  'engine-missing',
  'outdated',
  'not-activated',
  'warming'
] as const
export type HudFpsReason = (typeof HUD_FPS_REASONS)[number]

export interface HudFpsReading {
  state: HudFpsState
  /** Só preenchido em `live`; caso contrário `null`. */
  fps: number | null
  /** Frametime médio da janela, em ms; só em `live`. */
  frametimeMs: number | null
  /** Nome de exibição do processo; só em `live`. */
  processName: string | null
  reason?: HudFpsReason
}

/** Amostra por processo publicada pelo agente (schema 2). */
export interface FpsPidSample {
  pid: number
  name: string
  presents: number
  frametimeMs: number
}

/** `latest.json` do diretório de captura (entrada não confiável). */
export interface FpsSink {
  schema: 2
  engine: { name: 'PresentMon'; version: string }
  timestamp: string
  foregroundPid: number | null
  foregroundName: string | null
  windowMs: number
  pids: FpsPidSample[]
}

/** Resposta de `fps:status` (selo do Monitor + leitura). */
export interface FpsStatusInfo {
  /** `null` quando a consulta da tarefa não foi conclusiva. */
  installed: boolean | null
  /** `true` quando há leitura `live`. */
  active: boolean
  reading: HudFpsReading
}

/** Resposta de `fps:activate` (primeiro atalho ou "Tentar de novo"). */
export interface FpsActivationResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  reading: HudFpsReading
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isHudFpsState(value: unknown): value is HudFpsState {
  return typeof value === 'string' && (HUD_FPS_STATES as readonly string[]).includes(value)
}

export function isHudFpsReason(value: unknown): value is HudFpsReason {
  return typeof value === 'string' && (HUD_FPS_REASONS as readonly string[]).includes(value)
}

function isPlausibleFps(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= FPS_MAX_FPS
}

function isPlausibleFrametime(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= FPS_MAX_FRAMETIME_MS
  )
}

/**
 * Normaliza uma leitura vinda do IPC/renderer. Ausente/inválida = `null`
 * (a UI cai em "—"). Em `live` fps, frametime e nome precisam ser plausíveis;
 * em qualquer outro estado os números são DESCARTADOS — nenhum caminho deixa
 * um valor congelado aparecer.
 */
export function normalizeHudFpsReading(input: unknown): HudFpsReading | null {
  if (!isRecord(input)) return null
  if (!isHudFpsState(input.state)) return null

  if (input.state === 'live') {
    if (!isPlausibleFps(input.fps) || !isPlausibleFrametime(input.frametimeMs)) return null
    if (typeof input.processName !== 'string') return null
    const name = input.processName.trim()
    if (!name || name.length > FPS_MAX_PROCESS_NAME_LENGTH) return null
    return {
      state: 'live',
      fps: input.fps,
      frametimeMs: input.frametimeMs,
      processName: name
    }
  }

  const reading: HudFpsReading = {
    state: input.state,
    fps: null,
    frametimeMs: null,
    processName: null
  }
  if (isHudFpsReason(input.reason)) reading.reason = input.reason
  return reading
}

/** Leitura neutra de "—" com motivo (nunca carrega número). */
export function fpsReadingWithReason(
  state: Exclude<HudFpsState, 'live'>,
  reason?: HudFpsReason
): HudFpsReading {
  const reading: HudFpsReading = {
    state,
    fps: null,
    frametimeMs: null,
    processName: null
  }
  if (reason) reading.reason = reason
  return reading
}
