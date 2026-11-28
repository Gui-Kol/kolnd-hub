import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadAppConfigs,
  loadImportanceMap,
  saveAppConfigs,
  saveImportanceMap,
  __resetHubConfigForTests
} from './hubConfig'
import {
  LEGACY_APPS_BACKUP_KEY,
  LEGACY_APPS_KEY,
  LEGACY_IMPORTANCE_BACKUP_KEY,
  LEGACY_IMPORTANCE_KEY,
  mergeAppConfigs,
  parseSavedApps,
  parseStartupImportance
} from './appsConfig'
import { apps as defaultApps } from '../config/apps'
import type { AppConfig, ImportanceLevel } from '../types'

type Api = {
  configGet?: ReturnType<typeof vi.fn>
  configSetApps?: ReturnType<typeof vi.fn>
  configSetStartupImportance?: ReturnType<typeof vi.fn>
  configMigrate?: ReturnType<typeof vi.fn>
}

function makeStorage(initial: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: () => null
  } as unknown as Storage
}

function installWindow(api: Api, storage: Record<string, string>): void {
  Object.defineProperty(globalThis, 'window', { value: { api }, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', {
    value: makeStorage(storage),
    configurable: true
  })
}

function restoreGlobals(): void {
  Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
}

const appA: AppConfig = {
  id: 'app-a',
  name: 'App A',
  description: 'd',
  icon: '📦',
  color: '#000000',
  gradient: 'g',
  command: 'a.exe',
  cwd: 'C:\\a',
  category: 'dev',
  tags: []
}

beforeEach(() => {
  vi.restoreAllMocks()
  // O snapshot de configGet vive no módulo: cada teste simula um processo novo.
  __resetHubConfigForTests()
  restoreGlobals()
})

afterEach(() => {
  restoreGlobals()
  vi.restoreAllMocks()
})

describe('loadAppConfigs — fonte electron-store (IPC)', () => {
  it('store com apps → retorna merge com os defaults', async () => {
    const api: Api = { configGet: vi.fn().mockResolvedValue({ apps: [appA] }) }
    installWindow(api, {})
    const apps = await loadAppConfigs()
    expect(api.configGet).toHaveBeenCalled()
    expect(apps.some((a) => a.id === 'app-a' && a.command === 'a.exe')).toBe(true)
    expect(apps.some((a) => a.id === 'absolem')).toBe(true)
  })

  it('store vazio (apps []) → cai no localStorage legado', async () => {
    const api: Api = {
      configGet: vi.fn().mockResolvedValue({ apps: [] }),
      configMigrate: vi.fn().mockResolvedValue({ success: true })
    }
    const legacy = JSON.stringify([appA])
    installWindow(api, { [LEGACY_APPS_KEY]: legacy })
    const apps = await loadAppConfigs()
    expect(api.configMigrate).toHaveBeenCalled()
    expect(apps.some((a) => a.id === 'app-a')).toBe(true)
    expect(localStorage.getItem(LEGACY_APPS_BACKUP_KEY)).toBe(legacy)
    expect(localStorage.getItem(LEGACY_APPS_KEY)).toBeNull()
  })

  it('store indisponível (IPC lança) → localStorage legado', async () => {
    const api: Api = {
      configGet: vi.fn().mockRejectedValue(new Error('sem IPC')),
      configMigrate: vi.fn().mockResolvedValue({ success: true })
    }
    installWindow(api, { [LEGACY_APPS_KEY]: JSON.stringify([appA]) })
    const apps = await loadAppConfigs()
    expect(apps.some((a) => a.id === 'app-a')).toBe(true)
  })

  it('sem store, sem localStorage → defaults da aplicação', async () => {
    const api: Api = {
      configGet: vi.fn().mockResolvedValue({ apps: null, startupImportance: null })
    }
    installWindow(api, {})
    const apps = await loadAppConfigs()
    expect(apps).toEqual(defaultApps)
  })

  it('store retorna apps inválidos (não-lista) → cai no localStorage/defaults', async () => {
    const api: Api = { configGet: vi.fn().mockResolvedValue({ apps: 'não é lista' }) }
    installWindow(api, {})
    const apps = await loadAppConfigs()
    expect(apps).toEqual(defaultApps)
  })
})

describe('saveAppConfigs', () => {
  it('IPC bem-sucedido não escreve no localStorage', async () => {
    const api: Api = { configSetApps: vi.fn().mockResolvedValue({ success: true }) }
    installWindow(api, {})
    await saveAppConfigs([appA])
    expect(api.configSetApps).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'app-a' })])
    )
    expect(localStorage.getItem(LEGACY_APPS_KEY)).toBeNull()
  })

  it('IPC falha (success false) → fallback no localStorage', async () => {
    const api: Api = {
      configSetApps: vi.fn().mockResolvedValue({ success: false, error: 'indisponível' })
    }
    installWindow(api, {})
    await saveAppConfigs([appA])
    expect(localStorage.getItem(LEGACY_APPS_KEY)).toBe(JSON.stringify([appA]))
  })

  it('IPC lança exceção → fallback no localStorage sem quebrar', async () => {
    const api: Api = { configSetApps: vi.fn().mockRejectedValue(new Error('fora')) }
    installWindow(api, {})
    await expect(saveAppConfigs([appA])).resolves.toBeUndefined()
    expect(localStorage.getItem(LEGACY_APPS_KEY)).toBe(JSON.stringify([appA]))
  })
})

