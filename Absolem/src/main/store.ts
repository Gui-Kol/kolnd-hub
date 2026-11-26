import Store from 'electron-store'
import { logger } from './logger'
import {
  OVERLAY_POSITIONS,
  STORE_KEYS,
  THEME_MODES,
  type AbsolemConfig,
  type GeminiConfig,
  type OverlayConfig,
  type PermissionsConfig,
  type PrivacyConfig,
  type StoreKey,
  type ThemeConfig,
  type UiConfig,
  type VoiceConfig
} from '../shared/config'

/**
 * Store persistente do Absolem (`%APPDATA%\absolem\config.json`).
 *
 * - O schema só valida tipos básicos de propósito: enum/faixa no ajv fariam um
 *   valor editado à mão derrubar a criação do arquivo inteiro. A faixa real é
 *   aplicada pelos normalizadores na leitura e na escrita.
 * - `projectVersion` é a versão do schema (1.1.0), independente da versão do
 *   app, para que as migrações rodem mesmo durante a fundação.
 * - Nenhum segredo mora aqui: a chave Gemini usa `safeStorage` (secrets.ts).
 */

export const STORE_SCHEMA_VERSION = '1.1.0'

const DEFAULT_ACCENT = '#3b82f6'
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'
const MAX_MODEL_LENGTH = 100
const MAX_DEVICE_ID_LENGTH = 200
const MAX_LANGUAGE_LENGTH = 20

export function defaultOverlayConfig(): OverlayConfig {
  return { enabled: false, position: 'bottom-left', scale: 1 }
}

export function defaultThemeConfig(): ThemeConfig {
  return { mode: 'dark', accent: DEFAULT_ACCENT }
}

export function defaultVoiceConfig(): VoiceConfig {
  return { enabled: false, inputDeviceId: null, outputVolume: 1 }
}

export function defaultGeminiConfig(): GeminiConfig {
  return { model: DEFAULT_GEMINI_MODEL, temperature: 0.7 }
}

export function defaultPrivacyConfig(): PrivacyConfig {
  return { telemetry: false, screenCapture: false }
}

export function defaultPermissionsConfig(): PermissionsConfig {
  return { microphone: false, screenVision: false, computerControl: false, fileAccess: false }
}

export function defaultUiConfig(): UiConfig {
  return { language: 'pt-BR', reducedMotion: false, startMinimized: false }
}

export function defaultAbsolemConfig(): AbsolemConfig {
  return {
    overlay: defaultOverlayConfig(),
    theme: defaultThemeConfig(),
    voice: defaultVoiceConfig(),
    gemini: defaultGeminiConfig(),
    privacy: defaultPrivacyConfig(),
    permissions: defaultPermissionsConfig(),
    ui: defaultUiConfig()
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_DEVICE_ID_LENGTH) return null
  return trimmed
}

export function normalizeOverlayConfig(input: unknown): OverlayConfig {
  const raw = asRecord(input)
  const position = OVERLAY_POSITIONS.includes(raw.position as (typeof OVERLAY_POSITIONS)[number])
    ? (raw.position as OverlayConfig['position'])
    : 'bottom-left'
  return {
    enabled: raw.enabled === true,
    position,
    scale: clampNumber(raw.scale, 0.5, 2, 1)
  }
}

export function normalizeThemeConfig(input: unknown): ThemeConfig {
  const raw = asRecord(input)
  const mode = THEME_MODES.includes(raw.mode as (typeof THEME_MODES)[number])
    ? (raw.mode as ThemeConfig['mode'])
    : 'dark'
  const accent =
    typeof raw.accent === 'string' && HEX_COLOR_RE.test(raw.accent.trim())
      ? raw.accent.trim()
      : DEFAULT_ACCENT
  return { mode, accent }
}

export function normalizeVoiceConfig(input: unknown): VoiceConfig {
  const raw = asRecord(input)
  return {
    enabled: raw.enabled === true,
    inputDeviceId: normalizeOptionalId(raw.inputDeviceId),
    outputVolume: clampNumber(raw.outputVolume, 0, 1, 1)
  }
}

export function normalizeGeminiConfig(input: unknown): GeminiConfig {
  const raw = asRecord(input)
  const model =
    typeof raw.model === 'string' && raw.model.trim()
      ? raw.model.trim().slice(0, MAX_MODEL_LENGTH)
      : DEFAULT_GEMINI_MODEL
  return {
    model,
    temperature: clampNumber(raw.temperature, 0, 2, 0.7)
  }
}

