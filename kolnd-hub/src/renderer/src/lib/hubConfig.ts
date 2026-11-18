import { AppConfig, ImportanceLevel } from '../types'
import { apps as defaultApps } from '../config/apps'
import {
  LEGACY_APPS_KEY,
  LEGACY_APPS_BACKUP_KEY,
  LEGACY_IMPORTANCE_KEY,
  LEGACY_IMPORTANCE_BACKUP_KEY,
  mergeAppConfigs,
  parseSavedApps,
  parseStartupImportance
} from './appsConfig'

/**
 * Persistência da config do Hub.
 *
 * Fonte de verdade: electron-store no processo principal (`%APPDATA%/kolnd-hub/config.json`),
 * acessado via IPC. O localStorage é apenas fallback — usado quando a IPC falha
 * (ex.: renderer fora do Electron, ou store indisponível/corrompido).
 *
 * Migração única: na primeira leitura, se o store estiver vazio mas o
 * localStorage tiver dados do formato antigo, eles são enviados via IPC e
 * gravados no store; o localStorage é renomeado para `.bak` (não apagado).
 */

export async function loadAppConfigs(): Promise<AppConfig[]> {
  try {
    const snap = await window.api.configGet()
    if (snap?.apps && Array.isArray(snap.apps) && snap.apps.length > 0) {
      return mergeAppConfigs(snap.apps as unknown as AppConfig[])
    }
  } catch {
    // IPC indisponível → cai no localStorage abaixo
  }

  const legacyJson = localStorage.getItem(LEGACY_APPS_KEY)
  const legacyApps = parseSavedApps(legacyJson)
  if (legacyApps) {
    try {
      await window.api.configMigrate({
        apps: legacyApps as unknown as Array<Record<string, unknown>>
      })
      localStorage.setItem(LEGACY_APPS_BACKUP_KEY, legacyJson ?? '')
      localStorage.removeItem(LEGACY_APPS_KEY)
      console.info('[hubConfig] config migrada de localStorage → electron-store')
    } catch {
      // Store indisponível — segue usando o localStorage como até hoje
    }
    return mergeAppConfigs(legacyApps)
  }

  return defaultApps
}

export async function saveAppConfigs(apps: AppConfig[]): Promise<void> {
  const payload = apps as unknown as Array<Record<string, unknown>>
  try {
    const result = await window.api.configSetApps(payload)
    if (result?.success) return
    throw new Error(result?.error ?? 'config:setApps falhou')
  } catch (err) {
    console.warn(
      `[hubConfig] Falha ao salvar no store (${err instanceof Error ? err.message : String(err)}) — fallback para localStorage`
    )
    localStorage.setItem(LEGACY_APPS_KEY, JSON.stringify(apps))
  }
}

export async function loadImportanceMap(): Promise<Record<string, ImportanceLevel>> {
  try {
    const snap = await window.api.configGet()
    if (snap?.startupImportance && Object.keys(snap.startupImportance).length > 0) {
      return snap.startupImportance
    }
  } catch {
    // fallback abaixo
  }

  const legacyJson = localStorage.getItem(LEGACY_IMPORTANCE_KEY)
  const legacyMap = parseStartupImportance(legacyJson)
  if (legacyMap) {
    try {
      await window.api.configMigrate({ startupImportance: legacyMap })
      localStorage.setItem(LEGACY_IMPORTANCE_BACKUP_KEY, legacyJson ?? '')
      localStorage.removeItem(LEGACY_IMPORTANCE_KEY)
    } catch {
      // mantém no localStorage
    }
    return legacyMap
  }
  return {}
}

export async function saveImportanceMap(map: Record<string, ImportanceLevel>): Promise<void> {
  try {
    const result = await window.api.configSetStartupImportance(map)
    if (result?.success) return
    throw new Error(result?.error ?? 'config:setStartupImportance falhou')
  } catch (err) {
    console.warn(
      `[hubConfig] Falha ao salvar importance no store (${err instanceof Error ? err.message : String(err)}) — fallback para localStorage`
    )
    localStorage.setItem(LEGACY_IMPORTANCE_KEY, JSON.stringify(map))
  }
}
