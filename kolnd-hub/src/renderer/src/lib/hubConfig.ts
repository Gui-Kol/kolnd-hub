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

type ConfigSnapshot = {
  apps: Array<Record<string, unknown>> | null
  startupImportance: Record<string, ImportanceLevel> | null
}

// Snapshot do store: uma leitura por processo. No dev o StrictMode monta os
// efeitos duas vezes e, sem ele, cada chamador (apps + importance) pagaria a
// mesma ida IPC ao main de novo.
let configSnapshot: Promise<ConfigSnapshot> | null = null

/**
 * Lê o config do electron-store uma única vez por processo.
 *
 * `refresh: true` descarta o snapshot e relê — usado quando a UI força uma
 * recarga. Falha não fica memoizada: o cache é limpo para a próxima chamada
 * poder tentar o store de novo (o fallback de localStorage segue igual).
 */
function readConfigSnapshot(refresh = false): Promise<ConfigSnapshot> {
  if (refresh) configSnapshot = null
  if (!configSnapshot) {
    // `Promise.resolve().then` mantém semântica do try/catch atual: erro
    // síncrono da IPC também vira rejeição tratada pelo chamador.
    const promise = Promise.resolve().then(() => window.api.configGet())
    configSnapshot = promise
    void promise.catch(() => {
      if (configSnapshot === promise) configSnapshot = null
    })
  }
  return configSnapshot
}

/** Apenas para testes: descarta o snapshot para simular um processo novo. */
export function __resetHubConfigForTests(): void {
  configSnapshot = null
}

export async function loadAppConfigs(refresh = false): Promise<AppConfig[]> {
  try {
    const snap = await readConfigSnapshot(refresh)
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

export async function loadImportanceMap(refresh = false): Promise<Record<string, ImportanceLevel>> {
  try {
    const snap = await readConfigSnapshot(refresh)
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
