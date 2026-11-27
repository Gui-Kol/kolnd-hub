/**
 * Contrato da visão de tela (task 07), compartilhado entre main, preload e
 * renderer.
 *
 * Só tipos, constantes e funções puras: nada aqui toca em Electron, disco ou
 * rede. O main aplica as regras; o renderer usa os mesmos limites para desenhar
 * a seleção de região e para validar o que volta pelo IPC.
 *
 * Decisões fechadas:
 * - `mode: 'on'` é o default da visão sob demanda; nada é capturado
 *   proativamente sem uma configuração específica.
 * - blocklist é comparada por substring, sem diferenciar maiúsculas, contra
 *   título E nome do processo, depois de normalizada (trim, minúsculas, sem
 *   duplicatas, vazio descartado).
 * - coordenadas de região são DIPs relativos ao display; a conversão para
 *   pixels físicos multiplica pelo `scaleFactor` do display correto.
 * - nenhuma imagem é gravada em disco; o buffer nunca sai do processo sem
 *   necessidade.
 */

export const SCREEN_MODES = ['off', 'ask', 'on'] as const

export type ScreenMode = (typeof SCREEN_MODES)[number]

export interface PrivacyScreenConfig {
  mode: ScreenMode
  blocklist: string[]
  proactive: boolean
}

export const CAPTURE_KINDS = ['screen', 'region', 'active-window'] as const

export type CaptureKind = (typeof CAPTURE_KINDS)[number]

export interface CaptureSource {
  id: string
  name: string
  /** Presente apenas em fontes do tipo `screen`. */
  displayId?: string
  kind: 'screen' | 'window'
}

/** Retângulo em DIPs. */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/** Seleção de região relativa ao display, em DIPs. */
export interface RegionSelection {
  displayId: string
  rect: ScreenRect
}

/** Payload do pedido main -> renderer para capturar um frame. */
export interface CaptureRequestPush {
  requestId: string
  sourceId: string
  pixelWidth: number
  pixelHeight: number
  lossless: boolean
}

/** Estado resumido para `capture:status` (sem imagem e sem título). */
export interface CaptureStatus {
  mode: ScreenMode
  proactive: boolean
  active: boolean
  kind?: CaptureKind
  capturesLastHour: number
  capturesPerHourLimit: number
}

/** Indicador visível do overlay (`capture:indicator`). */
export interface CaptureIndicatorPush {
  active: boolean
  kind?: CaptureKind
}

/** Área mínima aceita para uma região (em DIPs). */
export const MIN_REGION_SIZE = 32

/** Limite de uma captura encoded (JPEG/PNG) antes do envio. */
export const MAX_CAPTURE_BYTES = 8 * 1024 * 1024

/** Maior lado da imagem enviada ao Gemini. */
export const MAX_CAPTURE_SIDE = 1280

/** Timeout do pedido de frame ao renderer, no main. */
export const CAPTURE_FRAME_TIMEOUT_MS = 4_000

/** Tempo entre esconder o overlay e capturar, para o compositor não incluí-lo. */
export const OVERLAY_HIDE_DELAY_MS = 120

/** Limite de capturas por hora (qualquer modo). */
export const MAX_CAPTURES_PER_HOUR = 20

/** Intervalo mínimo entre capturas proativas. */
export const PROACTIVE_MIN_INTERVAL_MS = 60_000

/** Tokens estimados de uma imagem: largura * altura / 750, arredondado para cima. */
export function estimateImageTokens(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0
  return Math.ceil((width * height) / 750)
}

export function isScreenMode(value: unknown): value is ScreenMode {
  return typeof value === 'string' && (SCREEN_MODES as readonly string[]).includes(value)
}

export function normalizeScreenMode(value: unknown): ScreenMode {
  return value === undefined ? 'on' : isScreenMode(value) ? value : 'on'
}

export function isCaptureKind(value: unknown): value is CaptureKind {
  return typeof value === 'string' && (CAPTURE_KINDS as readonly string[]).includes(value)
}