export function normalizePrivacyConfig(input: unknown): PrivacyConfig {
  const raw = asRecord(input)
  return {
    telemetry: raw.telemetry === true,
    screenCapture: raw.screenCapture === true
  }
}

export function normalizePermissionsConfig(input: unknown): PermissionsConfig {
  const raw = asRecord(input)
  return {
    microphone: raw.microphone === true,
    screenVision: raw.screenVision === true,
    computerControl: raw.computerControl === true,
    fileAccess: raw.fileAccess === true
  }
}

export function normalizeUiConfig(input: unknown): UiConfig {
  const raw = asRecord(input)
  const language =
    typeof raw.language === 'string' && raw.language.trim()
      ? raw.language.trim().slice(0, MAX_LANGUAGE_LENGTH)
      : 'pt-BR'
  return {
    language,
    reducedMotion: raw.reducedMotion === true,
    startMinimized: raw.startMinimized === true
  }
}

/** Normaliza o snapshot completo, campo a campo, sem descartar valores válidos. */
export function normalizeAbsolemConfig(input: unknown): AbsolemConfig {
  const raw = asRecord(input)
  return {
    overlay: normalizeOverlayConfig(raw.overlay),
    theme: normalizeThemeConfig(raw.theme),
    voice: normalizeVoiceConfig(raw.voice),
    gemini: normalizeGeminiConfig(raw.gemini),
    privacy: normalizePrivacyConfig(raw.privacy),
    permissions: normalizePermissionsConfig(raw.permissions),
    ui: normalizeUiConfig(raw.ui)
  }
}

/** Chave conhecida do store (valida `unknown` vindo de IPC). */
export function isStoreKey(value: unknown): value is StoreKey {
  return typeof value === 'string' && STORE_KEYS.includes(value as StoreKey)
}

/** Normaliza o valor de uma chave específica. */
export function normalizeStoreValue(key: StoreKey, value: unknown): AbsolemConfig[StoreKey] {
  switch (key) {
    case 'overlay':
      return normalizeOverlayConfig(value)
    case 'theme':
      return normalizeThemeConfig(value)
    case 'voice':
      return normalizeVoiceConfig(value)
    case 'gemini':
      return normalizeGeminiConfig(value)
    case 'privacy':
      return normalizePrivacyConfig(value)
    case 'permissions':
      return normalizePermissionsConfig(value)
    case 'ui':
      return normalizeUiConfig(value)
  }
}

const schema: Store.Schema<AbsolemConfig> = {
  overlay: {
    type: 'object',
    default: defaultOverlayConfig(),
    properties: {
      enabled: { type: 'boolean' },
      position: { type: 'string' },
      scale: { type: 'number' }
    },
    additionalProperties: false
  },
  theme: {
    type: 'object',
    default: defaultThemeConfig(),
    properties: {
      mode: { type: 'string' },
      accent: { type: 'string' }
    },
    additionalProperties: false
  },
  voice: {
    type: 'object',
    default: defaultVoiceConfig(),
    properties: {
      enabled: { type: 'boolean' },
      inputDeviceId: { type: ['string', 'null'] },
      outputVolume: { type: 'number' }
    },
    additionalProperties: false
  },
  gemini: {
    type: 'object',
    default: defaultGeminiConfig(),
    properties: {
      model: { type: 'string' },
      temperature: { type: 'number' }
    },
    additionalProperties: false
  },
  privacy: {
    type: 'object',
    default: defaultPrivacyConfig(),
    properties: {
      telemetry: { type: 'boolean' },
      screenCapture: { type: 'boolean' }
    },
    additionalProperties: false
  },
  permissions: {
    type: 'object',
    default: defaultPermissionsConfig(),
    properties: {
      microphone: { type: 'boolean' },
      screenVision: { type: 'boolean' },
      computerControl: { type: 'boolean' },
      fileAccess: { type: 'boolean' }
    },
    additionalProperties: false
  },
  ui: {
    type: 'object',
    default: defaultUiConfig(),
    properties: {
      language: { type: 'string' },
      reducedMotion: { type: 'boolean' },
      startMinimized: { type: 'boolean' }
    },
    additionalProperties: false
  }
}

/** Interface mínima usada pelos normalizadores de migração (testável sem Electron). */
export interface StoreLike {
  get<T>(key: string, defaultValue: T): T
  set(key: string, value: unknown): void
  delete(key: string): void
}

