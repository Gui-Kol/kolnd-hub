import Store from 'electron-store'
import { ipcMain } from 'electron'
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
export type {
  GamepadProfile,
  GamepadAction,
  GamepadButtonMapping,
  GamepadConfig
} from '../shared/gamepad'

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

export type GameOrigin = 'steam' | 'custom'

/** Jogo persistido na Biblioteca (electron-store, chave `games`). */
export interface StoredGame {
  id: string
  name: string
  exePath: string
  /** Caminho absoluto do ícone cacheado em `%APPDATA%/kolnd-hub/game-icons/`; null = sem ícone (fallback na UI). */
  iconPath: string | null
  origin: GameOrigin
  /** Presente apenas em jogos importados da Steam. */
  steamAppId?: number
  /** ISO timestamp de quando o jogo entrou na biblioteca. */
  addedAt: string
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
  /** Preferência: iniciar o Kloud Games junto com o Hub (default false). */
  launchKloudOnStart: boolean
  /** Preferência: notificar quando um programa gerenciado morrer inesperadamente (default true, opt-out). */
  notifyOnCrash: boolean
  /** Mapeamento de controle do modo Big Picture; null = nunca configurado. */
  gamepad: GamepadConfig | null
  /** Preferências do modo Big Picture (ex.: efeitos sonoros). */
  bigPicture: BigPicturePrefs
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

const APP_CATEGORIES = ['ai', 'gaming', 'streaming', 'dev'] as const
const IMPORTANCE_LEVELS: ImportanceLevelName[] = ['critico', 'recomendado', 'opcional', 'inutil']
const GAME_ORIGINS: GameOrigin[] = ['steam', 'custom']

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
        origin: { enum: ['steam', 'custom'] },
        steamAppId: { type: 'number' },
        addedAt: { type: 'string' }
      }
    }
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
  }
}

// Wrapper tipado para o resto do main process não precisar conhecer o ajv.
// Se a construção falhar (arquivo corrompido/sem permissão), degrade para
// `null`: todo GET retorna "vazio" e todo SET reporta erro, e o renderer
// cai de volta no fallback localStorage — o app nunca quebra por causa disso.
function createStore(): Store<HubStoreSchema> | null {
  try {
    return new Store<HubStoreSchema>({
      name: 'config',
      schema,
      // Migração versionada formal: o conf guarda `__internal__.migrations.version`
      // no próprio arquivo e roda, em ordem, as chaves ≤ projectVersion que ainda
      // não foram aplicadas. 1.0.0 é a baseline; 1.1.0 normaliza apps antigos
      // (campos faltantes, useShell) no arquivo; 1.2.0 garante a chave `games`;
      // 1.3.0 garante o default da chave `launchKloudOnStart`;
      // 1.4.0 garante os defaults de `gamepad` (null) e `bigPicture` ({ sounds: true }).
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
