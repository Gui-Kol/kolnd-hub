import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORE_KEYS } from '../shared/config'

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
    expect(options.projectVersion).toBe('1.2.0')
    expect(Object.keys(options.migrations ?? {})).toEqual(['1.0.0', '1.1.0', '1.2.0'])
  })

  it('valor inválido é normalizado sem perder os válidos', () => {
    state.data.set('theme', { mode: 'neon', accent: '#123456' })
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

    expect(snapshot.theme).toEqual({ mode: 'dark', accent: '#123456' })
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
    expect(snapshot.voice).toEqual({ enabled: true, inputDeviceId: null, outputVolume: 1 })
  })

  it('migração 1.1.0 preserva dados da 1.0.0 e 1.2.0 converte', () => {
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

    expect(mod.setStoreValue('theme', { mode: 'light', accent: '#abcdef' })).toEqual({
      success: true
    })
    expect(mod.getStoreSnapshot().theme).toEqual({ mode: 'light', accent: '#abcdef' })
  })
})
