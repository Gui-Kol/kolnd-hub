import Store from 'electron-store'
import { ipcMain } from 'electron'

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
}

export interface HubStoreSchema {
  apps: StoredAppConfig[]
  startupImportance: Record<string, ImportanceLevelName>
  games: StoredGame[]
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

  const origin = GAME_ORIGINS.includes(raw.origin as GameOrigin) ? (raw.origin as GameOrigin) : 'custom'

  const iconPath =
    typeof raw.iconPath === 'string' && raw.iconPath.trim() ? raw.iconPath.trim() : null

  let steamAppId: number | undefined
  if (typeof raw.steamAppId === 'number' && Number.isInteger(raw.steamAppId) && raw.steamAppId >= 0) {
    steamAppId = raw.steamAppId
  }

  const addedAt =
    typeof raw.addedAt === 'string' && raw.addedAt.trim() ? raw.addedAt.trim() : new Date().toISOString()

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
        useShell: { type: 'boolean' }
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
      // (campos faltantes, useShell) no arquivo; 1.2.0 garante a chave `games`.
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
        }
      }
    })
  } catch (err) {
    console.error(
      '[store] config.json inválido ou inacessível — modo fallback (localStorage):',
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
    console.error('[store] Falha ao ler config.json:', err)
    return { apps: null, startupImportance: null }
  }
}

export function setApps(apps: unknown): { success: boolean; error?: string } {
  const normalized = normalizeAppConfigs(apps)
  if (!store) return { success: false, error: 'Store persistente indisponível' }
  try {
    store.set('apps', normalized)
    console.log(`[store] ${normalized.length} app(s) salvos em config.json`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[store] Falha ao salvar apps:', message)
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
    console.error('[store] Falha ao salvar startupImportance:', message)
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
    console.log(
      `[store] Migração localStorage→electron-store concluída ` +
        `(apps: ${input.apps !== undefined ? 'sim' : 'não'}, ` +
        `importance: ${input.startupImportance !== undefined ? 'sim' : 'não'})`
    )
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[store] Migração falhou:', message)
    return { success: false, error: message }
  }
}

/** Lê a lista de jogos persistida (sempre normalizada; [] quando indisponível). */
export function getStoredGames(): StoredGame[] {
  if (!store) return []
  try {
    return normalizeGames(store.get('games', []))
  } catch (err) {
    console.error('[store] Falha ao ler games:', err)
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
    console.error('[store] Falha ao salvar games:', message)
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
