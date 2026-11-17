import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type StoreMock = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

/**
 * electron-store é simulado. O `store` do store.ts é criado em nível de módulo
 * (durante a fase de import, antes do corpo deste teste rodar), então não
 * dá para referenciar uma `const` deste arquivo no construtor do Store simulado
 * (estaria na zona morta temporária). Usamos uma propriedade em globalThis,
 * criada dentro da factory de vi.mock (que roda na hora da import).
 */
vi.mock('electron-store', () => ({
  default: class {
    constructor(options?: unknown) {
      const g = globalThis as any
      // Guarda as opções (inclui `migrations`) para os testes da cadeia de migração.
      g.__kolndStoreOptions = options
      if (!g.__kolndStore) {
        g.__kolndStore = {
          get: vi.fn((_key: string, def: unknown) => def),
          set: vi.fn(),
          delete: vi.fn()
        }
      }
      return g.__kolndStore
    }
  }
}))
vi.mock('electron', () => ({
  app: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

// Import dinâmico: só é executado em beforeAll, depois de globalThis.__kolndStore existir.
let storeMod: typeof import('./store')

let getConfigSnapshot: typeof import('./store').getConfigSnapshot
let setApps: typeof import('./store').setApps
let setStartupImportance: typeof import('./store').setStartupImportance
let migrateFromLegacy: typeof import('./store').migrateFromLegacy
let getStoredGames: typeof import('./store').getStoredGames
let setStoredGames: typeof import('./store').setStoredGames
let getLaunchKloudOnStart: typeof import('./store').getLaunchKloudOnStart
let setLaunchKloudOnStart: typeof import('./store').setLaunchKloudOnStart
let getNotifyOnCrash: typeof import('./store').getNotifyOnCrash
let setNotifyOnCrash: typeof import('./store').setNotifyOnCrash
let getGamepadConfig: typeof import('./store').getGamepadConfig
let setGamepadConfig: typeof import('./store').setGamepadConfig
let resetGamepadConfig: typeof import('./store').resetGamepadConfig
let getBigPicturePrefs: typeof import('./store').getBigPicturePrefs
let setBigPicturePrefs: typeof import('./store').setBigPicturePrefs
let normalizeAppConfig: typeof import('./store').normalizeAppConfig
let normalizeAppConfigs: typeof import('./store').normalizeAppConfigs
let normalizeStartupImportance: typeof import('./store').normalizeStartupImportance
let normalizeGame: typeof import('./store').normalizeGame
let normalizeGames: typeof import('./store').normalizeGames
let normalizeGamepadConfig: typeof import('./store').normalizeGamepadConfig
let normalizeBigPicturePrefs: typeof import('./store').normalizeBigPicturePrefs
let normalizeBenchmarkEntry: typeof import('./store').normalizeBenchmarkEntry
let normalizeBenchmarkHistory: typeof import('./store').normalizeBenchmarkHistory
let getBenchmarkHistory: typeof import('./store').getBenchmarkHistory
let addBenchmarkEntry: typeof import('./store').addBenchmarkEntry
let clearBenchmarkHistory: typeof import('./store').clearBenchmarkHistory

beforeAll(async () => {
  storeMod = await import('./store')
  getConfigSnapshot = storeMod.getConfigSnapshot
  setApps = storeMod.setApps
  setStartupImportance = storeMod.setStartupImportance
  migrateFromLegacy = storeMod.migrateFromLegacy
  getStoredGames = storeMod.getStoredGames
  setStoredGames = storeMod.setStoredGames
  getLaunchKloudOnStart = storeMod.getLaunchKloudOnStart
  setLaunchKloudOnStart = storeMod.setLaunchKloudOnStart
  getNotifyOnCrash = storeMod.getNotifyOnCrash
  setNotifyOnCrash = storeMod.setNotifyOnCrash
  getGamepadConfig = storeMod.getGamepadConfig
  setGamepadConfig = storeMod.setGamepadConfig
  resetGamepadConfig = storeMod.resetGamepadConfig
  getBigPicturePrefs = storeMod.getBigPicturePrefs
  setBigPicturePrefs = storeMod.setBigPicturePrefs
  normalizeAppConfig = storeMod.normalizeAppConfig
  normalizeAppConfigs = storeMod.normalizeAppConfigs
  normalizeStartupImportance = storeMod.normalizeStartupImportance
  normalizeGame = storeMod.normalizeGame
  normalizeGames = storeMod.normalizeGames
  normalizeGamepadConfig = storeMod.normalizeGamepadConfig
  normalizeBigPicturePrefs = storeMod.normalizeBigPicturePrefs
  normalizeBenchmarkEntry = storeMod.normalizeBenchmarkEntry
  normalizeBenchmarkHistory = storeMod.normalizeBenchmarkHistory
  getBenchmarkHistory = storeMod.getBenchmarkHistory
  addBenchmarkEntry = storeMod.addBenchmarkEntry
  clearBenchmarkHistory = storeMod.clearBenchmarkHistory
})

const holder = (): StoreMock => (globalThis as any).__kolndStore

beforeEach(() => {
  vi.restoreAllMocks()
  const h = holder()
  h.get.mockImplementation((_key: string, def: unknown) => def)
  h.set.mockClear()
  h.delete.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

import type { StoredAppConfig, StoredGame, GamepadConfig, BigPicturePrefs } from './store'

// ── normalizeAppConfig ──────────────────────────────────────────

describe('normalizeAppConfig', () => {
  it('entrada válida é normalizada com defaults', () => {
    const out = normalizeAppConfig({
      id: '  meu-app ',
      command: 'app.exe',
      cwd: 'C:\\app',
      category: 'ai',
      tags: ['a', 123, 'b'],
      name: '',
      description: 123 as unknown as string
    }) as StoredAppConfig
    expect(out.id).toBe('meu-app')
    expect(out.name).toBe('meu-app')
    expect(out.description).toBe('')
    expect(out.category).toBe('ai')
    expect(out.tags).toEqual(['a', 'b'])
    expect(out.icon).toBe('📦')
    expect(out.command).toBe('app.exe')
    expect(out.cwd).toBe('C:\\app')
  })

  it('sem id ou command → null', () => {
    expect(normalizeAppConfig({ command: 'x.exe' })).toBeNull()
    expect(normalizeAppConfig({ id: 'x' })).toBeNull()
    expect(normalizeAppConfig(null)).toBeNull()
    expect(normalizeAppConfig('texto')).toBeNull()
  })

  it('categoria inválida vira "dev"', () => {
    const out = normalizeAppConfig({
      id: 'x',
      command: 'x.exe',
      category: 'invalido' as never
    }) as StoredAppConfig
    expect(out.category).toBe('dev')
  })

  it('url e useShell opcionais são preservados quando válidos', () => {
    const out = normalizeAppConfig({
      id: 'x',
      command: 'x.exe',
      url: 'https://example.com',
      useShell: false
    }) as StoredAppConfig
    expect(out.url).toBe('https://example.com')
    expect(out.useShell).toBe(false)
  })

  it('autoRestart opcional é preservado apenas quando booleano (06-6.4)', () => {
    expect(
      (normalizeAppConfig({ id: 'x', command: 'x.exe', autoRestart: true }) as StoredAppConfig)
        .autoRestart
    ).toBe(true)
    expect(
      (normalizeAppConfig({ id: 'x', command: 'x.exe', autoRestart: false }) as StoredAppConfig)
        .autoRestart
    ).toBe(false)
    // valor não-booleano é descartado (nunca vira truthy por acidente)
    expect(
      (normalizeAppConfig({ id: 'x', command: 'x.exe', autoRestart: 'yes' }) as StoredAppConfig)
        .autoRestart
    ).toBeUndefined()
  })

  it('persistLogs opcional é preservado apenas quando booleano (05-5.7)', () => {
    expect(
      (normalizeAppConfig({ id: 'x', command: 'x.exe', persistLogs: true }) as StoredAppConfig)
        .persistLogs
    ).toBe(true)
    expect(
      (normalizeAppConfig({ id: 'x', command: 'x.exe', persistLogs: false }) as StoredAppConfig)
        .persistLogs
    ).toBe(false)
    // valor não-booleano é descartado (nunca vira truthy por acidente)
    expect(
      (normalizeAppConfig({ id: 'x', command: 'x.exe', persistLogs: 'yes' }) as StoredAppConfig)
        .persistLogs
    ).toBeUndefined()
  })
})

describe('normalizeAppConfigs', () => {
  it('não-array → []', () => {
    expect(normalizeAppConfigs(null)).toEqual([])
    expect(normalizeAppConfigs('x' as never)).toEqual([])
  })

  it('deduplica por id (primeira válida vence)', () => {
    const out = normalizeAppConfigs([
      { id: 'a', command: 'a.exe' },
      { id: 'a', command: 'b.exe' },
      { id: 'b', command: 'b.exe' },
      null,
      { command: 'sem-id.exe' }
    ])
    expect(out.map((a) => a.id)).toEqual(['a', 'b'])
  })
})

// ── normalizeStartupImportance ──────────────────────────────────

describe('normalizeStartupImportance', () => {
  it('filtra níveis inválidos e não-objetos', () => {
    expect(normalizeStartupImportance(null)).toEqual({})
    expect(normalizeStartupImportance([1] as never)).toEqual({})
    expect(normalizeStartupImportance({ a: 'critico', b: 'invalido', c: 42 })).toEqual({
      a: 'critico'
    })
    expect(normalizeStartupImportance({})).toEqual({})
  })
})

// ── normalizeGame / normalizeGames ─────────────────────────────

describe('normalizeGame', () => {
  it('jogo válido → normalizado', () => {
    const out = normalizeGame({
      id: 'g1',
      name: '  Jogo  ',
      exePath: 'C:\\Games\\g.exe',
      origin: 'steam',
      steamAppId: 123,
      iconPath: '',
      addedAt: ''
    }) as StoredGame
    expect(out.id).toBe('g1')
    expect(out.name).toBe('Jogo')
    expect(out.origin).toBe('steam')
    expect(out.steamAppId).toBe(123)
    expect(out.iconPath).toBeNull()
    expect(out.addedAt).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('campos obrigatórios ausentes → null; steamAppId inválido é ignorado', () => {
    expect(normalizeGame({ name: 'x', exePath: 'x.exe' })).toBeNull()
    expect(normalizeGame({ id: 'x', exePath: 'x.exe' })).toBeNull()
    expect(normalizeGame({ id: 'x', name: 'x' })).toBeNull()
    expect(normalizeGame(null)).toBeNull()
    const out = normalizeGame({
      id: 'x',
      name: 'x',
      exePath: 'x.exe',
      steamAppId: -5
    }) as StoredGame
    expect(out.steamAppId).toBeUndefined()
  })
})

describe('normalizeGames', () => {
  it('não-array → []', () => {
    expect(normalizeGames(null)).toEqual([])
  })

  it('dedup por id, steamAppId e exePath (case-insensitive)', () => {
    const out = normalizeGames([
      { id: 'a', name: 'A', exePath: 'C:\\A\\a.exe', origin: 'custom' },
      { id: 'a', name: 'A2', exePath: 'C:\\A2\\a2.exe', origin: 'custom' },
      { id: 'b', name: 'B', exePath: 'C:\\B\\b.exe', origin: 'custom' },
      { id: 'c', name: 'C', exePath: 'C:\\C\\c.exe', origin: 'steam', steamAppId: 7 },
      { id: 'd', name: 'D', exePath: 'C:\\D\\d.exe', origin: 'steam', steamAppId: 7 }
    ])
    expect(out.map((g) => g.id)).toEqual(['a', 'b', 'c'])
  })
})

// ── normalizeGamepadConfig ─────────────────────────────────────

const validGamepadInput = {
  profile: 'xbox',
  controllerId: 'Xbox Controller',
  controllerName: 'Controle Xbox',
  configuredAt: '2026-01-01T00:00:00.000Z',
  autoMapped: true,
  vendorId: '045e',
  productId: '028e',
  mapping: {
    confirm: 0,
    back: 1,
    up: 12,
    down: 13,
    left: 14,
    right: 15,
    menu: 9,
    options: 8,
    tab_prev: 4,
    tab_next: 5,
    stick_left: 10,
    stick_right: 11
  }
}

describe('normalizeGamepadConfig', () => {
  it('config válida é normalizada', () => {
    const out = normalizeGamepadConfig(validGamepadInput) as GamepadConfig
    expect(out.profile).toBe('xbox')
    expect(out.controllerId).toBe('Xbox Controller')
    expect(out.mapping.confirm).toBe(0)
    expect(out.vendorId).toBe('045e')
    expect(out.autoMapped).toBe(true)
  })

  it('rejeita não-objeto, array, perfil inválido', () => {
    expect(normalizeGamepadConfig(null)).toBeNull()
    expect(normalizeGamepadConfig([1] as never)).toBeNull()
    expect(
      normalizeGamepadConfig({ ...validGamepadInput, profile: 'invalido' as never })
    ).toBeNull()
  })

  it('exige controllerId, controllerName, configuredAt, autoMapped', () => {
    const base = { ...validGamepadInput }
    expect(normalizeGamepadConfig({ ...base, controllerId: '' })).toBeNull()
    expect(normalizeGamepadConfig({ ...base, controllerName: '' })).toBeNull()
    expect(normalizeGamepadConfig({ ...base, configuredAt: '' })).toBeNull()
    expect(normalizeGamepadConfig({ ...base, autoMapped: 'sim' as never })).toBeNull()
  })

  it('mapeamento incompleto (ação ausente) → null', () => {
    const { confirm, ...rest } = validGamepadInput.mapping
    expect(normalizeGamepadConfig({ ...validGamepadInput, mapping: rest })).toBeNull()
  })

  it('índice 16 (Guide) e fora de 0-15 → null; null explícito é permitido', () => {
    expect(
      normalizeGamepadConfig({
        ...validGamepadInput,
        mapping: { ...validGamepadInput.mapping, confirm: 16 }
      })
    ).toBeNull()
    expect(
      normalizeGamepadConfig({
        ...validGamepadInput,
        mapping: { ...validGamepadInput.mapping, confirm: -1 }
      })
    ).toBeNull()
    expect(
      normalizeGamepadConfig({
        ...validGamepadInput,
        mapping: { ...validGamepadInput.mapping, confirm: null }
      })
    ).not.toBeNull()
  })

  it('vendorId/productId opcionais', () => {
    const out = normalizeGamepadConfig({
      ...validGamepadInput,
      vendorId: '',
      productId: ''
    }) as GamepadConfig
    expect(out.vendorId).toBeUndefined()
    expect(out.productId).toBeUndefined()
  })
})

// ── normalizeBigPicturePrefs ────────────────────────────────────

describe('normalizeBigPicturePrefs', () => {
  it('default { sounds: true } para qualquer entrada inconsistente', () => {
    expect(normalizeBigPicturePrefs(null)).toEqual({ sounds: true })
    expect(normalizeBigPicturePrefs({} as never)).toEqual({ sounds: true })
    expect(normalizeBigPicturePrefs({ sounds: 'sim' as never })).toEqual({ sounds: true })
    expect(normalizeBigPicturePrefs({ sounds: false })).toEqual({ sounds: false })
    expect(normalizeBigPicturePrefs({ sounds: true })).toEqual({ sounds: true })
  })
})

// ── store-get/set wrappers (store simulado via globalThis holder) ──

describe('getConfigSnapshot', () => {
  it('store sem apps/importância → {apps: null, startupImportance: null}', () => {
    expect(getConfigSnapshot()).toEqual({ apps: null, startupImportance: null })
  })

  it('store com apps e importância → snapshot preenchido', () => {
    const h = holder()
    h.get.mockImplementation((key: string) => {
      if (key === 'apps')
        return [
          {
            id: 'a',
            command: 'a.exe',
            cwd: 'c',
            category: 'dev',
            name: 'A',
            description: '',
            icon: 'i',
            color: '#000',
            gradient: 'g',
            tags: []
          } as StoredAppConfig
        ]
      if (key === 'startupImportance') return { a: 'critico' }
      return undefined
    })
    const snap = getConfigSnapshot()
    expect(snap.apps?.length).toBe(1)
    expect(snap.startupImportance).toEqual({ a: 'critico' })
  })
})

describe('setApps / setStartupImportance', () => {
  it('setApps normaliza e grava (null → lista vazia salva sem lançar)', () => {
    const res = setApps(null)
    expect(res.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('apps', [])
    const res2 = setApps([{ id: 'a', command: 'a.exe', cwd: 'c' } as never])
    expect(res2.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('apps', expect.any(Array))
  })

  it('autoRestart sobrevive ao round-trip grava→lê→normaliza (06-6.4)', () => {
    const res = setApps([
      {
        id: 'a',
        command: 'a.exe',
        cwd: 'c',
        autoRestart: true
      } as never
    ])
    expect(res.success).toBe(true)
    // simula o que foi para o config.json
    const gravada = holder().set.mock.calls[0][1] as Array<Record<string, unknown>>
    expect(gravada[0].autoRestart).toBe(true)
    // relê como se viesse do disco (normalização na leitura/migração)
    const relida = normalizeAppConfigs(gravada)
    expect(relida[0].autoRestart).toBe(true)
  })

  it('persistLogs sobrevive ao round-trip grava→lê→normaliza (05-5.7)', () => {
    const res = setApps([
      {
        id: 'a',
        command: 'a.exe',
        cwd: 'c',
        persistLogs: true
      } as never
    ])
    expect(res.success).toBe(true)
    // simula o que foi para o config.json
    const gravada = holder().set.mock.calls[0][1] as Array<Record<string, unknown>>
    expect(gravada[0].persistLogs).toBe(true)
    // relê como se viesse do disco (normalização na leitura/migração)
    const relida = normalizeAppConfigs(gravada)
    expect(relida[0].persistLogs).toBe(true)
  })

  it('setStartupImportance normaliza e grava (null → mapa vazio salvo sem lançar)', () => {
    const res = setStartupImportance(null)
    expect(res.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('startupImportance', {})
    const res2 = setStartupImportance({ a: 'invalido' as never, b: 'critico' })
    expect(res2.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('startupImportance', { b: 'critico' })
  })
})

describe('migrateFromLegacy', () => {
  it('grava apenas as chaves enviadas', () => {
    const res = migrateFromLegacy({})
    expect(res.success).toBe(true)
    expect(holder().set).not.toHaveBeenCalled()
    const res2 = migrateFromLegacy({ apps: [{ id: 'a', command: 'a.exe', cwd: 'c' } as never] })
    expect(res2.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('apps', expect.any(Array))
  })
})

describe('getStoredGames / setStoredGames', () => {
  it('getStoredGames sempre normalizado; [] sem store', () => {
    expect(getStoredGames()).toEqual([])
    holder().get.mockImplementation(() => [
      { id: 'a', name: 'A', exePath: 'a.exe', origin: 'custom', addedAt: '2026' } as never
    ])
    expect(getStoredGames().length).toBe(1)
  })

  it('setStoredGames normaliza e grava (null → lista vazia salva sem lançar)', () => {
    const res = setStoredGames(null)
    expect(res.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('games', [])
    const res2 = setStoredGames([
      { id: 'a', name: 'A', exePath: 'a.exe', origin: 'custom' } as never
    ])
    expect(res2.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('games', expect.any(Array))
  })
})

describe('preferências (launchKloudOnStart / notifyOnCrash / gamepad / bigPicture)', () => {
  it('getLaunchKloudOnStart default false', () => {
    expect(getLaunchKloudOnStart()).toBe(false)
    holder().get.mockImplementation(() => true)
    expect(getLaunchKloudOnStart()).toBe(true)
  })

  it('setLaunchKloudOnStart exige booleano', () => {
    expect(setLaunchKloudOnStart('sim' as never)).toEqual({
      success: false,
      error: 'Valor inválido para a preferência.'
    })
    const res = setLaunchKloudOnStart(true)
    expect(res.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('launchKloudOnStart', true)
  })

  it('getNotifyOnCrash default true (opt-out)', () => {
    expect(getNotifyOnCrash()).toBe(true)
    holder().get.mockImplementation(() => false)
    expect(getNotifyOnCrash()).toBe(false)
  })

  it('setNotifyOnCrash exige booleano e faz round-trip', () => {
    expect(setNotifyOnCrash('sim' as never)).toEqual({
      success: false,
      error: 'Valor inválido para a preferência.'
    })
    const res = setNotifyOnCrash(false)
    expect(res.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('notifyOnCrash', false)
    const res2 = setNotifyOnCrash(true)
    expect(res2.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('notifyOnCrash', true)
  })

  it('getGamepadConfig / setGamepadConfig / resetGamepadConfig', () => {
    expect(getGamepadConfig()).toBeNull()
    const res = setGamepadConfig(validGamepadInput)
    expect(res.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith(
      'gamepad',
      expect.objectContaining({ profile: 'xbox' })
    )
    expect(resetGamepadConfig().success).toBe(true)
    expect(holder().delete).toHaveBeenCalledWith('gamepad')
  })

  it('setGamepadConfig recusa config inválida e preserva configuredAt quando igual', () => {
    expect(setGamepadConfig({ profile: 'invalido' as never }).success).toBe(false)
    const r1 = setGamepadConfig(validGamepadInput)
    expect(r1.success).toBe(true)
    const configuredAt1 = (holder().set.mock.lastCall?.[1] as GamepadConfig).configuredAt
    setGamepadConfig({ ...validGamepadInput })
    const configuredAt2 = (holder().set.mock.lastCall?.[1] as GamepadConfig).configuredAt
    expect(configuredAt2).toBe(configuredAt1) // igual → não troca o carimbo
  })

  it('getBigPicturePrefs / setBigPicturePrefs', () => {
    expect(getBigPicturePrefs()).toEqual({ sounds: true })
    holder().get.mockImplementation(() => ({ sounds: false }) as never)
    expect(getBigPicturePrefs()).toEqual({ sounds: false })
    expect(setBigPicturePrefs(null)).toEqual({ success: false, error: 'Preferências inválidas.' })
    expect(setBigPicturePrefs({} as never)).toEqual({
      success: false,
      error: 'Preferências inválidas: `sounds` deve ser booleano.'
    })
    const res = setBigPicturePrefs({ sounds: false })
    expect(res.success).toBe(true)
    expect(holder().set).toHaveBeenCalledWith('bigPicture', { sounds: false })
  })
})

// ── config.json corrompido / fallbacks de erro ─────────────────

describe('config.json corrompido (leitura lançando)', () => {
  it('get* caem para defaults sem lançar; set reescreve válido depois', () => {
    const h = holder()
    h.get.mockImplementation(() => {
      throw new Error('Unexpected token } in JSON at position 42')
    })
    // Nenhuma exceção pode vazar para o consumidor:
    expect(getConfigSnapshot()).toEqual({ apps: null, startupImportance: null })
    expect(getStoredGames()).toEqual([])
    expect(getLaunchKloudOnStart()).toBe(false)
    expect(getNotifyOnCrash()).toBe(true)
    expect(getGamepadConfig()).toBeNull()
    expect(getBigPicturePrefs()).toEqual({ sounds: true })

    // Recuperação: a leitura volta a funcionar e o set reescreve um config válido.
    h.get.mockImplementation((_key: string, def: unknown) => def)
    const res = setApps([{ id: 'a', command: 'a.exe', cwd: 'c' } as never])
    expect(res.success).toBe(true)
    expect(h.set).toHaveBeenCalledWith('apps', expect.any(Array))
  })

  it('get* com JSON `null` literal no arquivo não degenera (fallbacks seguros)', () => {
    // Arquivo com `null` literal: store.get('apps', []) devolve null →
    // `apps.length` lançaria, mas cai no catch de getConfigSnapshot → defaults.
    holder().get.mockImplementation(() => null)
    expect(getConfigSnapshot()).toEqual({ apps: null, startupImportance: null })
    expect(getStoredGames()).toEqual([])
    expect(getLaunchKloudOnStart()).toBe(false)
    expect(getNotifyOnCrash()).toBe(true)
    expect(getGamepadConfig()).toBeNull()
    expect(getBigPicturePrefs()).toEqual({ sounds: true })
  })

  it('set* com disco/escritura falhando → { success: false }, sem exceção crua', () => {
    const h = holder()
    h.set.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device')
    })
    h.delete.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device')
    })
    expect(setApps([{ id: 'a', command: 'a.exe', cwd: 'c' } as never]).success).toBe(false)
    expect(setStartupImportance({ a: 'critico' }).success).toBe(false)
    expect(setStoredGames(null).success).toBe(false)
    expect(setLaunchKloudOnStart(true).success).toBe(false)
    expect(setNotifyOnCrash(true).success).toBe(false)
    expect(setGamepadConfig(validGamepadInput).success).toBe(false)
    expect(setBigPicturePrefs({ sounds: false }).success).toBe(false)
    expect(migrateFromLegacy({ apps: [] }).success).toBe(false)
    expect(resetGamepadConfig().success).toBe(false)
  })
})

// ── migrações de schema (cadeia 1.0.0 → 1.5.0) ─────────────────

describe('migrações de schema (cadeia 1.0.0 → 1.5.0)', () => {
  type FakeStore = {
    data: Record<string, unknown>
    get: (key: string, def?: unknown) => unknown
    set: (key: string, value: unknown) => void
  }

  const makeFakeStore = (data: Record<string, unknown>): FakeStore => ({
    data,
    get: (key: string, def?: unknown) => (key in data ? data[key] : def),
    set: (key: string, value: unknown) => {
      data[key] = value
    }
  })

  // As migrations são capturadas do mock do electron-store (opções passadas ao construtor).
  const migrationsOf = (): Record<string, (s: FakeStore) => void> => {
    const migrations = (globalThis as { __kolndStoreOptions?: { migrations?: unknown } })
      .__kolndStoreOptions?.migrations
    if (!migrations || typeof migrations !== 'object') {
      throw new Error('migrations não capturadas do construtor do Store')
    }
    return migrations as Record<string, (s: FakeStore) => void>
  }

  const runChain = (s: FakeStore): void => {
    for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0']) {
      migrationsOf()[version](s)
    }
  }

  it('config 1.0.0 (sem games/launchKloudOnStart/gamepad/bigPicture) migra para o formato atual', () => {
    const s = makeFakeStore({
      // Formato pré-1.1.0: apps com campos faltantes e entradas inválidas.
      apps: [
        { id: 'meu-app', command: 'app.exe' }, // faltam cwd/category/name…
        { id: '', command: 'sem-id.exe' }, // inválido → descartado
        'lixo' // inválido → descartado
      ],
      startupImportance: { a: 'critico', b: 'urgente', c: 7 }
      // sem `games`, `launchKloudOnStart`, `gamepad`, `bigPicture`
    })
    runChain(s)
    // apps: normalizados; inválidos eliminados; campos preenchidos
    expect(s.data.apps).toHaveLength(1)
    expect(s.data.apps).toEqual([
      expect.objectContaining({ id: 'meu-app', command: 'app.exe', category: 'dev' })
    ])
    // startupImportance: só níveis válidos sobrevivem
    expect(s.data.startupImportance).toEqual({ a: 'critico' })
    // 1.2.0 garantiu a chave games (lista normalizada)
    expect(s.data.games).toEqual([])
    // 1.3.0 garantiu launchKloudOnStart boolean
    expect(s.data.launchKloudOnStart).toBe(false)
    // 1.4.0 garantiu gamepad (null) e bigPicture (default)
    expect(s.data.gamepad).toBeNull()
    expect(s.data.bigPicture).toEqual({ sounds: true })
    // 1.5.0 garantiu benchmarkHistory vazio
    expect(s.data.benchmarkHistory).toEqual([])
  })

  it('games antigos sem origin/addedAt são preservados e normalizados (nada perdido)', () => {
    const s = makeFakeStore({
      apps: [{ id: 'a', command: 'a.exe', cwd: 'c', category: 'ai' }],
      games: [
        // Formato pré-1.2.0: sem origin e sem addedAt
        { id: 'g1', name: 'Jogo Um', exePath: 'C:\\Games\\g1.exe' }
      ]
    })
    runChain(s)
    expect(s.data.games).toHaveLength(1)
    expect(s.data.games).toEqual([
      expect.objectContaining({
        id: 'g1',
        name: 'Jogo Um',
        exePath: 'C:\\Games\\g1.exe',
        origin: 'custom'
      })
    ])
    const game = (s.data.games as Array<{ addedAt?: string }>)[0]
    expect(game.addedAt).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('gamepad presente mas inválido volta a null; bigPicture inválida cai no default', () => {
    const s = makeFakeStore({
      // Objeto sem as chaves obrigatórias do GamepadConfig
      gamepad: { profile: 'nao-existe' },
      // Tipo errado para `sounds`
      bigPicture: { sounds: 'sim' }
    })
    runChain(s)
    expect(s.data.gamepad).toBeNull()
    expect(s.data.bigPicture).toEqual({ sounds: true })
  })

  it('migrações não lançam mesmo com chaves ilegíveis (arquivo inconsistente)', () => {
    const s: FakeStore = {
      data: {},
      get: () => {
        throw new Error('arquivo inconsistente')
      },
      set: () => {
        throw new Error('arquivo inconsistente')
      }
    }
    for (const version of ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0']) {
      expect(() => migrationsOf()[version](s)).not.toThrow()
    }
  })

  it('1.5.0 normaliza benchmarkHistory (inválidos descartados, cap 20)', () => {
    const s = makeFakeStore({
      benchmarkHistory: [
        {
          id: 'ok',
          at: '2026-11-16T00:00:00.000Z',
          single: 10,
          multi: 20,
          ratio: 2,
          cores: 4,
          model: 'CPU de Teste',
          tests: 'lixo'
        },
        {
          id: 'ruim',
          at: '2026-11-16T00:00:00.000Z',
          single: -1,
          multi: 20,
          ratio: 2,
          cores: 4,
          model: 'CPU de Teste'
        },
        'lixo'
      ]
    })
    migrationsOf()['1.5.0'](s)
    expect(s.data.benchmarkHistory).toEqual([
      {
        id: 'ok',
        at: '2026-11-16T00:00:00.000Z',
        single: 10,
        multi: 20,
        ratio: 2,
        cores: 4,
        model: 'CPU de Teste',
        tests: []
      }
    ])
  })
})

// ── benchmarkHistory (histórico local do benchmark de CPU) ─────

describe('benchmarkHistory', () => {
  const makeEntry = (id = 'bench-1', at = '2026-11-16T10:00:00.000Z'): Record<string, unknown> => ({
    id,
    at,
    single: 120.5,
    multi: 800.25,
    ratio: 6.64,
    cores: 8,
    model: 'CPU de Teste',
    tests: [
      { id: 'integers', label: 'Inteiros (ARX)', single: 100, multi: 700 },
      { id: 'sha', label: 'SHA-256', single: 20, multi: 140 }
    ]
  })

  it('normaliza uma execução válida (trim, cortes e testes)', () => {
    const entry = normalizeBenchmarkEntry({
      ...makeEntry('  bench-1  '),
      model: 'x'.repeat(500),
      cores: 8.9,
      tests: [
        { id: 'integers', label: 'Inteiros (ARX)', single: 100, multi: 700 },
        { id: '', label: 'inválido', single: 1, multi: 1 },
        'lixo'
      ]
    })
    expect(entry).not.toBeNull()
    expect(entry?.id).toBe('bench-1')
    expect(entry?.model).toHaveLength(200)
    expect(entry?.cores).toBe(8)
    expect(entry?.tests).toHaveLength(1)
  })

  it('descarta entradas com números inválidos/negativos ou campos ausentes', () => {
    expect(normalizeBenchmarkEntry(null)).toBeNull()
    expect(normalizeBenchmarkEntry('texto')).toBeNull()
    expect(normalizeBenchmarkEntry({ ...makeEntry(), single: -1 })).toBeNull()
    expect(normalizeBenchmarkEntry({ ...makeEntry(), multi: Infinity })).toBeNull()
    expect(normalizeBenchmarkEntry({ ...makeEntry(), ratio: '6' })).toBeNull()
    expect(normalizeBenchmarkEntry({ ...makeEntry(), cores: NaN })).toBeNull()
    expect(normalizeBenchmarkEntry({ ...makeEntry(), id: '' })).toBeNull()
    expect(normalizeBenchmarkEntry({ ...makeEntry(), at: '' })).toBeNull()
    expect(normalizeBenchmarkEntry({ ...makeEntry(), model: '' })).toBeNull()
  })

  it('tests inválido vira [] sem derrubar a execução', () => {
    const entry = normalizeBenchmarkEntry({ ...makeEntry(), tests: 'nada' })
    expect(entry?.tests).toEqual([])
  })

  it('normalizeBenchmarkHistory: não-array → [], deduplica e aplica cap 20', () => {
    expect(normalizeBenchmarkHistory(null)).toEqual([])
    const many = Array.from({ length: 25 }, (_, index) => makeEntry(`bench-${index}`))
    const capped = normalizeBenchmarkHistory([...many, many[0], 'lixo'])
    expect(capped).toHaveLength(20)
    expect(capped[0].id).toBe('bench-0')
    expect(capped[19].id).toBe('bench-19')
  })

  it('addBenchmarkEntry insere no topo e respeita o cap de 20', () => {
    const h = holder()
    const existing = Array.from({ length: 20 }, (_, index) => makeEntry(`bench-${index}`))
    h.get.mockImplementation((key: string, def: unknown) =>
      key === 'benchmarkHistory' ? existing : def
    )
    expect(addBenchmarkEntry(makeEntry('novo'))).toBe(true)
    expect(h.set).toHaveBeenCalledTimes(1)
    const saved = h.set.mock.calls[0][1] as Array<{ id: string }>
    expect(saved).toHaveLength(20)
    expect(saved[0].id).toBe('novo')
    expect(saved[19].id).toBe('bench-18')
  })

  it('addBenchmarkEntry ignora entrada inválida sem tocar no disco', () => {
    const h = holder()
    expect(addBenchmarkEntry({ id: 'x' })).toBe(false)
    expect(h.set).not.toHaveBeenCalled()
  })

  it('addBenchmarkEntry substitui a mesma execução pelo id (sem duplicar)', () => {
    const h = holder()
    h.get.mockImplementation((key: string, def: unknown) =>
      key === 'benchmarkHistory' ? [makeEntry('bench-1')] : def
    )
    expect(addBenchmarkEntry(makeEntry('bench-1'))).toBe(true)
    const saved = h.set.mock.calls[0][1] as Array<{ id: string }>
    expect(saved).toHaveLength(1)
  })

  it('getBenchmarkHistory normaliza o disco e tolera falha de leitura', () => {
    const h = holder()
    h.get.mockImplementation((key: string, def: unknown) =>
      key === 'benchmarkHistory' ? [makeEntry('bench-1'), 'lixo'] : def
    )
    expect(getBenchmarkHistory()).toHaveLength(1)
    h.get.mockImplementation(() => {
      throw new Error('corrompido')
    })
    expect(getBenchmarkHistory()).toEqual([])
  })

  it('clearBenchmarkHistory grava lista vazia', () => {
    const h = holder()
    expect(clearBenchmarkHistory()).toBe(true)
    expect(h.set).toHaveBeenCalledWith('benchmarkHistory', [])
  })
})

// ── store indisponível (construtor lança) ──────────────────────

describe('store indisponível (construtor do electron-store lança)', () => {
  it('degrada para modo fallback: get* com defaults, set* com erro, log de erro emitido', async () => {
    const loggerError = vi.fn()
    const loggerInfo = vi.fn()

    vi.resetModules()
    vi.doMock('./logger', () => ({
      logger: {
        debug: vi.fn(),
        info: loggerInfo,
        warn: vi.fn(),
        error: loggerError
      }
    }))
    vi.doMock('electron-store', () => ({
      default: class {
        constructor() {
          throw new Error('EPERM: operation not permitted, open config.json')
        }
      }
    }))

    try {
      const mod = await import('./store')

      // get* não lançam: caem para defaults / comportamento de fallback
      expect(mod.getConfigSnapshot()).toEqual({ apps: null, startupImportance: null })
      expect(mod.getStoredGames()).toEqual([])
      expect(mod.getLaunchKloudOnStart()).toBe(false)
      expect(mod.getNotifyOnCrash()).toBe(true)
      expect(mod.getGamepadConfig()).toBeNull()
      expect(mod.getBigPicturePrefs()).toEqual({ sounds: true })

      // set* reportam erro controlado — nunca exceção crua
      expect(mod.setApps([{ id: 'a', command: 'a.exe', cwd: 'c' } as never])).toEqual({
        success: false,
        error: 'Store persistente indisponível'
      })
      expect(mod.setStartupImportance({ a: 'critico' })).toEqual({
        success: false,
        error: 'Store persistente indisponível'
      })
      expect(mod.setStoredGames(null).success).toBe(false)
      expect(mod.setLaunchKloudOnStart(true).success).toBe(false)
      expect(mod.setNotifyOnCrash(true).success).toBe(false)
      expect(mod.setGamepadConfig(validGamepadInput).success).toBe(false)
      expect(mod.setBigPicturePrefs({ sounds: false }).success).toBe(false)
      expect(mod.migrateFromLegacy({ apps: [] }).success).toBe(false)
      expect(mod.resetGamepadConfig().success).toBe(false)

      // O erro de construção foi registrado no log (escopo 'store', modo fallback)
      expect(loggerError).toHaveBeenCalled()
      const fallbackLogged = loggerError.mock.calls.some(
        (call) => String(call[0]) === 'store' && String(call[1]).includes('fallback')
      )
      expect(fallbackLogged).toBe(true)
    } finally {
      vi.doUnmock('electron-store')
      vi.doUnmock('./logger')
      vi.resetModules()
    }
  })
})
