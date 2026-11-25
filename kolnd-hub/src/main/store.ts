import Store from 'electron-store'
import { ipcMain } from 'electron'
import { isIP } from 'net'
import { isAbsolute } from 'path'
import { logger } from './logger'
// Fonte única dos tipos/consts de gamepad (05-5.4). Re-exportados para não
// quebrar imports existentes de `./store` (gamepad.ts, store.test.ts…).
import {
  GAMEPAD_ACTIONS,
  GAMEPAD_PROFILES,
  type GamepadProfile,
  type GamepadButtonMapping,
  type GamepadConfig
} from '../shared/gamepad'
import {
  HUD_DEFAULT_SCALE,
  HUD_DEFAULT_SHORTCUT,
  HUD_DEFAULT_WIDTH,
  isHudScale,
  normalizeAccelerator,
  normalizeHudScale,
  normalizeHudWidth,
  type HudConfig,
  type HudScale,
  type HudSize
} from '../shared/hud'
import { HWMON_INTERVAL_DEFAULT_MS, normalizeHwmonIntervalMs } from '../shared/hwmon'
export type {
  GamepadProfile,
  GamepadAction,
  GamepadButtonMapping,
  GamepadConfig
} from '../shared/gamepad'
export type { HudConfig } from '../shared/hud'

/**
 * Configuração persistente do Kolnd Hub em `%APPDATA%/<app>/config.json`.
 *
 * Antes ela vivia no localStorage do renderer, sem schema e sem migração —
 * sumia ao limpar os dados do app e qualquer entrada corrompida derrubava a
 * leitura inteira. Agora o electron-store valida o conteúdo com um schema
 * (ajv) e executa migrações versionadas no arquivo (`__internal__.migrations`,
 * baseadas em `projectVersion` = `app.getVersion()`).
 *
 * A migração dos dados antigos (localStorage) acontece via IPC: o renderer
 * envia o que tinha salvo e o main normaliza e grava aqui. Veja
 * `config:migrate` e `src/renderer/src/lib/appsConfig.ts`.
 */

export type ImportanceLevelName = 'critico' | 'recomendado' | 'opcional' | 'inutil'

export type GameOrigin = 'steam' | 'epic' | 'minecraft' | 'custom'

/** Jogo persistido na Biblioteca (electron-store, chave `games`). */
export interface StoredGame {
  id: string
  name: string
  exePath: string
  /** Caminho absoluto do ícone cacheado em `%APPDATA%/kolnd-hub/game-icons/`; null = sem ícone (fallback na UI). */
  iconPath: string | null
  /** SHA-256 do ícone no cofre (`icon-vault/<sha><ext>`); ausente = ainda não migrado. */
  iconSha?: string
  /** Extensão do blob no cofre (`.png` | `.jpg` | `.jpeg` | `.webp`). */
  iconExt?: string
  /** Procedência do ícone: manual nunca é sobrescrito por refresh/reparo. */
  iconOrigin?: 'manual' | 'derived' | 'legacy'
  origin: GameOrigin
  /** Presente apenas em jogos importados da Steam. */
  steamAppId?: number
  /** ISO timestamp de quando o jogo entrou na biblioteca. */
  addedAt: string
  /** Marcado como favorito na Biblioteca/Big Picture. */
  favorite?: boolean
  /** Nomes das coleções do jogo (máx. 8, 1–24 chars cada, únicos sem diferenciar caixa). */
  collections?: string[]
  /** Total acumulado de tempo de jogo, em segundos (inteiro ≥ 0). */
  playtimeSeconds?: number
  /** Segundos por dia local (`YYYY-MM-DD`); só os 60 dias mais recentes são mantidos. */
  playtimeDays?: Record<string, number>
  /** ISO da última vez que o jogo foi aberto pelo Hub. */
  lastPlayedAt?: string
  /** Caminho absoluto da capa escolhida em `%APPDATA%/kolnd-hub/game-covers/`; null = sem capa. */
  coverPath?: string | null
}

export interface StoredAppConfig {
  id: string
  name: string
  description: string
  icon: string
  color: string
  gradient: string
  command: string
  cwd: string
  category: 'ai' | 'gaming' | 'streaming' | 'dev'
  tags: string[]
  url?: string
  useShell?: boolean
  /**
   * Reinício automático OPT-IN (06-6.4): se o processo morre sozinho (exit ≠ 0,
   * sem `stop()` pedido), o Hub relança com backoff 2s/5s/10s, até 3 tentativas
   * a cada 10 minutos. Ausente/false = comportamento idêntico ao atual.
   * Preservado pela normalização (round-trip leitura→gravação garantido).
   */
  autoRestart?: boolean
  /**
   * Log persistente OPT-IN (05-5.7): grava stdout/stderr do processo em
   * `%APPDATA%\kolnd-hub\logs\<appId>.log` (rotação 1 MB → `<appId>.log.1`,
   * máx. 2 arquivos por app). Ausente/false = nada muda (ring buffer em RAM).
   * Preservado pela normalização (round-trip leitura→gravação garantido).
   */
  persistLogs?: boolean
}

export interface HubStoreSchema {
  apps: StoredAppConfig[]
  startupImportance: Record<string, ImportanceLevelName>
  games: StoredGame[]
  /** Coleções de jogos da Biblioteca (máx. 30, nomes 1–24 chars, únicos). */
  gameCollections: string[]
  /** Preferência: iniciar o Kloud Games junto com o Hub (default false). */
  launchKloudOnStart: boolean
  /** Preferência: notificar quando um programa gerenciado morrer inesperadamente (default true, opt-out). */
  notifyOnCrash: boolean
  /** Mapeamento de controle do modo Big Picture; null = nunca configurado. */
  gamepad: GamepadConfig | null
  /** Preferências do modo Big Picture (ex.: efeitos sonoros). */
  bigPicture: BigPicturePrefs
  /** Últimas execuções do benchmark de CPU (mais recente primeiro, cap 20). */
  benchmarkHistory: BenchmarkEntry[]
  /** Sobreposição (HUD): atalho global e visibilidade persistida. */
  hud: HudConfig
  /** Acesso remoto: último IP público consultado (só por ação explícita). */
  remoteAccess: RemoteAccessPrefs
  /**
   * Versão do pipeline de extração de ícones já aplicada aos arquivos de
   * `game-icons/` (ver `games/icons.ts`). Serve para o reparo automático rodar
   * uma única vez por versão do pipeline.
   */
  gameIconsVersion: number
  /**
   * Intervalo do polling do monitor de hardware (aba Monitor + HUD), em ms.
   * Sempre lido/gravado normalizado por `normalizeHwmonIntervalMs`.
   */
  hwmonIntervalMs: number
}

