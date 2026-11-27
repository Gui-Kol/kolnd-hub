import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbsolemConfig } from '../../shared/config'
import { IPC } from '../../shared/ipc'
import { defaultTheme } from '../../shared/theme'

type Handler = (event: unknown, payload: unknown) => unknown

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  visible: false,
  destroyed: false,
  layout: {} as Record<string, unknown>,
  shortcut: { registered: true, accelerator: 'Control+Alt+A' },
  registerAccepted: true,
  lastRegisterInput: undefined as string | undefined,
  sent: [] as Array<{ channel: string; payload: unknown }>,
  config: {} as Record<string, unknown>,
  onTrigger: undefined as (() => void) | undefined,
  displayListener: undefined as (() => void) | undefined
}))

const window = {
  isDestroyed: () => state.destroyed,
  webContents: {
    send: (channel: string, payload: unknown) => {
      state.sent.push({ channel, payload })
    }
  }
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      state.handlers.set(channel, handler)
    }
  },
  app: { once: vi.fn() },
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}))

vi.mock('../overlay/overlayWindow', () => ({
  getOverlayWindow: () => window,
  showOverlayWindow: () => {
    state.visible = true
    return window
  },
  hideOverlayWindow: () => {
    state.visible = false
  },
  isOverlayVisible: () => state.visible,
  setOverlayLayout: (input: unknown) => {
    state.layout = input as Record<string, unknown>
    return state.layout
  },
  getOverlayLayout: () => state.layout,
  reapplyOverlayBounds: vi.fn(),
  destroyOverlayWindow: vi.fn()
}))

vi.mock('../overlay/shortcut', () => ({
  registerOverlayShortcut: (
    accelerator: string,
    onTrigger: () => void
  ): { registered: boolean; accelerator: string } => {
    state.lastRegisterInput = accelerator
    if (state.registerAccepted) state.shortcut = { registered: true, accelerator }
    state.onTrigger = onTrigger
    return state.shortcut
  },
  getShortcutStatus: () => state.shortcut,
  unregisterOverlayShortcut: vi.fn()
}))

vi.mock('../overlay/displays', () => ({
  watchDisplayChanges: (listener: () => void) => {
    state.displayListener = listener
    return vi.fn()
  }
}))

vi.mock('../overlay/foreground', () => ({
  getForegroundWindow: async () => null,
  shouldHideForFullscreen: () => false
}))

vi.mock('../store', () => ({
  getStoreValue: (key: string) => state.config[key],
  setStoreValue: (key: string, value: unknown) => {
    state.config[key] = value
    return { success: true }
  }
}))

vi.mock('../shutdown', () => ({
  registerShutdownHook: vi.fn()
}))

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

type ControllerModule = typeof import('../overlay/controller')
type IpcModule = typeof import('./overlay')

let controller: ControllerModule
let ipc: IpcModule

function makeConfig(): AbsolemConfig {
  return {
    overlay: {
      visible: false,
      position: 'bottom-left',
      offsetX: 0,
      offsetY: 0,
      width: 320,
      height: 360,
      shortcut: 'Control+Alt+A',
      hideOnFullscreen: true
    },
    theme: defaultTheme(),
    voice: {
      enabled: false,
      inputDeviceId: null,
      outputDeviceId: null,
      outputVolume: 1,
      maxSessionMinutes: 15,
      silenceTimeoutSeconds: 20
    },
    gemini: {
      model: 'gemini-2.0-flash',
      liveModel: 'gemini-3.8-live',
      temperature: 0.7,
      monthlyTokenCap: 2_000_000
    },
    privacy: {
      telemetry: false,
      screen: { mode: 'off', blocklist: [], proactive: false }
    },
    permissions: {
      microphone: false,
      paused: false,
      categories: {
        'apps.launch': 'ask',
        'apps.close': 'ask',
        'files.read': 'ask',
        'files.write': 'ask',
        'system.power': 'deny',
        'uia.control': 'deny',
        'web.search': 'allow'
      }
    },
    ui: { language: 'pt-BR', reducedMotion: false, startMinimized: false },
    usage: { days: {}, warnedMonths: [] },
    chat: { turns: [] },
    memory: { enabled: true, autoExtract: true, lastConsolidationAt: null, note: '' },
    web: { enabled: true },
    routines: []
  }
}