/** Baseline: nada a fazer; os defaults já vêm do schema. */
export function migrate100(_store: StoreLike): void {
  // Intencionalmente vazio: 1.0.0 é a baseline do formato atual.
}

/** 1.1.0: garante todas as chaves atuais, preservando valores válidos da 1.0.0. */
export function migrate110(store: StoreLike): void {
  store.set('overlay', normalizeOverlayConfig(store.get('overlay', defaultOverlayConfig())))
  store.set('theme', normalizeThemeConfig(store.get('theme', defaultThemeConfig())))
  store.set('voice', normalizeVoiceConfig(store.get('voice', defaultVoiceConfig())))
  store.set('gemini', normalizeGeminiConfig(store.get('gemini', defaultGeminiConfig())))
  store.set('privacy', normalizePrivacyConfig(store.get('privacy', defaultPrivacyConfig())))
  store.set(
    'permissions',
    normalizePermissionsConfig(store.get('permissions', defaultPermissionsConfig()))
  )
  store.set('ui', normalizeUiConfig(store.get('ui', defaultUiConfig())))
}

export const STORE_MIGRATIONS: Record<string, (store: StoreLike) => void> = {
  '1.0.0': migrate100,
  '1.1.0': migrate110
}

/** Store em memória: fallback quando o config.json está corrompido/inacessível. */
export function createMemoryStore(): StoreLike {
  const data = new Map<string, unknown>()
  return {
    get<T>(key: string, defaultValue: T): T {
      return data.has(key) ? (data.get(key) as T) : defaultValue
    },
    set(key: string, value: unknown): void {
      data.set(key, value)
    },
    delete(key: string): void {
      data.delete(key)
    }
  }
}

export interface CreatedStore {
  store: StoreLike
  persistent: boolean
}

/**
 * electron-store 8 aceita `projectVersion` em runtime (index.js lê a opção),
 * mas a tipagem da v8 o remove de `Options` (o `conf` usa a versão do app).
 * A interseção mantém a versão do schema explícita sem `any`.
 */
type AbsolemStoreOptions = Store.Options<AbsolemConfig> & { projectVersion: string }

/**
 * Abre o config.json. Falha vira store em memória e log `store`; o app nunca
 * deixa de abrir por causa da configuração.
 */
export function createAbsolemStore(): CreatedStore {
  try {
    const options: AbsolemStoreOptions = {
      name: 'config',
      projectVersion: STORE_SCHEMA_VERSION,
      schema,
      migrations: STORE_MIGRATIONS as unknown as Store.Options<AbsolemConfig>['migrations']
    }
    const store = new Store<AbsolemConfig>(options)
    return { store, persistent: true }
  } catch (err) {
    logger.error(
      'store',
      'config.json inválido ou inacessível; usando store em memória (não persistente):',
      err
    )
    return { store: createMemoryStore(), persistent: false }
  }
}

const created = createAbsolemStore()
const store = created.store

/** `true` quando o config.json foi aberto; `false` no fallback em memória. */
export function isStoreAvailable(): boolean {
  return created.persistent
}

/** Lê e normaliza todas as chaves. Nunca lança. */
export function getStoreSnapshot(): AbsolemConfig {
  try {
    return normalizeAbsolemConfig({
      overlay: store.get('overlay', defaultOverlayConfig()),
      theme: store.get('theme', defaultThemeConfig()),
      voice: store.get('voice', defaultVoiceConfig()),
      gemini: store.get('gemini', defaultGeminiConfig()),
      privacy: store.get('privacy', defaultPrivacyConfig()),
      permissions: store.get('permissions', defaultPermissionsConfig()),
      ui: store.get('ui', defaultUiConfig())
    })
  } catch (err) {
    logger.error('store', 'Falha ao ler config.json; usando defaults em memória:', err)
    return defaultAbsolemConfig()
  }
}

/** Lê uma chave já normalizada. */
export function getStoreValue(key: StoreKey): AbsolemConfig[StoreKey] {
  return getStoreSnapshot()[key]
}

/** Normaliza e persiste uma chave. Valor inválido nunca derruba o app. */
export function setStoreValue(key: StoreKey, value: unknown): { success: boolean; error?: string } {
  if (!isStoreKey(key)) {
    return { success: false, error: 'Chave de configuração desconhecida.' }
  }
  try {
    store.set(key, normalizeStoreValue(key, value))
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('store', `Falha ao salvar a chave ${key}:`, message)
    return { success: false, error: message }
  }
}
