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
    constructor() {
      const g = globalThis as any
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

describe('preferências (launchKloudOnStart / gamepad / bigPicture)', () => {
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