// ── Big Picture: controle (gamepad) ──────────────────────
// Fonte única dos tipos/consts: `src/shared/gamepad.ts` (05-5.4). O main não
// importa o renderer; o shared é importável pelos dois projetos tsconfig.
// Re-exportados acima para não quebrar imports existentes (`./store`).
// Qualquer alteração nos 12 controles/índices acontece no shared — drift
// vira erro de compilação nos três processos.

/** Preferências do modo Big Picture (chave `bigPicture`). */
export interface BigPicturePrefs {
  sounds: boolean
}

/**
 * Preferências do acesso remoto (chave `remoteAccess`).
 *
 * Guarda apenas o RESULTADO da última consulta de IP público — credenciais do
 * ZeroTier nunca passam pelo Hub (ficam no serviço/app do ZeroTier).
 */
export interface RemoteAccessPrefs {
  /** "Modo remoto" ligado pelo card do Kloud Games (só com ZeroTier conectado). */
  mode: boolean
  lastPublicIp: string | null
  /** ISO da última consulta bem-sucedida. */
  lastPublicIpCheckedAt: string | null
}

export function defaultRemoteAccessPrefs(): RemoteAccessPrefs {
  return { mode: false, lastPublicIp: null, lastPublicIpCheckedAt: null }
}

/** IP válido (v4/v6) e limitado; qualquer outra coisa vira `null`. */
function normalizePublicIp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ip = value.trim()
  if (!ip || ip.length > 64 || isIP(ip) === 0) return null
  return ip
}

/** Normaliza o objeto persistido; campos inválidos são descartados isoladamente. */
export function normalizeRemoteAccessPrefs(input: unknown): RemoteAccessPrefs {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return defaultRemoteAccessPrefs()
  }
  const raw = input as Record<string, unknown>
  const mode = raw.mode === true
  const lastPublicIp = normalizePublicIp(raw.lastPublicIp)
  const rawCheckedAt = raw.lastPublicIpCheckedAt
  const lastPublicIpCheckedAt =
    typeof rawCheckedAt === 'string' && rawCheckedAt.trim() && rawCheckedAt.length <= 40
      ? rawCheckedAt.trim()
      : null

  // Sem IP válido o timestamp perde o sentido — mas o modo é independente.
  if (!lastPublicIp) return { mode, lastPublicIp: null, lastPublicIpCheckedAt: null }
  return { mode, lastPublicIp, lastPublicIpCheckedAt }
}

/** Nota de um teste individual do benchmark (MOps/s em cada fase). */
export interface BenchmarkTestScore {
  id: string
  label: string
  single: number
  multi: number
}

/** Execução concluída do benchmark persistida em `benchmarkHistory`. */
export interface BenchmarkEntry {
  id: string
  at: string
  single: number
  multi: number
  ratio: number
  cores: number
  model: string
  tests: BenchmarkTestScore[]
}

const APP_CATEGORIES = ['ai', 'gaming', 'streaming', 'dev'] as const
const IMPORTANCE_LEVELS: ImportanceLevelName[] = ['critico', 'recomendado', 'opcional', 'inutil']
const GAME_ORIGINS: GameOrigin[] = ['steam', 'epic', 'minecraft', 'custom']

/** Extensões de ícone aceitas no cofre. */
const GAME_ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** SHA-256 em hexadecimal minúsculo (formato do `iconSha`). */
const GAME_ICON_SHA_PATTERN = /^[a-f0-9]{64}$/

/** Origem do ícone persistida no store. */
type StoredIconOrigin = NonNullable<StoredGame['iconOrigin']>

const GAME_ICON_ORIGINS: StoredIconOrigin[] = ['manual', 'derived', 'legacy']

/** Valida/normaliza uma entrada de app vinda do renderer ou do localStorage. */
export function normalizeAppConfig(input: unknown): StoredAppConfig | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const command = typeof raw.command === 'string' ? raw.command : ''
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : ''
  if (!id || !command) return null

  const category = APP_CATEGORIES.includes(raw.category as (typeof APP_CATEGORIES)[number])
    ? (raw.category as StoredAppConfig['category'])
    : 'dev'

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === 'string')
    : []

  const normalized: StoredAppConfig = {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : id,
    description: typeof raw.description === 'string' ? raw.description : '',
    icon: typeof raw.icon === 'string' ? raw.icon : '📦',
    color: typeof raw.color === 'string' ? raw.color : '#8B5CF6',
    gradient: typeof raw.gradient === 'string' ? raw.gradient : 'from-violet-500 to-fuchsia-500',
    command,
    cwd,
    category,
    tags
  }

  if (typeof raw.url === 'string' && raw.url) normalized.url = raw.url
  if (typeof raw.useShell === 'boolean') normalized.useShell = raw.useShell
  if (typeof raw.autoRestart === 'boolean') normalized.autoRestart = raw.autoRestart
  if (typeof raw.persistLogs === 'boolean') normalized.persistLogs = raw.persistLogs
  return normalized
}

export function normalizeAppConfigs(input: unknown): StoredAppConfig[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: StoredAppConfig[] = []
  for (const item of input) {
    const app = normalizeAppConfig(item)
    if (app && !seen.has(app.id)) {
      seen.add(app.id)
      out.push(app)
    }
  }
  return out
}

export function normalizeStartupImportance(input: unknown): Record<string, ImportanceLevelName> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, ImportanceLevelName> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && IMPORTANCE_LEVELS.includes(value as ImportanceLevelName)) {
      out[key] = value as ImportanceLevelName
    }
  }
  return out
}

/** Limites das coleções de jogos (chave `gameCollections` e campo `collections`). */
export const MAX_GAME_COLLECTIONS = 30
export const MAX_GAME_COLLECTION_TAGS = 8
export const MAX_COLLECTION_NAME_LENGTH = 24
/** Quantos dias de tempo de jogo são preservados em `playtimeDays`. */
export const MAX_PLAYTIME_DAYS = 60

/** Nome de coleção válido (trim, 1–24 chars) ou null. */
function normalizeCollectionName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > MAX_COLLECTION_NAME_LENGTH) return null
  return name
}

/**
 * Normaliza uma lista de nomes de coleção: descarta inválidos, faz trim,
 * deduplica sem diferenciar caixa (preserva a grafia da primeira ocorrência)
 * e aplica o cap pedido. Default = cap da chave `gameCollections`.
 */
export function normalizeGameCollections(
  input: unknown,
  limit: number = MAX_GAME_COLLECTIONS
): string[] {
  if (!Array.isArray(input)) return []
  const max =
    Number.isInteger(limit) && limit > 0
      ? Math.min(limit, MAX_GAME_COLLECTIONS)
      : MAX_GAME_COLLECTIONS
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of input) {
    const name = normalizeCollectionName(item)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= max) break
  }
  return out
}

