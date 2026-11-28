// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDeltaPush, ChatDonePush, ChatErrorPush } from '../../../../shared/gemini'
import type { VoiceState } from '../../../../shared/voice'
import { ConversationLayer, type ConversationApi } from './ConversationLayer'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

interface FakeApi {
  api: ConversationApi
  emitDelta: (push: ChatDeltaPush) => void
  emitDone: (push: ChatDonePush) => void
  emitError: (push: ChatErrorPush) => void
  interrupt: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  openSettings: ReturnType<typeof vi.fn>
}

function makeApi(): FakeApi {
  const deltas = new Set<(push: ChatDeltaPush) => void>()
  const dones = new Set<(push: ChatDonePush) => void>()
  const errors = new Set<(push: ChatErrorPush) => void>()
  const interrupt = vi.fn(async () => ({ ok: true }))
  const cancel = vi.fn(async () => ({ ok: true }))
  const openSettings = vi.fn(async () => ({ ok: true }))
  const api: ConversationApi = {
    onDelta: (listener) => {
      deltas.add(listener)
      return () => deltas.delete(listener)
    },
    onDone: (listener) => {
      dones.add(listener)
      return () => dones.delete(listener)
    },
    onError: (listener) => {
      errors.add(listener)
      return () => errors.delete(listener)
    },
    interrupt,
    cancel,
    openSettings,
    requestScreen: vi.fn(async () => ({ ok: true }))
  }
  return {
    api,
    emitDelta: (push) => {
      for (const listener of deltas) listener(push)
    },
    emitDone: (push) => {
      for (const listener of dones) listener(push)
    },
    emitError: (push) => {
      for (const listener of errors) listener(push)
    },
    interrupt,
    cancel,
    openSettings
  }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label
  )
  if (!found) throw new Error(`botão ausente: ${label}`)
  return found as HTMLButtonElement
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.useRealTimers()
})

describe('camada conversacional do overlay', () => {
  it('mostra status de cada estado', async () => {
    const fake = makeApi()
    const states: Array<[VoiceState, string]> = [
      ['off', 'Voz desligada'],
      ['listening', 'Ouvindo'],
      ['thinking', 'Pensando'],
      ['speaking', 'Falando'],
      ['error', 'Erro na voz']
    ]
    for (const [state, label] of states) {
      await act(async () => {
        root.render(<ConversationLayer voiceState={state} api={fake.api} />)
      })
      expect(container.querySelector('[role="status"]')?.textContent).toBe(label)
    }
  })

  it('delta concatena no balão', async () => {
    const fake = makeApi()
    await act(async () => {
      root.render(<ConversationLayer voiceState="thinking" requestId="r1" api={fake.api} />)
    })
    await act(async () => {
      fake.emitDelta({ requestId: 'r1', text: 'Olá' })
      fake.emitDelta({ requestId: 'r1', text: ' mundo' })
    })
    expect(container.querySelector('[data-conversation-response]')?.textContent).toBe('Olá mundo')
  })

  it('não interpreta HTML', async () => {
    const fake = makeApi()
    await act(async () => {
      root.render(<ConversationLayer voiceState="thinking" requestId="r1" api={fake.api} />)
    })
    await act(async () => {
      fake.emitDelta({ requestId: 'r1', text: '<b>perigo</b>' })
    })
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>perigo</b>')
  })

  it('interromper chama voice:interrupt', async () => {
    const fake = makeApi()
    await act(async () => {
      root.render(<ConversationLayer voiceState="speaking" requestId="r1" api={fake.api} />)
    })
    await act(async () => {
      fake.emitDelta({ requestId: 'r1', text: 'Resposta longa' })
    })
    await act(async () => {
      button(container, 'Interromper').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(fake.interrupt).toHaveBeenCalledTimes(1)
  })

  it('balão fecha após 30 s', async () => {
    vi.useFakeTimers()
    const fake = makeApi()
    await act(async () => {
      root.render(<ConversationLayer voiceState="thinking" requestId="r1" api={fake.api} />)
    })
    await act(async () => {
      fake.emitDelta({ requestId: 'r1', text: 'Some depois' })
    })
    expect(container.querySelector('[data-conversation-response]')).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(container.querySelector('[data-conversation-response]')).toBeNull()
  })
})