describe('loadImportanceMap / saveImportanceMap', () => {
  it('load: store com startupImportance → retorna o mapa', async () => {
    const api: Api = {
      configGet: vi.fn().mockResolvedValue({ startupImportance: { absolem: 'critico' } })
    }
    installWindow(api, {})
    const map = await loadImportanceMap()
    expect(map).toEqual({ absolem: 'critico' })
  })

  it('load: store vazio → localStorage legado (parseStartupImportance)', async () => {
    const api: Api = {
      configGet: vi.fn().mockResolvedValue({}),
      configMigrate: vi.fn().mockResolvedValue({ success: true })
    }
    const legacy = JSON.stringify({ absolem: 'recomendado', x: 'invalido' })
    installWindow(api, { [LEGACY_IMPORTANCE_KEY]: legacy })
    const map = await loadImportanceMap()
    expect(api.configMigrate).toHaveBeenCalled()
    expect(map).toEqual({ absolem: 'recomendado' })
    expect(localStorage.getItem(LEGACY_IMPORTANCE_BACKUP_KEY)).toBe(legacy)
  })

  it('load: nada salvo → mapa vazio', async () => {
    const api: Api = { configGet: vi.fn().mockResolvedValue({}) }
    installWindow(api, {})
    expect(await loadImportanceMap()).toEqual({})
  })

  it('save: sucesso → não escreve localStorage', async () => {
    const api: Api = { configSetStartupImportance: vi.fn().mockResolvedValue({ success: true }) }
    installWindow(api, {})
    await saveImportanceMap({ absolem: 'critico' as ImportanceLevel })
    expect(localStorage.getItem(LEGACY_IMPORTANCE_KEY)).toBeNull()
  })

  it('save: falha → fallback localStorage', async () => {
    const api: Api = { configSetStartupImportance: vi.fn().mockRejectedValue(new Error('fora')) }
    installWindow(api, {})
    await saveImportanceMap({ absolem: 'inutil' as ImportanceLevel })
    expect(localStorage.getItem(LEGACY_IMPORTANCE_KEY)).toBe(JSON.stringify({ absolem: 'inutil' }))
  })
})

describe('snapshot de configGet (uma leitura por processo)', () => {
  it('loadAppConfigs + loadImportanceMap juntos chamam configGet exatamente 1×', async () => {
    const api: Api = {
      configGet: vi.fn().mockResolvedValue({
        apps: [appA],
        startupImportance: { absolem: 'critico' }
      })
    }
    installWindow(api, {})

    const apps = await loadAppConfigs()
    const map = await loadImportanceMap()

    expect(api.configGet).toHaveBeenCalledTimes(1)
    expect(apps.some((a) => a.id === 'app-a')).toBe(true)
    expect(map).toEqual({ absolem: 'critico' })
  })

  it('loadImportanceMap(true) descarta o snapshot e enxerga o valor novo', async () => {
    const api: Api = {
      configGet: vi
        .fn()
        .mockResolvedValueOnce({ startupImportance: { absolem: 'critico' } })
        .mockResolvedValueOnce({ startupImportance: { absolem: 'inutil' } })
    }
    installWindow(api, {})

    expect(await loadImportanceMap()).toEqual({ absolem: 'critico' })
    expect(await loadImportanceMap(true)).toEqual({ absolem: 'inutil' })
    expect(api.configGet).toHaveBeenCalledTimes(2)
  })
})

describe('hubConfig — integração com appsConfig (regressão)', () => {
  it('mergeAppConfigs preserva apps salvos não-default e não duplica ids', () => {
    const merged = mergeAppConfigs([
      appA,
      { id: 'meu-app', command: 'p.exe' } as unknown as AppConfig
    ])
    expect(new Set(merged.map((a) => a.id)).size).toBe(merged.length)
    expect(merged.some((a) => a.id === 'meu-app')).toBe(true)
    expect(merged.length).toBe(defaultApps.length + 2)
  })

  it('parseSavedApps descarta entradas inválidas', () => {
    const out = parseSavedApps(JSON.stringify([appA, { id: 'sem-comando' }, null, 'lixo']))
    expect(out?.map((a) => a.id)).toEqual(['app-a'])
  })

  it('parseStartupImportance filtra níveis inválidos', () => {
    expect(parseStartupImportance(JSON.stringify({ a: 'critico', b: 'qualquer', c: 42 }))).toEqual({
      a: 'critico'
    })
  })
})