/** Segundos de tempo de jogo válidos (inteiro ≥ 0) ou null. */
function normalizePlaytimeSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.floor(value)
}

/**
 * Normaliza o mapa de tempo por dia local. Só chaves `YYYY-MM-DD` com valores
 * positivos entram; os 60 dias mais recentes são preservados.
 */
export function normalizePlaytimeDays(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const entries: Array<[string, number]> = []
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue
    const seconds = normalizePlaytimeSeconds(value)
    if (seconds === null || seconds <= 0) continue
    entries.push([key, seconds])
  }
  entries.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
  const out: Record<string, number> = {}
  for (const [key, seconds] of entries.slice(0, MAX_PLAYTIME_DAYS)) out[key] = seconds
  return out
}

/** ISO timestamp válido (string não vazia, ≤ 40 chars, parseável) ou null. */
function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 40) return null
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed
}

/**
 * Valida/normaliza uma entrada de jogo vinda do renderer/devtools ou do disco.
 * Descarta entradas sem id/name/exePath; entradas inválidas nunca derrubam a lista.
 */
export function normalizeGame(input: unknown): StoredGame | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const exePath = typeof raw.exePath === 'string' ? raw.exePath.trim() : ''
  if (!id || !name || !exePath) return null

  const origin = GAME_ORIGINS.includes(raw.origin as GameOrigin)
    ? (raw.origin as GameOrigin)
    : 'custom'

  const iconPath =
    typeof raw.iconPath === 'string' && raw.iconPath.trim() ? raw.iconPath.trim() : null

  let steamAppId: number | undefined
  if (
    typeof raw.steamAppId === 'number' &&
    Number.isInteger(raw.steamAppId) &&
    raw.steamAppId >= 0
  ) {
    steamAppId = raw.steamAppId
  }

  const addedAt =
    typeof raw.addedAt === 'string' && raw.addedAt.trim()
      ? raw.addedAt.trim()
      : new Date().toISOString()

  const game: StoredGame = { id, name, exePath, iconPath, origin, addedAt }
  if (steamAppId !== undefined) game.steamAppId = steamAppId
  if (typeof raw.favorite === 'boolean') game.favorite = raw.favorite

  const collections = normalizeGameCollections(raw.collections, MAX_GAME_COLLECTION_TAGS)
  if (collections.length > 0) game.collections = collections

  const playtimeSeconds = normalizePlaytimeSeconds(raw.playtimeSeconds)
  if (playtimeSeconds !== null) game.playtimeSeconds = playtimeSeconds

  const playtimeDays = normalizePlaytimeDays(raw.playtimeDays)
  if (Object.keys(playtimeDays).length > 0) game.playtimeDays = playtimeDays

  const lastPlayedAt = normalizeIsoTimestamp(raw.lastPlayedAt)
  if (lastPlayedAt) game.lastPlayedAt = lastPlayedAt

  const coverPath =
    typeof raw.coverPath === 'string' && raw.coverPath.trim() ? raw.coverPath.trim() : null
  if (coverPath) game.coverPath = coverPath

  // Identidade do ícone no cofre: sha e extensão só valem juntos (um sem o outro
  // não permite rematerializar). A origem é preservada isoladamente.
  const iconSha =
    typeof raw.iconSha === 'string' && GAME_ICON_SHA_PATTERN.test(raw.iconSha.trim())
      ? raw.iconSha.trim()
      : null
  const rawIconExt = typeof raw.iconExt === 'string' ? raw.iconExt.trim().toLowerCase() : ''
  const iconExt = GAME_ICON_EXTENSIONS.has(rawIconExt) ? rawIconExt : null
  if (iconSha && iconExt) {
    game.iconSha = iconSha
    game.iconExt = iconExt
  }
  if (GAME_ICON_ORIGINS.includes(raw.iconOrigin as StoredIconOrigin)) {
    game.iconOrigin = raw.iconOrigin as StoredIconOrigin
  }
  return game
}

/**
 * Normaliza a lista de jogos: descarta inválidos e deduplica por `id`,
 * por `steamAppId` e por `exePath` (comparação case-insensitive — Windows).
 * São dezenas de jogos no máximo; sem preocupação de performance.
 */
export function normalizeGames(input: unknown): StoredGame[] {
  if (!Array.isArray(input)) return []
  const seenIds = new Set<string>()
  const seenSteamIds = new Set<number>()
  const seenExePaths = new Set<string>()
  const out: StoredGame[] = []
  for (const item of input) {
    const game = normalizeGame(item)
    if (!game) continue
    const exeKey = game.exePath.toLowerCase()
    if (seenIds.has(game.id)) continue
    if (game.steamAppId !== undefined && seenSteamIds.has(game.steamAppId)) continue
    if (seenExePaths.has(exeKey)) continue
    seenIds.add(game.id)
    if (game.steamAppId !== undefined) seenSteamIds.add(game.steamAppId)
    seenExePaths.add(exeKey)
    out.push(game)
  }
  return out
}

/** Coage um índice de botão para inteiro no intervalo 0–15 (16 = Guide/Home, proibido). */
function normalizeButtonIndex(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN
  if (!Number.isFinite(n)) return null
  const truncated = Math.trunc(n)
  if (truncated < 0 || truncated > 15) return null
  return truncated
}

/**
 * Valida/normaliza a configuração de controle do Big Picture vinda do
 * renderer/devtools ou do disco. Qualquer inconsistência → null (o gate de
 * primeira execução trata null como "não configurado"). O índice 16
 * (Guide/Home) é rejeitado de propósito — muitos drivers o capturam.
 */
export function normalizeGamepadConfig(input: unknown): GamepadConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const profile = GAMEPAD_PROFILES.includes(raw.profile as GamepadProfile)
    ? (raw.profile as GamepadProfile)
    : null
  if (!profile) return null

  const controllerId = typeof raw.controllerId === 'string' ? raw.controllerId.trim() : ''
  const controllerName = typeof raw.controllerName === 'string' ? raw.controllerName.trim() : ''
  const configuredAt = typeof raw.configuredAt === 'string' ? raw.configuredAt.trim() : ''
  if (!controllerId || !controllerName || !configuredAt) return null
  if (typeof raw.autoMapped !== 'boolean') return null

  if (!raw.mapping || typeof raw.mapping !== 'object' || Array.isArray(raw.mapping)) return null
  const rawMapping = raw.mapping as Record<string, unknown>
  const mapping = {} as GamepadButtonMapping
  for (const action of GAMEPAD_ACTIONS) {
    const rawValue = rawMapping[action]
    if (rawValue === undefined) return null // ação ausente = config incompleta (rejeita)
    // `null` explícito = "sem botão" (fluxo de conflito do ajuste manual) — permitido.
    if (rawValue === null) {
      mapping[action] = null
      continue
    }
    const index = normalizeButtonIndex(rawValue)
    if (index === null) return null
    mapping[action] = index
  }

  const config: GamepadConfig = {
    profile,
    controllerId,
    controllerName,
    mapping,
    autoMapped: raw.autoMapped,
    configuredAt
  }

  if (typeof raw.vendorId === 'string' && raw.vendorId.trim()) config.vendorId = raw.vendorId.trim()
  if (typeof raw.productId === 'string' && raw.productId.trim())
    config.productId = raw.productId.trim()

  return config
}

