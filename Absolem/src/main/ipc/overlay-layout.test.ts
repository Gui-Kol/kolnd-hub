import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OverlayLayout } from '../../shared/config'
import { IPC } from '../../shared/ipc'
import { DEFAULT_OVERLAY_LAYOUT, OVERLAY_MARGIN, OVERLAY_WIDTH_MAX } from '../../shared/overlay'
import { computeOverlayBounds } from '../overlay/geometry'

type Handler = (event: unknown, payload: unknown) => unknown

const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  layout: {} as OverlayLayout,
  config: { overlay: {} as OverlayLayout },
  sent: [] as Array<{ channel: string; payload: unknown }>
}))

const window = {
  isDestroyed: () => false,
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
  showOverlayWindow: () => window,
  hideOverlayWindow: vi.fn(),
  isOverlayVisible: () => false,
  setOverlayLayout: (input: OverlayLayout) => {
    state.layout = input
    return state.layout
  },
  getOverlayLayout: () => state.layout,
  reapplyOverlayBounds: vi.fn(),
  destroyOverlayWindow: vi.fn()
}))

vi.mock('../overlay/shortcut', () => ({
  registerOverlayShortcut: vi.fn(),
  getShortcutStatus: () => ({ registered: true, accelerator: 'Control+Alt+A' }),
  unregisterOverlayShortcut: vi.fn()
}))

vi.mock('../overlay/displays', () => ({
  watchDisplayChanges: () => vi.fn()
}))

vi.mock('../overlay/foreground', () => ({
  getForegroundWindow: async () => null,
  shouldHideForFullscreen: () => false
}))

vi.mock('../store', () => ({
  getStoreValue: () => state.config.overlay,
  setStoreValue: (_key: string, value: unknown) => {
    state.config.overlay = value as OverlayLayout
    return { success: true }
  }
}))

vi.mock('../shutdown', () => ({ registerShutdownHook: vi.fn() }))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

type IpcModule = typeof import('./overlay')

let ipc: IpcModule

function handlerFor(channel: string): Handler {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`handler ausente para ${channel}`)
  return handler
}

function applyLayout(payload: unknown): unknown {
  return handlerFor(IPC.overlaySetLayout)(undefined, payload)
}

beforeEach(async () => {
  vi.resetModules()
  state.handlers.clear()
  state.sent = []
  state.layout = { ...DEFAULT_OVERLAY_LAYOUT }
  state.config.overlay = { ...DEFAULT_OVERLAY_LAYOUT }
  ipc = await import('./overlay')
  ipc.registerOverlayIpc()
})

describe('IPC overlay:set-layout', () => {
  it('posição do usuário é persistida', () => {
    const result = applyLayout({ position: 'top-right', offsetX: 8, offsetY: -8 })

    expect(result).toMatchObject({
      ok: true,
      status: { layout: { position: 'top-right', offsetX: 8, offsetY: -8 } }
    })
    expect(state.config.overlay).toMatchObject({
      position: 'top-right',
      offsetX: 8,
      offsetY: -8
    })
    expect(state.sent).toContainEqual({
      channel: IPC.overlayStatusChanged,
      payload: expect.objectContaining({
        layout: expect.objectContaining({ position: 'top-right' })
      })
    })
  })

  it('restaurar padrão volta para bottom-left com margem 16', () => {
    applyLayout({ position: 'top-right', offsetX: 24, offsetY: 16 })
    const result = applyLayout({ ...DEFAULT_OVERLAY_LAYOUT })

    expect(result).toMatchObject({
      ok: true,
      status: {
        layout: {
          position: 'bottom-left',
          offsetX: 0,
          offsetY: 0,
          width: DEFAULT_OVERLAY_LAYOUT.width,
          height: DEFAULT_OVERLAY_LAYOUT.height
        }
      }
    })
    expect(state.config.overlay.position).toBe('bottom-left')

    const bounds = computeOverlayBounds(
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: state.config.overlay.width, height: state.config.overlay.height },
      state.config.overlay.position,
      OVERLAY_MARGIN,
      { offsetX: state.config.overlay.offsetX, offsetY: state.config.overlay.offsetY }
    )
    expect(bounds.x).toBe(16)
    expect(bounds.y).toBe(1080 - DEFAULT_OVERLAY_LAYOUT.height - 16)
  })

  it('tamanho fora da faixa é recusado', () => {
    const tooWide = applyLayout({ width: OVERLAY_WIDTH_MAX + 1 })

    expect(tooWide).toMatchObject({ ok: false })
    expect(state.config.overlay.width).toBe(DEFAULT_OVERLAY_LAYOUT.width)
    expect(state.layout.width).toBe(DEFAULT_OVERLAY_LAYOUT.width)

    const tooTall = applyLayout({ height: 9999 })
    expect(tooTall).toMatchObject({ ok: false })
    expect(state.config.overlay.height).toBe(DEFAULT_OVERLAY_LAYOUT.height)
  })
})
