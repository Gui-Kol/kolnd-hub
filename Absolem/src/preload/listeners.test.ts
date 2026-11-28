import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AbsolemApi } from '../shared/ipc'

/**
 * Listeners do preload (task 05).
 *
 * O renderer remonta o overlay e a conversa várias vezes; cada assinatura
 * precisa remover exatamente o handler registrado. Nenhum listener sobrevive
 * ao unmount e um segundo `unsubscribe` não mexe mais na lista do Electron.
 */

const state = vi.hoisted(() => ({
  listeners: new Map<string, Set<(...args: unknown[]) => void>>(),
  exposed: null as null | { key: string; value: unknown },
  invoke: vi.fn(async () => undefined),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      state.exposed = { key, value }
    }
  },
  ipcRenderer: {
    on: (channel: string, handler: (...args: unknown[]) => void) => {
      const set = state.listeners.get(channel) ?? new Set()
      set.add(handler)
      state.listeners.set(channel, set)
    },
    removeListener: (channel: string, handler: (...args: unknown[]) => void) => {
      state.listeners.get(channel)?.delete(handler)
    },
    invoke: state.invoke,
    send: state.send
  }
}))

await import('./index')

function api(): AbsolemApi {
  if (!state.exposed || state.exposed.key !== 'absolem') {
    throw new Error('preload não expôs a API')
  }
  return state.exposed.value as AbsolemApi
}

function count(channel: string): number {
  return state.listeners.get(channel)?.size ?? 0
}

function emit(channel: string, payload: unknown): void {
  for (const handler of [...(state.listeners.get(channel) ?? [])]) handler({}, payload)
}

beforeEach(() => {
  state.listeners.clear()
  state.invoke.mockClear()
  state.send.mockClear()
})

describe('listeners do preload', () => {
  it('expõe apenas a API no contextBridge', () => {
    expect(state.exposed?.key).toBe('absolem')
    expect(api().chat.send).toBeTypeOf('function')
    expect((globalThis as { require?: unknown }).require).toBeUndefined()
  })

  it('100 ciclos de mount/unmount não acumulam listeners', () => {
    const subscriptions: Array<{
      channel: string
      subscribe: (listener: (payload: unknown) => void) => () => void
    }> = [
      {
        channel: 'overlay:status-changed',
        subscribe: (listener) => api().onOverlayStatusChanged(listener as never)
      },
      { channel: 'avatar:apply', subscribe: (listener) => api().avatar.onApply(listener as never) },
      {
        channel: 'theme:changed',
        subscribe: (listener) => api().onThemeChanged(listener as never)
      },
      {
        channel: 'gemini:usage-warning',
        subscribe: (listener) => api().gemini.onUsageWarning(listener as never)
      },
      { channel: 'chat:delta', subscribe: (listener) => api().chat.onDelta(listener as never) },
      { channel: 'chat:done', subscribe: (listener) => api().chat.onDone(listener as never) },
      { channel: 'chat:error', subscribe: (listener) => api().chat.onError(listener as never) },
      {
        channel: 'capture:request',
        subscribe: (listener) => api().capture.onRequest(listener as never)
      },
      {
        channel: 'capture:indicator',
        subscribe: (listener) => api().capture.onIndicator(listener as never)
      },
      {
        channel: 'search:indicator',
        subscribe: (listener) => api().search.onIndicator(listener as never)
      },
      { channel: 'voice:state', subscribe: (listener) => api().voice.onState(listener as never) },
      { channel: 'voice:audio', subscribe: (listener) => api().voice.onAudio(listener as never) },
      {
        channel: 'voice:transcript',
        subscribe: (listener) => api().voice.onTranscript(listener as never)
      }
    ]

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const disposers = subscriptions.map(({ channel, subscribe }) => {
        const listener = (): void => undefined
        const dispose = subscribe(listener)
        expect(count(channel)).toBe(1)
        return { channel, dispose }
      })
      for (const { channel, dispose } of disposers) {
        dispose()
        expect(count(channel)).toBe(0)
      }
    }

    for (const { channel } of subscriptions) expect(count(channel)).toBe(0)
  })

  it('unsubscribe é idempotente e entrega o payload tipado', () => {
    const received: unknown[] = []
    const unsubscribe = api().chat.onDelta((push) => received.push(push))

    expect(count('chat:delta')).toBe(1)
    emit('chat:delta', { requestId: 'r1', text: 'oi' })
    expect(received).toEqual([{ requestId: 'r1', text: 'oi' }])

    unsubscribe()
    unsubscribe()
    expect(count('chat:delta')).toBe(0)
    emit('chat:delta', { requestId: 'r1', text: 'tardio' })
    expect(received).toHaveLength(1)
  })

  it('mantém listeners independentes por assinante', () => {
    const first: unknown[] = []
    const second: unknown[] = []
    const offFirst = api().voice.onAudio((push) => first.push(push))
    const offSecond = api().voice.onAudio((push) => second.push(push))

    emit('voice:audio', { data: new Uint8Array([1, 2]), sampleRate: 24_000 })
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)

    offFirst()
    emit('voice:audio', { data: new Uint8Array([3]), sampleRate: 24_000 })
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    offSecond()
    expect(count('voice:audio')).toBe(0)
  })
})