/**
 * Chave canônica para comparar duas configs ignorando `configuredAt`.
 * Usada para não regravar `configuredAt` quando nada mudou de verdade
 * (evita churn no config.json a cada salvamento idêntico).
 */
function gamepadConfigFingerprint(config: GamepadConfig): string {
  const mapping: Record<string, number | null> = {}
  for (const action of GAMEPAD_ACTIONS) mapping[action] = config.mapping[action]
  return JSON.stringify({
    profile: config.profile,
    controllerId: config.controllerId,
    controllerName: config.controllerName,
    vendorId: config.vendorId ?? null,
    productId: config.productId ?? null,
    mapping,
    autoMapped: config.autoMapped
  })
}

/** Normaliza as preferências do Big Picture; qualquer inconsistência cai no default `{ sounds: true }`. */
export function normalizeBigPicturePrefs(input: unknown): BigPicturePrefs {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const sounds = (input as Record<string, unknown>).sounds
    if (typeof sounds === 'boolean') return { sounds }
  }
  return { sounds: true }
}

/**
 * Normaliza a configuração da sobreposição (HUD).
 *
 * Atalho inválido (string vazia, formato desconhecido, sem modificador) volta
 * ao default — o app nunca arranca com um accelerator que o Electron
 * rejeitaria no registro. `visible` só é `true` quando booleano verdadeiro;
 * largura/escala inválidas caem no padrão (300 px / `normal`).
 */
export function normalizeHudConfig(input: unknown): HudConfig {
  const raw =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  return {
    shortcut: normalizeAccelerator(raw.shortcut) ?? HUD_DEFAULT_SHORTCUT,
    visible: raw.visible === true,
    width: normalizeHudWidth(raw.width),
    scale: normalizeHudScale(raw.scale)
  }
}

/** Teto do histórico local: 20 execuções bastam para comparar tendências. */
const MAX_BENCHMARK_HISTORY = 20
const MAX_BENCHMARK_TEXT = 200
const MAX_BENCHMARK_ID = 64

/** Número finito e não negativo; qualquer outro valor → null (entrada inválida). */
function readBenchmarkNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

/**
 * Valida/normaliza a nota de uma carga. Entrada inválida → null (é descartada
 * da lista de testes, nunca derruba o histórico inteiro).
 */
export function normalizeBenchmarkTestScore(input: unknown): BenchmarkTestScore | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, MAX_BENCHMARK_ID) : ''
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, MAX_BENCHMARK_TEXT) : ''
  if (!id || !label) return null
  const single = readBenchmarkNumber(raw.single)
  const multi = readBenchmarkNumber(raw.multi)
  if (single === null || multi === null) return null
  return { id, label, single, multi }
}

/**
 * Valida/normaliza uma execução do histórico vinda do disco ou do IPC.
 * `tests` inválido vira `[]`; números não finitos/negativos descartam a
 * entrada; strings longas são cortadas para não inflar o config.json.
 */
export function normalizeBenchmarkEntry(input: unknown): BenchmarkEntry | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>

  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, MAX_BENCHMARK_ID) : ''
  const at = typeof raw.at === 'string' ? raw.at.trim().slice(0, MAX_BENCHMARK_TEXT) : ''
  const model = typeof raw.model === 'string' ? raw.model.trim().slice(0, MAX_BENCHMARK_TEXT) : ''
  if (!id || !at || !model) return null

  const single = readBenchmarkNumber(raw.single)
  const multi = readBenchmarkNumber(raw.multi)
  const ratio = readBenchmarkNumber(raw.ratio)
  const cores = readBenchmarkNumber(raw.cores)
  if (single === null || multi === null || ratio === null || cores === null) return null

  const tests = Array.isArray(raw.tests)
    ? raw.tests
        .map(normalizeBenchmarkTestScore)
        .filter((test): test is BenchmarkTestScore => test !== null)
    : []

  return { id, at, single, multi, ratio, cores: Math.trunc(cores), model, tests }
}

/** Normaliza a lista do histórico, deduplicando por id e aplicando o cap de 20. */
export function normalizeBenchmarkHistory(input: unknown): BenchmarkEntry[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: BenchmarkEntry[] = []
  for (const item of input) {
    const entry = normalizeBenchmarkEntry(item)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
    if (out.length >= MAX_BENCHMARK_HISTORY) break
  }
  return out
}

