import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
  live: {
    instances: [] as Array<unknown>,
    autoComplete: true,
    failConnect: false
  }
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
      onToolCall?: (calls: Array<{ name: string; args?: unknown }>) => void
      onTurnComplete?: () => void
      onError?: (error: { kind: string; message: string }) => void
    }
    readonly closeReasons: string[] = []
    lastText = ''
    constructor(options: {
      handlers: {
        onTranscript?: (event: { role: 'model'; text: string; final: boolean }) => void
        onToolCall?: (calls: Array<{ name: string; args?: unknown }>) => void
        onTurnComplete?: () => void
        onError?: (error: { kind: string; message: string }) => void
      }
    }) {
      this.handlers = options.handlers
      state.live.instances.push(this)
    }
    connect = vi.fn(async () => {
      if (state.live.failConnect) throw new Error('falha fake de conexão')
    })
    sendText = vi.fn((text: string) => {
      this.lastText = text
      if (state.live.autoComplete) this.complete(`eco: ${text}`)
    })
    complete = (text: string): void => {
      this.handlers.onTranscript?.({ role: 'model', text, final: true })
      this.handlers.onTurnComplete?.()
    }
    emitToolCall = (calls: Array<{ name: string; args?: unknown }>): void => {
      this.handlers.onToolCall?.(calls)
    }
    emitError = (kind: string, message = 'falha fake'): void => {
      this.handlers.onError?.({ kind, message })
    }
    sendToolResponse = vi.fn()
    close = vi.fn((reason: string) => {
      this.closeReasons.push(reason)
    })
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

interface FakeLive {
  lastText: string
  closeReasons: string[]
  close: { mock: { calls: unknown[] } }
  complete: (text: string) => void
  emitToolCall: (calls: Array<{ name: string; args?: unknown }>) => void
  emitError: (kind: string, message?: string) => void
  sendToolResponse: { mock: { calls: unknown[][] } }
}

function live(index: number): FakeLive {
  const instance = state.live.instances[index]
  if (!instance) throw new Error(`sessão fake ausente: ${index}`)
  return instance as FakeLive
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  state.sent.length = 0
  state.live.instances.length = 0
  state.live.autoComplete = true
  state.live.failConnect = false
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

  it('novo requestId encerra o anterior sem delta/done tardio', async () => {
    setup()
    state.live.autoComplete = false

    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'primeiro' })
    await flushAsync()
    handler(IPC.chatSend)({}, { requestId: 'r2', text: 'segundo' })
    await flushAsync()

    expect(live(0).closeReasons).toEqual(['superseded'])
    live(0).complete('resposta tardia do primeiro')
    expect(
      state.sent.some((entry) => JSON.stringify(entry.payload).includes('tardia do primeiro'))
    ).toBe(false)

    live(1).complete('resposta do segundo')
    expect(state.sent.map((entry) => entry.channel)).toEqual([
      IPC.chatDelta,
      IPC.chatDelta,
      IPC.chatDone,
      IPC.chatDone
    ])
    for (const entry of state.sent) {
      expect(entry.payload).toMatchObject({ requestId: 'r2' })
    }
    expect(live(0).closeReasons).toEqual(['superseded'])
    expect(live(1).closeReasons).toEqual(['turn-complete'])
  })

  it('cancel antes da resposta não emite delta/erro e fecha uma vez', async () => {
    setup()
    state.live.autoComplete = false

    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })
    await flushAsync()
    expect(handler(IPC.chatCancel)({}, { requestId: 'r1' })).toEqual({ ok: true })
    expect(handler(IPC.chatCancel)({}, { requestId: 'r1' })).toEqual({ ok: true })

    live(0).complete('não deve aparecer')
    live(0).emitError('network', 'não deve aparecer')
    await flushAsync()

    expect(state.sent).toHaveLength(0)
    expect(live(0).closeReasons).toEqual(['cancelled'])
  })

  it('erro de conexão depois do cancelamento não vira chat:error', async () => {
    setup()
    state.live.failConnect = true

    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })
    handler(IPC.chatCancel)({}, { requestId: 'r1' })
    await flushAsync()

    expect(state.sent).toHaveLength(0)
    expect(live(0).closeReasons).toEqual(['cancelled'])
  })

  it('tool response resolvida depois do cancelamento não é reenviada', async () => {
    setup()
    state.live.autoComplete = false

    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })
    await flushAsync()
    live(0).emitToolCall([{ name: 'get_current_time', args: {} }])
    handler(IPC.chatCancel)({}, { requestId: 'r1' })
    await flushAsync()

    expect(live(0).sendToolResponse.mock.calls).toHaveLength(0)
  })

  it('mesmo requestId concorrente abre uma única sessão', async () => {
    setup()
    state.live.autoComplete = false

    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })
    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi de novo' })
    await flushAsync()

    expect(state.live.instances).toHaveLength(1)
    expect(handler(IPC.chatCancel)({}, { requestId: 'r1' })).toEqual({ ok: true })
    expect(live(0).closeReasons).toEqual(['cancelled'])
  })

  it('100 turnos concorrentes terminam sem deadlock e só o último responde', async () => {
    setup()
    state.live.autoComplete = false
    const startedAt = performance.now()

    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        Promise.resolve(
          handler(IPC.chatSend)({}, { requestId: `r${index}`, text: `pergunta ${index}` })
        )
      )
    )
    await flushAsync()

    const elapsed = performance.now() - startedAt
    expect(state.live.instances).toHaveLength(100)
    expect(elapsed).toBeLessThan(2_000)
    for (let index = 0; index < 99; index += 1) {
      expect(live(index).closeReasons).toEqual(['superseded'])
    }
    expect(live(99).closeReasons).toEqual([])

    state.sent.length = 0
    live(99).complete('resposta final')
    await flushAsync()
    expect(state.sent.filter((entry) => entry.channel === IPC.chatDelta)).toHaveLength(2)
    expect(state.sent.filter((entry) => entry.channel === IPC.chatDone)).toHaveLength(2)
    for (const entry of state.sent) {
      expect(entry.payload).toMatchObject({ requestId: 'r99' })
    }
    expect(live(99).closeReasons).toEqual(['turn-complete'])
  })
})
