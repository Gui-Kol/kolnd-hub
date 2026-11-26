import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_KEYS } from '../shared/config'
import { THEME_SCALE_MAX, defaultTheme } from '../shared/theme'

const state = vi.hoisted(() => ({
  fail: false,
  data: new Map<string, unknown>(),
  options: undefined as unknown,
  logError: vi.fn()
}))

vi.mock('electron-store', () => ({
  default: class {
    constructor(options?: unknown) {
      state.options = options
      if (state.fail) throw new Error('config.json corrompido')
    }

    get(key: string, defaultValue: unknown): unknown {
      return state.data.has(key) ? state.data.get(key) : defaultValue
    }

    set(key: string, value: unknown): void {
      state.data.set(key, value)
    }

    delete(key: string): void {
      state.data.delete(key)
    }
  }
}))

vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: state.logError }
}))

interface FakeStore {
  get<T>(key: string, defaultValue: T): T
  set(key: string, value: unknown): void
  delete(key: string): void
}

type StoreModule = typeof import('./store')

let storeMod: StoreModule

function fakeStore(): FakeStore {
  return {
    get<T>(key: string, defaultValue: T): T {
      return state.data.has(key) ? (state.data.get(key) as T) : defaultValue
    },
    set(key: string, value: unknown): void {
      state.data.set(key, value)
    },
    delete(key: string): void {
      state.data.delete(key)
    }
  }
}

interface StoreOptionsShape {
  projectVersion?: string
  migrations?: Record<string, unknown>
}

beforeEach(async () => {
  vi.resetModules()
  state.data.clear()
  state.fail = false
  state.options = undefined
  state.logError.mockClear()
  storeMod = await import('./store')
})