const schema: Store.Schema<HubStoreSchema> = {
  apps: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      required: ['id', 'command', 'cwd', 'category'],
      additionalProperties: true,
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string' },
        description: { type: 'string' },
        icon: { type: 'string' },
        color: { type: 'string' },
        gradient: { type: 'string' },
        command: { type: 'string', minLength: 1 },
        cwd: { type: 'string' },
        category: { type: 'string', enum: [...APP_CATEGORIES] },
        tags: { type: 'array', items: { type: 'string' } },
        url: { type: 'string' },
        useShell: { type: 'boolean' },
        autoRestart: { type: 'boolean' },
        persistLogs: { type: 'boolean' }
      }
    }
  },
  startupImportance: {
    type: 'object',
    default: {},
    additionalProperties: { type: 'string', enum: [...IMPORTANCE_LEVELS] }
  },
  games: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      required: ['id', 'name', 'exePath', 'origin', 'addedAt'],
      additionalProperties: true,
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1 },
        exePath: { type: 'string', minLength: 1 },
        iconPath: { type: ['string', 'null'] },
        iconSha: { type: 'string' },
        iconExt: { type: 'string' },
        iconOrigin: { type: 'string', enum: ['manual', 'derived', 'legacy'] },
        origin: { enum: ['steam', 'epic', 'minecraft', 'custom'] },
        steamAppId: { type: 'number' },
        addedAt: { type: 'string' },
        favorite: { type: 'boolean' },
        collections: { type: 'array', items: { type: 'string' } },
        playtimeSeconds: { type: 'number' },
        playtimeDays: { type: 'object', additionalProperties: { type: 'number' } },
        lastPlayedAt: { type: 'string' },
        coverPath: { type: ['string', 'null'] }
      }
    }
  },
  // Coleções da Biblioteca. Sem migração: chave nova com default [] (o ajv
  // preenche nas instalações antigas); o conteúdo é revalidado por
  // normalizeGameCollections() na leitura/escrita.
  gameCollections: {
    type: 'array',
    default: [],
    items: { type: 'string' }
  },
  launchKloudOnStart: {
    type: 'boolean',
    default: false
  },
  // Default true (opt-out, 07-7.2): chaves novas com default no schema não
  // exigem migração — o ajv preenche o valor nas instalações antigas.
  notifyOnCrash: {
    type: 'boolean',
    default: true
  },
  // Objeto livre de propósito — o conteúdo é validado por normalizeGamepadConfig().
  // `type: ['object', 'null']` é obrigatório: um `type: 'object'` simples quebra
  // a leitura quando o valor é null.
  gamepad: {
    type: ['object', 'null'],
    default: null
  },
  bigPicture: {
    type: 'object',
    default: { sounds: true },
    properties: {
      sounds: { type: 'boolean' }
    }
  },
  // Histórico local do benchmark (fonte de verdade da comparação "melhor
  // resultado nesta máquina"). O conteúdo é normalizado no getter/setter.
  benchmarkHistory: {
    type: 'array',
    default: [],
    items: {
      type: 'object',
      required: ['id', 'at', 'single', 'multi', 'ratio', 'cores', 'model'],
      additionalProperties: true,
      properties: {
        id: { type: 'string', minLength: 1 },
        at: { type: 'string' },
        single: { type: 'number' },
        multi: { type: 'number' },
        ratio: { type: 'number' },
        cores: { type: 'number' },
        model: { type: 'string' },
        tests: { type: 'array' }
      }
    }
  },
  // Sobreposição (HUD). O accelerator é revalidado por normalizeHudConfig() na
  // leitura/migração; o schema só garante os tipos básicos. A altura não é
  // persistida: é medida pelo overlay a cada exibição.
  hud: {
    type: 'object',
    default: {
      shortcut: HUD_DEFAULT_SHORTCUT,
      visible: false,
      width: HUD_DEFAULT_WIDTH,
      scale: HUD_DEFAULT_SCALE
    },
    properties: {
      shortcut: { type: 'string' },
      visible: { type: 'boolean' },
      width: { type: 'number' },
      scale: { type: 'string' }
    },
    additionalProperties: false
  },
  // Acesso remoto: só o último IP público consultado (ação explícita). O
  // conteúdo é revalidado por normalizeRemoteAccessPrefs() na leitura/escrita.
  remoteAccess: {
    type: 'object',
    default: { mode: false, lastPublicIp: null, lastPublicIpCheckedAt: null },
    properties: {
      mode: { type: 'boolean' },
      lastPublicIp: { type: ['string', 'null'] },
      lastPublicIpCheckedAt: { type: ['string', 'null'] }
    },
    additionalProperties: false
  },
  // Chave nova com default: o ajv preenche nas instalações antigas (não exige
  // migração). Ver GAME_ICON_PIPELINE_VERSION em games/icons.ts.
  gameIconsVersion: {
    type: 'number',
    default: 0,
    minimum: 0
  },
  // Intervalo do polling do monitor (padrão 0,5 s). Sem `minimum`/`maximum` de
  // propósito: o ajv valida na criação do store e um valor editado à mão fora
  // da faixa derrubaria a criação do arquivo inteiro. A faixa é aplicada por
  // normalizeHwmonIntervalMs() na leitura e na escrita.
  hwmonIntervalMs: {
    type: 'number',
    default: HWMON_INTERVAL_DEFAULT_MS
  }
}

// Wrapper tipado para o resto do main process não precisar conhecer o ajv.
// Se a construção falhar (arquivo corrompido/sem permissão), degrade para
// `null`: todo GET retorna "vazio" e todo SET reporta erro, e o renderer
// cai de volta no fallback localStorage — o app nunca quebra por causa disso.

/** Diretório do store no E2E (`KOLDND_HUB_TEST_USERDATA` absoluto). */
function testStoreDir(): string | undefined {
  const dir = process.env.KOLDND_HUB_TEST_USERDATA
  return dir && isAbsolute(dir) ? dir : undefined
}

