import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  },
  globalShortcut: { register: () => true, unregister: () => undefined },
  app: { on: () => undefined, isPackaged: false },
  dialog: { showMessageBox: async () => ({ response: 0 }) },
  shell: { openExternal: async () => undefined }
}))

vi.mock('../gemini/instance', () => ({
  subscribeUsageWarning: () => () => undefined,
  getUsageMeter: () => ({
    checkBudget: () => undefined,
    record: () => undefined,
    snapshot: () => ({ today: 0, month: 0, cap: 2_000_000, percent: 0 })
  })
}))

vi.mock('../store', () => ({
  getStoreSnapshot: () => ({
    gemini: { liveModel: 'gemini-3.8-live', temperature: 0.7 },
    ui: { language: 'pt-BR' },
    web: { enabled: true }
  })
}))

vi.mock('../secrets', () => ({ getApiKey: () => 'chave-de-teste' }))
vi.mock('../actions/instance', () => ({ getActionsRuntime: () => null }))
vi.mock('../search/instance', () => ({ getSearchRuntime: () => null }))
vi.mock('../capture/instance', () => ({ getCaptureRuntime: () => null }))
vi.mock('../gemini/sdk', () => ({ SdkLiveTransport: class {} }))
vi.mock('../gemini/live', () => ({
  LiveSession: class {
    readonly handlers: {
      onTranscript?: (event: { role: 'model'; text: string; final: boolean }) => void
      onTurnComplete?: () => void
    }
    constructor(options: {
      handlers: {
        onTranscript?: (event: { role: 'model'; text: string; final: boolean }) => void
        onTurnComplete?: () => void
      }
    }) {
      this.handlers = options.handlers
    }
    connect = vi.fn(async () => undefined)
    sendText = vi.fn((text: string) => {
      this.handlers.onTranscript?.({ role: 'model', text: `eco: ${text}`, final: true })
      this.handlers.onTurnComplete?.()
    })
    sendToolResponse = vi.fn()
    close = vi.fn()
  }
}))

const { registerChatIpc } = await import('./chat')

interface FakeWindow {
  isDestroyed: () => boolean
  webContents: { send: (channel: string, payload: unknown) => void }
}

function fakeWindow(): FakeWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => state.sent.push({ channel, payload })
    }
  }
}

function setup() {
  const overlay = fakeWindow()
  const main = fakeWindow()
  registerChatIpc({
    getMainWindow: () => main as never,
    getOverlayWindow: () => overlay as never,
    getStoreSnapshot: () => ({}) as never,
    isQuitting: () => false
  })
  return { overlay, main }
}

function handler(channel: string): (event: unknown, payload: unknown) => unknown {
  const found = state.handlers.get(channel)
  if (!found) throw new Error(`handler ausente: ${channel}`)
  return found
}

beforeEach(() => {
  state.sent.length = 0
})

describe('chat por IPC', () => {
  it('chat:send responde antes da geração e empurra delta/done', async () => {
    setup()

    const result = handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })

    expect(result).toEqual({ ok: true })
    expect(state.sent).toHaveLength(0)

    await Promise.resolve()
    await Promise.resolve()

    const channels = state.sent.map((entry) => entry.channel)
    expect(channels).toEqual([IPC.chatDelta, IPC.chatDelta, IPC.chatDone, IPC.chatDone])
    expect(state.sent[0]?.payload).toEqual({ requestId: 'r1', text: 'eco: oi' })
    expect(state.sent[2]?.payload).toEqual({
      requestId: 'r1',
      usage: { input: 0, output: 0, total: 0, estimated: false }
    })
  })

  it('responde pelo Live sem objeto cru do SDK', async () => {
    setup()

    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })
    await Promise.resolve()

    expect(state.sent.map((entry) => entry.channel)).toEqual([
      IPC.chatDelta,
      IPC.chatDelta,
      IPC.chatDone,
      IPC.chatDone
    ])
  })

  it('chat:cancel valida payload e cancela pelo requestId', () => {
    setup()

    expect(handler(IPC.chatCancel)({}, { requestId: '' })).toEqual({
      ok: false,
      error: 'Payload inválido para chat:cancel.'
    })
    expect(state.sent).toHaveLength(0)

    expect(handler(IPC.chatCancel)({}, { requestId: 'r1' })).toEqual({ ok: true })
  })
})
