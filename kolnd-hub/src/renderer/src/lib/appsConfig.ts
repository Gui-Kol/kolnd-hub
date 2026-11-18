import { AppConfig, ImportanceLevel } from '../types'
import { apps as defaultApps } from '../config/apps'

/**
 * Lógica de merge/migração das configurações de programas.
 *
 * Extraída do App.tsx para ser pura e testável (Vitest). O renderer tenta
 * primeiro o electron-store via IPC; se o store estiver vazio/indisponível,
 * lê o legado do localStorage e migra via IPC (`config:migrate`).
 */

/** Chaves legadas do localStorage. */
export const LEGACY_APPS_KEY = 'kolnd-hub-apps'
export const LEGACY_APPS_BACKUP_KEY = 'kolnd-hub-apps.bak'
export const LEGACY_IMPORTANCE_KEY = 'kolnd-hub-startup-importance'
export const LEGACY_IMPORTANCE_BACKUP_KEY = 'kolnd-hub-startup-importance.bak'

/**
 * Defaults antigos → novos caminhos embutidos. Apenas entradas que ainda
 * mantêm os valores default antigos são atualizadas; o que o usuário
 * personalizou fica intacto.
 */
const LEGACY_DEFAULTS: Record<string, Array<{ command: string; cwd: string }>> = {
  'mark-lvi': [{ command: 'py main.py', cwd: '../Mark-LVI' }],
  'kloud-games': [
    { command: 'kloud-games.exe', cwd: '../kloud-games' },
    // Default da era MSI: jogo instalado pelo Hub na 1ª execução
    { command: 'KLOUD_GAMES.exe', cwd: 'resources/programs/kloud-games' }
  ]
}

/** Atualiza uma entrada se ela ainda tiver os valores default legados. */
export function migrateLegacyDefaults(app: AppConfig): AppConfig {
  const legacy = (LEGACY_DEFAULTS[app.id] ?? []).find(
    (l) => l.command === app.command && l.cwd === app.cwd
  )
  if (!legacy) return app
  const def = defaultApps.find((d) => d.id === app.id)
  return def ? { ...def, ...app, command: def.command, cwd: def.cwd } : app
}

/** Faz o parse do JSON salvo. Retorna null se corrompido/inválido. */
export function parseSavedApps(json: string | null): AppConfig[] | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return null
    const apps = parsed.filter(
      (a): a is AppConfig =>
        a !== null &&
        typeof a === 'object' &&
        typeof (a as AppConfig).id === 'string' &&
        typeof (a as AppConfig).command === 'string'
    )
    return apps.length > 0 ? apps : null
  } catch {
    return null
  }
}

/**
 * Faz merge da configuração salva com os defaults atuais:
 * - entradas salvas são migradas (legado → defaults novos) e sobrepõem defaults;
 * - apps novos dos defaults aparecem mesmo sem entrada salva correspondente;
 * - entradas salvas de apps que não existem mais nos defaults são preservadas.
 */
export function mergeAppConfigs(saved: AppConfig[]): AppConfig[] {
  const migrated = saved.map(migrateLegacyDefaults)
  const merged = defaultApps.map((def) => {
    const savedApp = migrated.find((a) => a.id === def.id)
    return savedApp ? { ...def, ...savedApp } : def
  })
  const mergedIds = new Set(merged.map((a) => a.id))
  return [...merged, ...migrated.filter((a) => !mergedIds.has(a.id))]
}

/** Faz o parse do mapa de importância do legado localStorage. */
export function parseStartupImportance(
  json: string | null
): Record<string, ImportanceLevel> | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const valid: ImportanceLevel[] = ['critico', 'recomendado', 'opcional', 'inutil']
    const out: Record<string, ImportanceLevel> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && valid.includes(value as ImportanceLevel)) {
        out[key] = value as ImportanceLevel
      }
    }
    return out
  } catch {
    return null
  }
}