function makeContext() {
  return {
    getMainWindow: () => null,
    getOverlayWindow: () => window as never,
    getStoreSnapshot: () => state.config as unknown as AbsolemConfig,
    isQuitting: () => false
  }
}

function handlerFor(channel: string): Handler {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler ausente para ${channel}`)
  return handler
}

beforeEach(async () => {
  vi.resetModules()
  state.handlers.clear()
  state.visible = false
  state.destroyed = false
  state.layout = {}
  state.shortcut = { registered: true, accelerator: 'Control+Alt+A' }
  state.registerAccepted = true
  state.lastRegisterInput = undefined
  state.sent = []
  state.config = makeConfig() as unknown as Record<string, unknown>
  state.onTrigger = undefined
  state.displayListener = undefined

  controller = await import('../overlay/controller')
  controller.resetOverlayControllerForTests()
  ipc = await import('./overlay')
  controller.initializeOverlay(makeContext())
  ipc.registerOverlayIpc()
})

describe('IPC do overlay', () => {
  it('payload inválido devolve ok false', () => {
    expect(() =>
      handlerFor(IPC.overlaySetInteractive)(undefined, { interactive: 'sim' })
    ).not.toThrow()
    expect(handlerFor(IPC.overlaySetInteractive)(undefined, { interactive: 'sim' })).toMatchObject({
      ok: false
    })
    expect(handlerFor(IPC.overlaySetLayout)(undefined, 'nope')).toMatchObject({ ok: false })
    expect(handlerFor(IPC.overlayShow)(undefined, { extra: true })).toMatchObject({ ok: false })
  })

  it('toggle alterna visibilidade', () => {
    const toggle = handlerFor(IPC.overlayToggle)

    expect(toggle(undefined, undefined)).toMatchObject({ ok: true, status: { visible: true } })
    expect(toggle(undefined, undefined)).toMatchObject({ ok: true, status: { visible: false } })
  })

  it('status emitido após show', () => {
    const result = handlerFor(IPC.overlayShow)(undefined, undefined)

    expect(result).toMatchObject({ ok: true, status: { visible: true } })
    expect(state.sent).toContainEqual({
      channel: IPC.overlayStatusChanged,
      payload: expect.objectContaining({ visible: true })
    })
  })

  it('set-shortcut aplica e persiste o atalho normalizado', () => {
    const result = handlerFor(IPC.overlaySetShortcut)(undefined, { shortcut: 'ctrl+shift+k' })

    expect(result).toMatchObject({
      ok: true,
      status: { shortcut: { registered: true, accelerator: 'Control+Shift+K' } }
    })
    expect(state.lastRegisterInput).toBe('Control+Shift+K')
    expect(state.config.overlay).toMatchObject({ shortcut: 'Control+Shift+K' })
    expect(state.sent).toContainEqual({
      channel: IPC.overlayStatusChanged,
      payload: expect.objectContaining({
        shortcut: { registered: true, accelerator: 'Control+Shift+K' }
      })
    })
  })

  it('set-shortcut inválido não persiste', () => {
    const result = handlerFor(IPC.overlaySetShortcut)(undefined, { shortcut: 'K' })

    expect(result).toMatchObject({ ok: false })
    expect(state.config.overlay).toMatchObject({ shortcut: 'Control+Alt+A' })
  })

  it('set-shortcut em conflito mantém o anterior', () => {
    state.registerAccepted = false
    const result = handlerFor(IPC.overlaySetShortcut)(undefined, {
      shortcut: 'Control+Shift+K'
    })

    expect(result).toMatchObject({ ok: false })
    expect(state.config.overlay).toMatchObject({ shortcut: 'Control+Alt+A' })
  })

  it('emite shown só na transição oculto → visível', async () => {
    const events = await import('../voice/overlayEvents')
    const shown = vi.fn()
    events.onOverlayShown(shown)

    handlerFor(IPC.overlayShow)(undefined, undefined)
    expect(shown).toHaveBeenCalledTimes(1)

    handlerFor(IPC.overlayShow)(undefined, undefined)
    expect(shown).toHaveBeenCalledTimes(1)

    handlerFor(IPC.overlayHide)(undefined, undefined)
    handlerFor(IPC.overlayShow)(undefined, undefined)
    expect(shown).toHaveBeenCalledTimes(2)
  })
})