/**
 * Gerenciadores de senha e bancos brasileiros conhecidos. A lista é editável
 * pelo usuário; o normalizador baixa tudo para minúsculas.
 */
export const DEFAULT_SCREEN_BLOCKLIST: readonly string[] = [
  '1password',
  'bitwarden',
  'keepass',
  'lastpass',
  'dashlane',
  'nubank',
  'itaú',
  'bradesco',
  'banco do brasil',
  'santander',
  'caixa',
  'inter',
  'c6',
  'picpay',
  'mercado pago'
]

const MAX_BLOCKLIST_ENTRIES = 200
const MAX_BLOCKLIST_ENTRY_LENGTH = 120

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Normaliza a blocklist: trim, minúsculas, sem duplicatas, vazio descartado. */
export function normalizeBlocklist(input: unknown): string[] {
  const values = Array.isArray(input) ? input : []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const entry = value.trim().toLowerCase().slice(0, MAX_BLOCKLIST_ENTRY_LENGTH)
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    normalized.push(entry)
    if (normalized.length >= MAX_BLOCKLIST_ENTRIES) break
  }
  return normalized
}

function defaultBlocklist(): string[] {
  return [...DEFAULT_SCREEN_BLOCKLIST]
}

/** Normaliza `privacy.screen`; campo ausente/inválido cai no default seguro. */
export function normalizePrivacyScreenConfig(input: unknown): PrivacyScreenConfig {
  const raw = asRecord(input)
  const blocklist =
    raw.blocklist === undefined ? defaultBlocklist() : normalizeBlocklist(raw.blocklist)
  return {
    mode: normalizeScreenMode(raw.mode),
    blocklist,
    proactive: raw.proactive === true
  }
}

/** Compara título e processo com a blocklist (substring, sem caixa). */
export function isBlockedTarget(
  title: string | undefined,
  processName: string | undefined,
  blocklist: readonly string[]
): string | null {
  if (blocklist.length === 0) return null
  const targets = [title, processName]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase())
  if (targets.length === 0) return null
  for (const entry of blocklist) {
    const needle = entry.trim().toLowerCase()
    if (!needle) continue
    for (const target of targets) {
      if (target.includes(needle)) return needle
    }
  }
  return null
}

/** `true` quando o retângulo tem área positiva e ao menos 32x32 DIPs. */
export function isValidRegionRect(rect: ScreenRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width >= MIN_REGION_SIZE &&
    rect.height >= MIN_REGION_SIZE
  )
}

/**
 * Normaliza uma seleção vinda do renderer. Devolve `null` para qualquer coisa
 * inválida (display vazio, retângulo pequeno demais ou não numérico).
 */
export function normalizeRegionSelection(input: unknown): RegionSelection | null {
  const raw = asRecord(input)
  const displayId = typeof raw.displayId === 'string' ? raw.displayId.trim() : ''
  if (!displayId) return null
  const rectRaw = asRecord(raw.rect)
  const x = finiteNumber(rectRaw.x)
  const y = finiteNumber(rectRaw.y)
  const width = finiteNumber(rectRaw.width)
  const height = finiteNumber(rectRaw.height)
  if (x === null || y === null || width === null || height === null) return null
  const rect: ScreenRect = { x, y, width, height }
  if (!isValidRegionRect(rect)) return null
  return { displayId, rect }
}

/** Retângulo entre dois pontos do arrasto, em DIPs, sempre com largura positiva. */
export function computeRegionRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): ScreenRect {
  const x = Math.min(startX, endX)
  const y = Math.min(startY, endY)
  return {
    x,
    y,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY)
  }
}

export type RegionKeyAction = 'confirm' | 'cancel' | null

/** Teclas da tela de seleção: Esc cancela, Enter confirma. */
export function regionKeyAction(key: string): RegionKeyAction {
  if (key === 'Escape' || key === 'Esc') return 'cancel'
  if (key === 'Enter') return 'confirm'
  return null
}