function createStore(): Store<HubStoreSchema> | null {
  try {
    return new Store<HubStoreSchema>({
      name: 'config',
      // E2E: `KOLDND_HUB_TEST_USERDATA` isola o config.json no diretório do
      // teste. O store é criado na avaliação dos imports — ANTES do
      // `app.setPath('userData')` do index — então o caminho precisa ser
      // passado explicitamente aqui; sem a env var nada muda.
      cwd: testStoreDir(),
      schema,
      // Migração versionada formal: o conf guarda `__internal__.migrations.version`
      // no próprio arquivo e roda, em ordem, as chaves ≤ projectVersion que ainda
      // não foram aplicadas. 1.0.0 é a baseline; 1.1.0 normaliza apps antigos
      // (campos faltantes, useShell) no arquivo; 1.2.0 garante a chave `games`;
      // 1.3.0 garante o default da chave `launchKloudOnStart`;
      // 1.4.0 garante os defaults de `gamepad` (null) e `bigPicture` ({ sounds: true });
      // 1.5.0 garante a chave `benchmarkHistory` (lista normalizada, cap 20);
      // 1.6.0 garante a chave `hud` (atalho padrão e visibilidade desligada).
      // 1.7.0 acrescenta as preferências de tamanho do HUD (`width`/`scale`).
      // 1.8.0 garante a chave `remoteAccess` (último IP público consultado).
      // 1.9.0 acrescenta `mode` ao `remoteAccess` (modo remoto do Kloud Games).
      // 1.10.0 existiu para as chaves do OpenOffice, recurso removido.
      // `notifyOnCrash` (07-7.2) entra só pelo default do schema — sem migração.
      migrations: {
        '1.0.0': (): void => {
          // Baseline — nada a fazer; as chaves já têm defaults pelo schema.
        },
        '1.1.0': (s): void => {
          try {
            s.set('apps', normalizeAppConfigs(s.get('apps')))
            s.set('startupImportance', normalizeStartupImportance(s.get('startupImportance')))
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.2.0': (s): void => {
          try {
            s.set('games', normalizeGames(s.get('games')))
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.3.0': (s): void => {
          try {
            s.set('launchKloudOnStart', s.get('launchKloudOnStart', false) === true)
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.4.0': (s): void => {
          try {
            // Garante a chave `gamepad` (null = não configurado). Um valor
            // presente mas inválido volta a null — nunca derruba a leitura.
            s.set('gamepad', normalizeGamepadConfig(s.get('gamepad', null)))
            // Garante a chave `bigPicture` com `{ sounds: true }` como default.
            s.set('bigPicture', normalizeBigPicturePrefs(s.get('bigPicture', { sounds: true })))
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.5.0': (s): void => {
          try {
            // Garante a chave `benchmarkHistory` (lista normalizada, cap 20).
            s.set('benchmarkHistory', normalizeBenchmarkHistory(s.get('benchmarkHistory', [])))
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.6.0': (s): void => {
          try {
            // Garante a chave `hud` (atalho inválido → default; visible boolean).
            s.set('hud', normalizeHudConfig(s.get('hud', defaultHudConfig())))
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.7.0': (s): void => {
          try {
            // Largura (180–560, passo 10) e escala (`compacta|normal|grande`).
            // Atalho/visibilidade existentes são preservados pela normalização.
            s.set('hud', normalizeHudConfig(s.get('hud', defaultHudConfig())))
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.8.0': (s): void => {
          try {
            // Chave nova do acesso remoto (null/`{...}`); não toca no resto.
            s.set(
              'remoteAccess',
              normalizeRemoteAccessPrefs(s.get('remoteAccess', defaultRemoteAccessPrefs()))
            )
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.9.0': (s): void => {
          try {
            // `mode` novo (default false) sem perder o último IP consultado.
            s.set(
              'remoteAccess',
              normalizeRemoteAccessPrefs(s.get('remoteAccess', defaultRemoteAccessPrefs()))
            )
          } catch {
            // Arquivo inconsistente — o schema cuida dos defaults na leitura/escrita.
          }
        },
        '1.10.0': (): void => {
          // No-op: a migração original só normalizava as chaves do OpenOffice,
          // recurso removido do Hub. Mantida para não abrir buraco na cadeia.
        }
      }
    })
  } catch (err) {
    logger.error(
      'store',
      'config.json inválido ou inacessível — modo fallback (localStorage):',
      err
    )
    return null
  }
}

const store = createStore()

/**
 * `true` quando o electron-store foi aberto (config.json legível).
 * IPC de importação usa isto para abortar antes de qualquer escrita
 * quando o app está no modo fallback (localStorage).
 */
export function isStoreAvailable(): boolean {
  return store !== null
}

export interface HubConfigSnapshot {
  apps: StoredAppConfig[] | null
  startupImportance: Record<string, ImportanceLevelName> | null
}

/** Lê a config persistida. Retorna null nas chaves ausentes/vazias. */
export function getConfigSnapshot(): HubConfigSnapshot {
  if (!store) return { apps: null, startupImportance: null }
  try {
    const apps = store.get('apps', [])
    const importance = store.get('startupImportance', {})
    return {
      // Lista vazia = nunca migrado/salvo — o renderer deve cair no fallback localStorage.
      apps: apps.length > 0 ? apps : null,
      startupImportance: Object.keys(importance).length > 0 ? importance : null
    }
  } catch (err) {
    logger.error('store', 'Falha ao ler config.json:', err)
    return { apps: null, startupImportance: null }
  }
}

export function setApps(apps: unknown): { success: boolean; error?: string } {
  const normalized = normalizeAppConfigs(apps)
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('apps', normalized)
    logger.info('store', `${normalized.length} app(s) salvos em config.json`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar apps:', message)
    return { success: false, error: message }
  }
}

export function setStartupImportance(importance: unknown): { success: boolean; error?: string } {
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('startupImportance', normalizeStartupImportance(importance))
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar startupImportance:', message)
    return { success: false, error: message }
  }
}

/**
 * Migração via IPC do legado localStorage → electron-store.
 * Só grava chaves enviadas pelo renderer (o que existia no localStorage);
 * chaves ausentes ficam como estão no store.
 */
export function migrateFromLegacy(input: { apps?: unknown; startupImportance?: unknown }): {
  success: boolean
  error?: string
} {
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    if (input.apps !== undefined) {
      store.set('apps', normalizeAppConfigs(input.apps))
    }
    if (input.startupImportance !== undefined) {
      store.set('startupImportance', normalizeStartupImportance(input.startupImportance))
    }
    logger.info(
      'store',
      `Migração localStorage→electron-store concluída ` +
        `(apps: ${input.apps !== undefined ? 'sim' : 'não'}, ` +
        `importance: ${input.startupImportance !== undefined ? 'sim' : 'não'})`
    )
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Migração falhou:', message)
    return { success: false, error: message }
  }
}

/** Lê a lista de jogos persistida (sempre normalizada; [] quando indisponível). */
export function getStoredGames(): StoredGame[] {
  if (!store) return []
  try {
    return normalizeGames(store.get('games', []))
  } catch (err) {
    logger.error('store', 'Falha ao ler games:', err)
    return []
  }
}

/** Normaliza e persiste a lista de jogos. */
export function setStoredGames(games: unknown): { success: boolean; error?: string } {
  const normalized = normalizeGames(games)
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('games', normalized)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar games:', message)
    return { success: false, error: message }
  }
}

/** Lê as coleções de jogos persistidas (sempre normalizadas; [] quando indisponível). */
export function getGameCollections(): string[] {
  if (!store) return []
  try {
    return normalizeGameCollections(store.get('gameCollections', []))
  } catch (err) {
    logger.error('store', 'Falha ao ler gameCollections:', err)
    return []
  }
}

/** Normaliza e persiste a lista de coleções da Biblioteca (cap 30). */
export function setGameCollections(input: unknown): { success: boolean; error?: string } {
  const normalized = normalizeGameCollections(input)
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('gameCollections', normalized)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar gameCollections:', message)
    return { success: false, error: message }
  }
}

/**
 * Versão do pipeline de extração de ícones já aplicada aos arquivos em
 * `game-icons/` (0 = nunca reparado). Ver `games/icons.ts`.
 */
export function getGameIconsVersion(): number {
  if (!store) return 0
  try {
    const value = store.get('gameIconsVersion', 0)
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
  } catch (err) {
    logger.error('store', 'Falha ao ler gameIconsVersion:', err)
    return 0
  }
}

/** Persiste a versão do pipeline de ícones já aplicada. */
export function setGameIconsVersion(value: unknown): { success: boolean; error?: string } {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { success: false, error: 'Versão de ícones inválida.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('gameIconsVersion', value)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar gameIconsVersion:', message)
    return { success: false, error: message }
  }
}

/** Lê a preferência "iniciar o Kloud Games junto com o Hub" (default false). */
export function getLaunchKloudOnStart(): boolean {
  if (!store) return false
  try {
    return store.get('launchKloudOnStart', false) === true
  } catch (err) {
    logger.error('store', 'Falha ao ler launchKloudOnStart:', err)
    return false
  }
}

/** Persiste a preferência "iniciar o Kloud Games junto com o Hub". */
export function setLaunchKloudOnStart(value: unknown): { success: boolean; error?: string } {
  if (typeof value !== 'boolean') {
    return { success: false, error: 'Valor inválido para a preferência.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('launchKloudOnStart', value)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar launchKloudOnStart:', message)
    return { success: false, error: message }
  }
}

/** Lê a preferência "notificar quando um programa parar inesperadamente" (default true, opt-out). */
export function getNotifyOnCrash(): boolean {
  if (!store) return true
  try {
    const value = store.get('notifyOnCrash', true)
    return typeof value === 'boolean' ? value : true
  } catch (err) {
    logger.error('store', 'Falha ao ler notifyOnCrash:', err)
    return true
  }
}

/** Persiste a preferência "notificar quando um programa parar inesperadamente". */
export function setNotifyOnCrash(value: unknown): { success: boolean; error?: string } {
  if (typeof value !== 'boolean') {
    return { success: false, error: 'Valor inválido para a preferência.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('notifyOnCrash', value)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar notifyOnCrash:', message)
    return { success: false, error: message }
  }
}

/** Lê a configuração de controle do Big Picture (null = não configurado/inválida). */
export function getGamepadConfig(): GamepadConfig | null {
  if (!store) return null
  try {
    return normalizeGamepadConfig(store.get('gamepad', null))
  } catch (err) {
    logger.error('store', 'Falha ao ler gamepad:', err)
    return null
  }
}

/**
 * Normaliza e persiste a configuração de controle.
 * Config inválida → `{ success: false }` sem gravar nada.
 * Se o restante da config for idêntico à atual, `configuredAt` é preservado
 * (evita churn no config.json a cada salvamento igual).
 */
export function setGamepadConfig(input: unknown): { success: boolean; error?: string } {
  const config = normalizeGamepadConfig(input)
  if (!config) {
    return {
      success: false,
      error: 'Configuração de controle inválida (perfil, mapeamento ou índice de botão 0–15).'
    }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    const current = getGamepadConfig()
    if (current && gamepadConfigFingerprint(current) === gamepadConfigFingerprint(config)) {
      config.configuredAt = current.configuredAt
    }
    store.set('gamepad', config)
    logger.info(
      'store',
      `Controle configurado salvo: ${config.controllerName} (perfil ${config.profile})`
    )
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar gamepad:', message)
    return { success: false, error: message }
  }
}

/** Apaga a chave `gamepad` (volta a null = não configurado). */
export function resetGamepadConfig(): { success: boolean; error?: string } {
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.delete('gamepad')
    logger.info('store', 'Configuração de controle apagada')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao apagar gamepad:', message)
    return { success: false, error: message }
  }
}

/** Lê as preferências do Big Picture (default `{ sounds: true }`). */
export function getBigPicturePrefs(): BigPicturePrefs {
  if (!store) return { sounds: true }
  try {
    return normalizeBigPicturePrefs(store.get('bigPicture', { sounds: true }))
  } catch (err) {
    logger.error('store', 'Falha ao ler bigPicture:', err)
    return { sounds: true }
  }
}

/** Persiste as preferências do Big Picture. Apenas `sounds` (boolean) é aceito. */
export function setBigPicturePrefs(input: unknown): { success: boolean; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, error: 'Preferências inválidas.' }
  }
  const sounds = (input as Record<string, unknown>).sounds
  if (typeof sounds !== 'boolean') {
    return { success: false, error: 'Preferências inválidas: `sounds` deve ser booleano.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('bigPicture', { sounds })
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar bigPicture:', message)
    return { success: false, error: message }
  }
}

/** Lê o histórico do benchmark (sempre normalizado; [] quando indisponível). */
export function getBenchmarkHistory(): BenchmarkEntry[] {
  if (!store) return []
  try {
    return normalizeBenchmarkHistory(store.get('benchmarkHistory', []))
  } catch (err) {
    logger.error('store', 'Falha ao ler benchmarkHistory:', err)
    return []
  }
}

/**
 * Adiciona uma execução ao histórico (mais recente primeiro, cap 20).
 * Entrada inválida é ignorada sem quebrar — devolve `false` nesse caso.
 */
export function addBenchmarkEntry(input: unknown): boolean {
  const entry = normalizeBenchmarkEntry(input)
  if (!entry) return false
  if (!store) return false
  try {
    const current = getBenchmarkHistory()
    const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(
      0,
      MAX_BENCHMARK_HISTORY
    )
    store.set('benchmarkHistory', next)
    return true
  } catch (err) {
    logger.error('store', 'Falha ao salvar benchmarkHistory:', err)
    return false
  }
}

/** Apaga o histórico do benchmark (mantém a preferência de comparação vazia). */
export function clearBenchmarkHistory(): boolean {
  if (!store) return false
  try {
    store.set('benchmarkHistory', [])
    logger.info('store', 'histórico do benchmark apagado')
    return true
  } catch (err) {
    logger.error('store', 'Falha ao apagar benchmarkHistory:', err)
    return false
  }
}

/** Configuração padrão do HUD quando o store não está disponível. */
function defaultHudConfig(): HudConfig {
  return {
    shortcut: HUD_DEFAULT_SHORTCUT,
    visible: false,
    width: HUD_DEFAULT_WIDTH,
    scale: HUD_DEFAULT_SCALE
  }
}

/** Lê a configuração da sobreposição (sempre normalizada; defaults seguros). */
export function getHudConfig(): HudConfig {
  if (!store) return defaultHudConfig()
  try {
    return normalizeHudConfig(store.get('hud', defaultHudConfig()))
  } catch (err) {
    logger.error('store', 'Falha ao ler hud:', err)
    return defaultHudConfig()
  }
}

/**
 * Persiste o atalho da sobreposição.
 *
 * Diferente de `normalizeHudConfig`, aqui um atalho inválido é ERRO (não cai em
 * default): quem chama pelo IPC precisa saber que nada foi salvo.
 */
export function setHudShortcut(input: unknown): { success: boolean; error?: string } {
  const shortcut = normalizeAccelerator(input)
  if (!shortcut) {
    return { success: false, error: 'Atalho inválido. Use combinações como Ctrl+Alt+K.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    const current = getHudConfig()
    store.set('hud', { ...current, shortcut })
    logger.info('store', `atalho da sobreposição salvo: ${shortcut}`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar hud.shortcut:', message)
    return { success: false, error: message }
  }
}

/** Persiste se a sobreposição deve aparecer (reaberta ao iniciar o Hub). */
export function setHudVisible(value: unknown): { success: boolean; error?: string } {
  if (typeof value !== 'boolean') {
    return { success: false, error: 'Valor inválido para a visibilidade da sobreposição.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    const current = getHudConfig()
    store.set('hud', { ...current, visible: value })
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar hud.visible:', message)
    return { success: false, error: message }
  }
}

/**
 * Persiste largura e/ou escala do HUD. A largura é normalizada (múltiplo de 10
 * entre 180 e 560); tipo errado é ERRO, porque quem chamou pelo IPC precisa
 * saber que nada foi salvo. Atalho/visibilidade atuais nunca são perdidos.
 */
export function setHudSize(input: unknown): {
  success: boolean
  size?: HudSize
  error?: string
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { success: false, error: 'Requisição inválida.' }
  }
  const raw = input as Record<string, unknown>
  const hasWidth = raw.width !== undefined
  const hasScale = raw.scale !== undefined
  if (!hasWidth && !hasScale) {
    return { success: false, error: 'Informe a largura e/ou a escala do HUD.' }
  }
  if (hasWidth && (typeof raw.width !== 'number' || !Number.isFinite(raw.width))) {
    return { success: false, error: 'Largura inválida para a sobreposição.' }
  }
  if (hasScale && !isHudScale(raw.scale)) {
    return { success: false, error: 'Escala inválida para a sobreposição.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }

  const current = getHudConfig()
  const width = hasWidth ? normalizeHudWidth(raw.width) : current.width
  const scale: HudScale = hasScale ? normalizeHudScale(raw.scale) : current.scale
  try {
    store.set('hud', { ...current, width, scale })
    logger.info('store', `tamanho da sobreposição salvo: ${width}px · ${scale}`)
    return { success: true, size: { width, scale } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar hud.width/scale:', message)
    return { success: false, error: message }
  }
}

/**
 * Intervalo do polling do monitor de hardware (chave `hwmonIntervalMs`).
 *
 * Sempre normalizado: o arquivo pode ter sido editado à mão ou vir de uma
 * versão antiga sem a chave — nesses casos o monitor usa o default em vez de
 * falhar. O valor é o MESMO para a aba Monitor e o HUD (timer único).
 */
export function getHwmonIntervalMs(): number {
  if (!store) return HWMON_INTERVAL_DEFAULT_MS
  try {
    return normalizeHwmonIntervalMs(store.get('hwmonIntervalMs', HWMON_INTERVAL_DEFAULT_MS))
  } catch (err) {
    logger.error('store', 'Falha ao ler hwmonIntervalMs:', err)
    return HWMON_INTERVAL_DEFAULT_MS
  }
}

/**
 * Persiste o intervalo do polling do monitor.
 *
 * Tipo errado é ERRO (não cai em default silencioso): quem chama pelo IPC
 * precisa saber que nada foi salvo. Um número fora da faixa é normalizado
 * (clamp + passo) e é esse valor que volta para o renderer.
 */
export function setHwmonIntervalMs(input: unknown): {
  success: boolean
  intervalMs?: number
  error?: string
} {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return { success: false, error: 'Intervalo inválido para o monitor de hardware.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  const intervalMs = normalizeHwmonIntervalMs(input)
  try {
    store.set('hwmonIntervalMs', intervalMs)
    logger.info('store', `intervalo do monitor salvo: ${intervalMs} ms`)
    return { success: true, intervalMs }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar hwmonIntervalMs:', message)
    return { success: false, error: message }
  }
}

/**
 * Último IP público consultado (chave `remoteAccess`). Defaults seguros:
 * nunca consulta nada ao abrir — só devolve o que foi salvo por clique.
 */
export function getRemoteAccessPrefs(): RemoteAccessPrefs {
  if (!store) return defaultRemoteAccessPrefs()
  try {
    return normalizeRemoteAccessPrefs(store.get('remoteAccess', defaultRemoteAccessPrefs()))
  } catch (err) {
    logger.error('store', 'Falha ao ler remoteAccess:', err)
    return defaultRemoteAccessPrefs()
  }
}

/** Persiste o resultado da consulta explícita de IP público. */
export function setRemotePublicIp(
  ip: unknown,
  checkedAt: unknown
): { success: boolean; error?: string } {
  const address = normalizePublicIp(ip)
  if (!address) return { success: false, error: 'IP público inválido.' }
  const at =
    typeof checkedAt === 'string' && checkedAt.trim() && checkedAt.length <= 40
      ? checkedAt.trim()
      : new Date().toISOString()
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    const current = getRemoteAccessPrefs()
    store.set('remoteAccess', { ...current, lastPublicIp: address, lastPublicIpCheckedAt: at })
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar remoteAccess:', message)
    return { success: false, error: message }
  }
}

/** "Modo remoto" persistido (default false). */
export function getRemoteMode(): boolean {
  return getRemoteAccessPrefs().mode
}

/** Persiste o "Modo remoto" sem mexer no último IP público consultado. */
export function setRemoteMode(value: unknown): { success: boolean; error?: string } {
  if (typeof value !== 'boolean') {
    return { success: false, error: 'Valor inválido para o modo remoto.' }
  }
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    const current = getRemoteAccessPrefs()
    store.set('remoteAccess', { ...current, mode: value })
    logger.info('store', `modo remoto ${value ? 'ativado' : 'desativado'}`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', 'Falha ao salvar modo remoto:', message)
    return { success: false, error: message }
  }
}

/** Registra os canais IPC da configuração persistente. */
export function registerConfigIpc(): void {
  ipcMain.handle('config:get', () => getConfigSnapshot())

  ipcMain.handle('config:setApps', (_event, apps: unknown) => setApps(apps))

  ipcMain.handle('config:setStartupImportance', (_event, importance: unknown) =>
    setStartupImportance(importance)
  )

  ipcMain.handle(
    'config:migrate',
    (_event, payload: { apps?: unknown; startupImportance?: unknown }) =>
      migrateFromLegacy(payload ?? {})
  )
}

/**
 * Registra os canais IPC das preferências do Hub (tela de Configurações).
 * IPC próprio e mínimo, para não acoplar com a config de apps.
 */
export function registerPrefsIpc(): void {
  ipcMain.handle('prefs:get', () => getLaunchKloudOnStart())

  ipcMain.handle('prefs:set', (_event, value: unknown) => setLaunchKloudOnStart(value))

  ipcMain.handle('prefs:get-notify', () => getNotifyOnCrash())

  ipcMain.handle('prefs:set-notify', (_event, value: unknown) => setNotifyOnCrash(value))
}
