import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc'
import type { ChatSinks, GeminiEngine } from '../gemini/engine'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler)
    }
  }
}))

vi.mock('../gemini/instance', () => ({
  subscribeUsageWarning: () => () => undefined
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

function setup(send: GeminiEngine['send']) {
  const overlay = fakeWindow()
  const main = fakeWindow()
  const cancel = vi.fn(() => true)
  const engine = { send, cancel } as unknown as GeminiEngine
  registerChatIpc(
    {
      getMainWindow: () => main as never,
      getOverlayWindow: () => overlay as never,
      getStoreSnapshot: () => ({}) as never,
      isQuitting: () => false
    },
    engine
  )
  return { overlay, main, cancel }
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
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const send = vi.fn(async (_requestId: string, _text: string, sinks: ChatSinks) => {
      await gate
      sinks.delta('olá')
      sinks.done({ input: 1, output: 2, total: 3, estimated: false })
    })
    setup(send)

    const result = handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })

    expect(result).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith('r1', 'oi', expect.any(Object))
    expect(state.sent).toHaveLength(0)

    release()
    await gate
    await Promise.resolve()
    await Promise.resolve()

    const channels = state.sent.map((entry) => entry.channel)
    expect(channels).toEqual([IPC.chatDelta, IPC.chatDelta, IPC.chatDone, IPC.chatDone])
    expect(state.sent[0]?.payload).toEqual({ requestId: 'r1', text: 'olá' })
    expect(state.sent[2]?.payload).toEqual({
      requestId: 'r1',
      usage: { input: 1, output: 2, total: 3, estimated: false }
    })
  })

  it('erro do motor vira chat:error sem objeto cru do SDK', async () => {
    setup(async (_requestId: string, _text: string, sinks: ChatSinks) => {
      sinks.error({
        kind: 'quota',
        message: 'Cota do Gemini esgotada para agora. Tente mais tarde.'
      })
    })

    handler(IPC.chatSend)({}, { requestId: 'r1', text: 'oi' })
    await Promise.resolve()

    expect(state.sent).toEqual([
      {
        channel: IPC.chatError,
        payload: {
          requestId: 'r1',
          kind: 'quota',
          message: 'Cota do Gemini esgotada para agora. Tente mais tarde.'
        }
      },
      {
        channel: IPC.chatError,
        payload: {
          requestId: 'r1',
          kind: 'quota',
          message: 'Cota do Gemini esgotada para agora. Tente mais tarde.'
        }
      }
    ])
  })

  it('chat:cancel valida payload e cancela pelo requestId', () => {
    const { cancel } = setup(
      async (_requestId: string, _text: string, _sinks: ChatSinks) => undefined
    )

    expect(handler(IPC.chatCancel)({}, { requestId: '' })).toEqual({
      ok: false,
      error: 'Payload inválido para chat:cancel.'
    })
    expect(cancel).not.toHaveBeenCalled()

    expect(handler(IPC.chatCancel)({}, { requestId: 'r1' })).toEqual({ ok: true })
    expect(cancel).toHaveBeenCalledWith('r1')
  })
})
