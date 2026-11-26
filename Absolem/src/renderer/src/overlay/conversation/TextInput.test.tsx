// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextInput, type TextInputApi } from './TextInput'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

function makeApi(sendImplementation?: TextInputApi['send']): {
  api: TextInputApi
  send: ReturnType<typeof vi.fn>
  setInputMode: ReturnType<typeof vi.fn>
} {
  const send = vi.fn(sendImplementation ?? (async () => ({ ok: true as const })))
  const setInputMode = vi.fn(async () => ({ ok: true as const }))
  return { api: { send, setInputMode }, send, setInputMode }
}

function setValue(element: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function keyDown(element: HTMLInputElement, key: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
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
})

describe('entrada de texto do overlay', () => {
  it('Enter envia', async () => {
    const { api, send } = makeApi()
    const onSend = vi.fn()
    await act(async () => {
      root.render(
        <TextInput api={api} onSend={onSend} onClose={vi.fn()} newRequestId={() => 'req-1'} />
      )
    })
    const input = container.querySelector<HTMLInputElement>('#overlay-text-input')
    if (!input) throw new Error('input ausente')
    await act(async () => {
      setValue(input, 'olá')
    })
    await act(async () => {
      keyDown(input, 'Enter')
    })
    expect(send).toHaveBeenCalledWith('req-1', 'olá')
    expect(onSend).toHaveBeenCalledWith('req-1', 'olá')
  })

  it('campo vazio não envia', async () => {
    const { api, send } = makeApi()
    await act(async () => {
      root.render(<TextInput api={api} onClose={vi.fn()} />)
    })
    const input = container.querySelector<HTMLInputElement>('#overlay-text-input')
    if (!input) throw new Error('input ausente')
    await act(async () => {
      keyDown(input, 'Enter')
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('desabilitado durante envio', async () => {
    let release: ((value: { ok: true }) => void) | null = null
    const { api, send } = makeApi(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    await act(async () => {
      root.render(<TextInput api={api} onClose={vi.fn()} newRequestId={() => 'req-2'} />)
    })
    const input = container.querySelector<HTMLInputElement>('#overlay-text-input')
    if (!input) throw new Error('input ausente')
    await act(async () => {
      setValue(input, 'primeira')
    })
    await act(async () => {
      keyDown(input, 'Enter')
    })
    expect(input.disabled).toBe(true)
    await act(async () => {
      keyDown(input, 'Enter')
    })
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => {
      release?.({ ok: true })
      await Promise.resolve()
    })
  })

  it('Esc fecha', async () => {
    const { api, setInputMode } = makeApi()
    const onClose = vi.fn()
    await act(async () => {
      root.render(<TextInput api={api} onClose={onClose} />)
    })
    const input = container.querySelector<HTMLInputElement>('#overlay-text-input')
    if (!input) throw new Error('input ausente')
    await act(async () => {
      keyDown(input, 'Escape')
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setInputMode).toHaveBeenLastCalledWith(false)
  })
})
