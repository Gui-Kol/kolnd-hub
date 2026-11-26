// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeminiConfig } from '../../../shared/config'
import type { GeminiTestKeyOutcome } from '../../../shared/gemini'
import { KeyTab, type KeyTabApi } from './KeyTab'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

const SECRET = 'chave-super-secreta-que-nao-pode-vazar-123'

function makeApi(
  options: {
    configured?: boolean
    percent?: number
    testOutcome?: GeminiTestKeyOutcome
  } = {}
): {
  api: KeyTabApi
  setKey: ReturnType<typeof vi.fn>
  clearKey: ReturnType<typeof vi.fn>
  testKey: ReturnType<typeof vi.fn>
  setGeminiConfig: ReturnType<typeof vi.fn>
} {
  const configured = options.configured ?? true
  const setKey = vi.fn(async () => ({ ok: true as const }))
  const clearKey = vi.fn(async () => ({ ok: true as const }))
  const testKey = vi.fn(async () => ({
    ok: true as const,
    result:
      options.testOutcome ??
      ({
        ok: true,
        model: 'gemini-2.0-flash',
        durationMs: 42,
        usage: { input: 1, output: 1, total: 2, estimated: false }
      } satisfies GeminiTestKeyOutcome)
  }))
  const setGeminiConfig = vi.fn(async () => ({ ok: true as const }))
  const api: KeyTabApi = {
    status: vi.fn(async () => ({
      ok: true as const,
      status: {
        configured,
        model: 'gemini-2.0-flash',
        lastError: null,
        disabledReason: null,
        usage: {
          today: 0,
          month: 80,
          cap: 100,
          percent: options.percent ?? 80
        }
      }
    })),
    setKey,
    clearKey,
    testKey,
    getGeminiConfig: vi.fn(async () => ({
      ok: true as const,
      key: 'gemini' as const,
      value: {
        model: 'gemini-2.0-flash',
        temperature: 0.7,
        monthlyTokenCap: 2_000_000
      } satisfies GeminiConfig
    })),
    setGeminiConfig
  }
  return { api, setKey, clearKey, testKey, setGeminiConfig }
}

function setInput(element: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  descriptor?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === label
  )
  if (!found) throw new Error(`botão ausente: ${label}`)
  return found as HTMLButtonElement
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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

describe('aba Chave e custo', () => {
  it('nunca renderiza a chave', async () => {
    const { api, setKey } = makeApi()
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    const input = container.querySelector<HTMLInputElement>('#gemini-key')
    if (!input) throw new Error('campo ausente')
    expect(input.type).toBe('password')
    expect(input.value).toBe('')
    await act(async () => {
      setInput(input, SECRET)
    })
    await act(async () => {
      button(container, 'Salvar chave').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(setKey).toHaveBeenCalledWith(SECRET)
    expect(container.textContent).not.toContain(SECRET)
    expect(container.querySelector<HTMLInputElement>('#gemini-key')?.value).toBe('')
  })

  it('salvar chama canal', async () => {
    const { api, setKey } = makeApi()
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    const input = container.querySelector<HTMLInputElement>('#gemini-key')
    if (!input) throw new Error('campo ausente')
    await act(async () => {
      setInput(input, 'chave-valida-12345')
    })
    await act(async () => {
      button(container, 'Salvar chave').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(setKey).toHaveBeenCalledWith('chave-valida-12345')
  })

  it('erro 401 mostra mensagem auth', async () => {
    const { api } = makeApi({
      testOutcome: {
        ok: false,
        error: { kind: 'auth', message: '401 Unauthorized' }
      }
    })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Testar conexão').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(container.textContent).toContain('autenticação')
    expect(container.textContent).toContain('401')
  })

  it('80% mostra aviso', async () => {
    const { api } = makeApi({ percent: 80 })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    expect(container.querySelector('[data-usage-warning]')?.textContent).toContain('80%')
  })

  it('remover pede confirmação', async () => {
    const { api, clearKey } = makeApi()
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Remover chave').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(clearKey).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Remover a chave?')

    await act(async () => {
      button(container, 'Confirmar remoção').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    })
    await settle()

    expect(clearKey).toHaveBeenCalledTimes(1)
  })
})