describe('store persistente', () => {
  it('defaults preenchidos', () => {
    expect(storeMod.getStoreSnapshot()).toEqual(storeMod.defaultAbsolemConfig())

    const options = state.options as StoreOptionsShape
    expect(options.projectVersion).toBe('1.9.0')
    expect(Object.keys(options.migrations ?? {})).toEqual([
      '1.0.0',
      '1.1.0',
      '1.2.0',
      '1.3.0',
      '1.4.0',
      '1.5.0',
      '1.6.0',
      '1.7.0',
      '1.8.0',
      '1.9.0'
    ])
  })

  it('valor inválido é normalizado sem perder os válidos', () => {
    state.data.set('theme', { primaryColor: '#123456', style: 'inexistente', scale: 9 })
    state.data.set('overlay', {
      visible: true,
      position: 'top-right',
      offsetX: 'longe',
      width: 5,
      height: 9999,
      shortcut: 'invalido',
      hideOnFullscreen: 'sim'
    })
    state.data.set('voice', { enabled: true, inputDeviceId: 42, outputVolume: 9 })

    const snapshot = storeMod.getStoreSnapshot()

    expect(snapshot.theme).toEqual({
      ...defaultTheme(),
      primaryColor: '#123456',
      scale: THEME_SCALE_MAX
    })
    expect(snapshot.overlay).toEqual({
      visible: true,
      position: 'top-right',
      offsetX: 0,
      offsetY: 0,
      width: 240,
      height: 560,
      shortcut: 'Control+Alt+A',
      hideOnFullscreen: true
    })
    expect(snapshot.voice).toEqual({
      enabled: true,
      inputDeviceId: null,
      outputDeviceId: null,
      outputVolume: 1,
      maxSessionMinutes: 15,
      silenceTimeoutSeconds: 20
    })
  })

  it('migração 1.1.0 preserva dados da 1.0.0, 1.2.0 converte e 1.3.0 migra o tema', () => {
    state.data.set('theme', { mode: 'light', accent: '#abcdef' })
    state.data.set('overlay', { enabled: true, position: 'top-left', scale: 1.5 })
    const store = fakeStore()

    storeMod.STORE_MIGRATIONS['1.0.0'](store)
    expect(state.data.get('theme')).toEqual({ mode: 'light', accent: '#abcdef' })

    storeMod.STORE_MIGRATIONS['1.1.0'](store)

    expect(state.data.get('theme')).toEqual({ mode: 'light', accent: '#abcdef' })
    expect(state.data.get('overlay')).toEqual({
      enabled: true,
      position: 'top-left',
      scale: 1.5
    })
    for (const key of STORE_KEYS) {
      // `memory` só nasce na 1.8.0 e `web` na 1.9.0 (tasks 09 e 10).
      if (key === 'memory' || key === 'web') continue
      expect(state.data.has(key)).toBe(true)
    }

    storeMod.STORE_MIGRATIONS['1.2.0'](store)
    const migrated = {
      visible: true,
      position: 'top-left',
      offsetX: 0,
      offsetY: 0,
      width: 320,
      height: 360,
      shortcut: 'Control+Alt+A',
      hideOnFullscreen: true
    }
    expect(state.data.get('overlay')).toEqual(migrated)

    // Idempotente: rodar de novo sobre o formato atual não muda nada.
    storeMod.STORE_MIGRATIONS['1.2.0'](store)
    expect(state.data.get('overlay')).toEqual(migrated)

    // 1.3.0: `accent` vira `primaryColor`; `mode` é descartado; defaults entram.
    storeMod.STORE_MIGRATIONS['1.3.0'](store)
    const migratedTheme = { ...defaultTheme(), primaryColor: '#abcdef' }
    expect(state.data.get('theme')).toEqual(migratedTheme)

    storeMod.STORE_MIGRATIONS['1.3.0'](store)
    expect(state.data.get('theme')).toEqual(migratedTheme)
  })

  it('1.4.0 adiciona teto de tokens, usage e chat preservando a configuração', () => {
    state.data.set('gemini', { model: 'gemini-2.0-flash', temperature: 0.3 })
    const store = fakeStore()

    storeMod.STORE_MIGRATIONS['1.4.0'](store)

    expect(state.data.get('gemini')).toEqual({
      model: 'gemini-2.0-flash',
      temperature: 0.3,
      monthlyTokenCap: 2_000_000
    })
    expect(state.data.get('usage')).toEqual({ days: {}, warnedMonths: [] })
    expect(state.data.get('chat')).toEqual({ turns: [] })

    // Idempotente.
    storeMod.STORE_MIGRATIONS['1.4.0'](store)
    expect(state.data.get('gemini')).toMatchObject({ monthlyTokenCap: 2_000_000 })
  })

  it('1.6.0 migra screenCapture e preserva telemetry', () => {
    state.data.set('privacy', { telemetry: true, screenCapture: true })
    const store = fakeStore()

    storeMod.STORE_MIGRATIONS['1.6.0'](store)

    const migrated = state.data.get('privacy') as Record<string, unknown>
    expect(migrated).toMatchObject({
      telemetry: true,
      screen: { mode: 'on', proactive: false }
    })
    expect(migrated).not.toHaveProperty('screenCapture')
    expect((migrated.screen as Record<string, unknown>).blocklist).toContain('1password')

    // `false` vira off.
    state.data.set('privacy', { screenCapture: false })
    storeMod.STORE_MIGRATIONS['1.6.0'](store)
    expect(state.data.get('privacy')).toMatchObject({
      telemetry: false,
      screen: { mode: 'off', proactive: false }
    })

    // Idempotente sobre o formato novo.
    state.data.set('privacy', { telemetry: true, screen: { mode: 'ask', proactive: true } })
    storeMod.STORE_MIGRATIONS['1.6.0'](store)
    expect(state.data.get('privacy')).toMatchObject({
      telemetry: true,
      screen: { mode: 'ask', proactive: true }
    })
  })

  it('1.7.0 migra permissões por categoria preservando microphone e descartando legado', () => {
    state.data.set('permissions', {
      microphone: true,
      paused: true,
      screenVision: true,
      computerControl: true,
      fileAccess: true
    })
    const store = fakeStore()

    storeMod.STORE_MIGRATIONS['1.7.0'](store)

    const migrated = state.data.get('permissions') as Record<string, unknown>
    expect(migrated).toEqual({
      microphone: true,
      paused: true,
      categories: {
        'apps.launch': 'ask',
        'apps.close': 'ask',
        'files.read': 'ask',
        'files.write': 'ask',
        'system.power': 'deny',
        'uia.control': 'deny',
        'web.search': 'allow'
      }
    })
    expect(migrated).not.toHaveProperty('computerControl')

    // Categorias válidas já existentes são preservadas; inválidas caem no default.
    state.data.set('permissions', {
      microphone: false,
      paused: false,
      categories: { 'system.power': 'ask', 'uia.control': 'talvez' }
    })
    storeMod.STORE_MIGRATIONS['1.7.0'](store)
    expect(state.data.get('permissions')).toMatchObject({
      categories: { 'system.power': 'ask', 'uia.control': 'deny' }
    })

    // Idempotente.
    const first = state.data.get('permissions')
    storeMod.STORE_MIGRATIONS['1.7.0'](store)
    expect(state.data.get('permissions')).toEqual(first)
  })

  it('1.8.0 adiciona memória ligada por padrão e preserva a escolha existente', () => {
    const store = fakeStore()

    storeMod.STORE_MIGRATIONS['1.8.0'](store)
    expect(state.data.get('memory')).toEqual({
      enabled: true,
      autoExtract: true,
      lastConsolidationAt: null
    })

    state.data.set('memory', { enabled: false, autoExtract: false, lastConsolidationAt: 123 })
    storeMod.STORE_MIGRATIONS['1.8.0'](store)
    expect(state.data.get('memory')).toEqual({
      enabled: false,
      autoExtract: false,
      lastConsolidationAt: 123
    })
  })

  it('1.9.0 adiciona pesquisa ligada por padrão e preserva a escolha existente', () => {
    const store = fakeStore()

    storeMod.STORE_MIGRATIONS['1.9.0'](store)
    expect(state.data.get('web')).toEqual({ enabled: true })

    state.data.set('web', { enabled: false })
    storeMod.STORE_MIGRATIONS['1.9.0'](store)
    expect(state.data.get('web')).toEqual({ enabled: false })

    // Idempotente e valor inválido cai no default seguro (ligado).
    state.data.set('web', { enabled: 'não' })
    storeMod.STORE_MIGRATIONS['1.9.0'](store)
    expect(state.data.get('web')).toEqual({ enabled: true })
  })

  it('store corrompido não lança', async () => {
    state.fail = true
    vi.resetModules()

    const mod = await import('./store')

    expect(mod.isStoreAvailable()).toBe(false)
    expect(state.logError).toHaveBeenCalledWith(
      'store',
      expect.stringContaining('config.json'),
      expect.any(Error)
    )
    expect(mod.getStoreSnapshot()).toEqual(mod.defaultAbsolemConfig())

    expect(mod.setStoreValue('theme', { primaryColor: '#abcdef', presetId: 'neon' })).toEqual({
      success: true
    })
    expect(mod.getStoreSnapshot().theme).toEqual({
      ...defaultTheme(),
      primaryColor: '#abcdef',
      presetId: 'neon'
    })
  })
})
