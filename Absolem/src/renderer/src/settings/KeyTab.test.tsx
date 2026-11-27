// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeminiConfig } from '../../../shared/config'
import type { GeminiTestKeyOutcome } from '../../../shared/gemini'
import { KeyTab, decreaseMonthlyCap, describeTestError, type KeyTabApi } from './KeyTab'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

const SECRET = 'chave-super-secreta-que-nao-pode-vazar-123'

function makeApi(
  options: {
    configured?: boolean
    percent?: number
    testOutcome?: GeminiTestKeyOutcome
    cap?: number
    monthlyTokenCap?: number
    unlimitedUsage?: boolean
    model?: string
    liveModel?: string
  } = {}
): {
  api: KeyTabApi
  setKey: ReturnType<typeof vi.fn>
  clearKey: ReturnType<typeof vi.fn>
  testKey: ReturnType<typeof vi.fn>
  setGeminiConfig: ReturnType<typeof vi.fn>
} {
  const configured = options.configured ?? true
  const cap = options.cap ?? 100
  const monthlyTokenCap = options.monthlyTokenCap ?? 2_000_000
  let persistedUnlimitedUsage = options.unlimitedUsage ?? false
  let persistedModel = options.model ?? 'gemini-2.0-flash'
  let persistedLiveModel = options.liveModel ?? 'gemini-3.8-live'
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
  const setGeminiConfig = vi.fn(async (config: GeminiConfig) => {
    persistedUnlimitedUsage = config.unlimitedUsage
    persistedModel = config.model
    persistedLiveModel = config.liveModel
    return { ok: true as const }
  })
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
          cap,
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
        model: persistedModel,
        liveModel: persistedLiveModel,
        temperature: 0.7,
        monthlyTokenCap,
        unlimitedUsage: persistedUnlimitedUsage
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

function select(container: HTMLElement, id: string): HTMLSelectElement {
  const found = container.querySelector<HTMLSelectElement>(`#${id}`)
  if (!found) throw new Error(`seletor ausente: ${id}`)
  return found
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
  it('mostra os catálogos separados com defaults de texto e Live', async () => {
    const { api } = makeApi({ model: 'gemini-3.8-flash', liveModel: 'gemini-3.8-live' })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    expect(select(container, 'gemini-text-model').value).toBe('gemini-3.8-flash')
    expect(select(container, 'gemini-live-model').value).toBe('gemini-3.8-live')
    expect(
      Array.from(select(container, 'gemini-text-model').options).map((option) => option.value)
    ).not.toContain('gemini-3.8-live')
    expect(
      Array.from(select(container, 'gemini-live-model').options).map((option) => option.value)
    ).not.toContain('gemini-3.8-flash')
  })

  it('persiste a escolha de texto e Live pelo store existente', async () => {
    const { api, setGeminiConfig } = makeApi()
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      const text = select(container, 'gemini-text-model')
      text.value = 'gemini-2.5-flash'
      text.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(setGeminiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash', liveModel: 'gemini-3.8-live' })
    )

    await act(async () => {
      const live = select(container, 'gemini-live-model')
      live.value = 'gemini-3-flash-live'
      live.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(setGeminiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash', liveModel: 'gemini-3-flash-live' })
    )
  })

  it('preserva e identifica modelos customizados', async () => {
    const { api } = makeApi({
      model: 'modelo-texto-customizado',
      liveModel: 'modelo-live-customizado'
    })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    expect(select(container, 'gemini-text-model').value).toBe('modelo-texto-customizado')
    expect(select(container, 'gemini-text-model').options[0]?.textContent).toBe(
      'Personalizado (modelo-texto-customizado)'
    )
    expect(select(container, 'gemini-live-model').value).toBe('modelo-live-customizado')
    expect(select(container, 'gemini-live-model').options[0]?.textContent).toBe(
      'Personalizado (modelo-live-customizado)'
    )
  })

  it('mostra erro quando a seleção não pode ser persistida', async () => {
    const { api, setGeminiConfig } = makeApi()
    setGeminiConfig.mockResolvedValueOnce({ ok: false as const, error: 'falha ao salvar modelo' })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      const text = select(container, 'gemini-text-model')
      text.value = 'gemini-2.5-flash'
      text.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'falha ao salvar modelo'
    )
  })

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

  it('diminuir teto salva metade e mostra aviso', async () => {
    const { api, setGeminiConfig } = makeApi({ cap: 2_000_000, monthlyTokenCap: 2_000_000 })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Diminuir teto').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await settle()

    expect(setGeminiConfig).toHaveBeenCalledWith({
      model: 'gemini-2.0-flash',
      liveModel: 'gemini-3.8-live',
      temperature: 0.7,
      monthlyTokenCap: 1_000_000,
      unlimitedUsage: false
    })
    expect(container.textContent).toContain('Teto mensal reduzido para 1.000.000 tokens.')
  })

  it('diminuir teto fica desabilitado no piso', async () => {
    const { api } = makeApi({ cap: 100_000, monthlyTokenCap: 100_000 })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    expect(button(container, 'Diminuir teto').disabled).toBe(true)
  })

  it('ativa uso ilimitado, persiste e mostra aviso sobre o Google', async () => {
    const { api, setGeminiConfig } = makeApi()
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Ativar uso ilimitado').click()
    })
    await settle()

    expect(setGeminiConfig).toHaveBeenCalledWith({
      model: 'gemini-2.0-flash',
      liveModel: 'gemini-3.8-live',
      temperature: 0.7,
      monthlyTokenCap: 2_000_000,
      unlimitedUsage: true
    })
    expect(container.querySelector('[data-unlimited-status]')?.textContent).toBe('Ilimitado')
    expect(container.textContent).toContain('quotas')
    expect(container.textContent).toContain('rate limits')
    expect(button(container, 'Desativar uso ilimitado').getAttribute('aria-pressed')).toBe('true')
  })

  it('carrega e permite desativar uso ilimitado persistido', async () => {
    const { api, setGeminiConfig } = makeApi({ unlimitedUsage: true })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    expect(container.querySelector('[data-unlimited-status]')?.textContent).toBe('Ilimitado')
    await act(async () => {
      button(container, 'Desativar uso ilimitado').click()
    })
    await settle()

    expect(setGeminiConfig).toHaveBeenCalledWith(expect.objectContaining({ unlimitedUsage: false }))
    expect(container.querySelector('[data-unlimited-status]')?.textContent).toBe(
      'Teto mensal interno ativo'
    )
  })

  it('mostra erro quando não consegue persistir uso ilimitado', async () => {
    const { api, setGeminiConfig } = makeApi()
    setGeminiConfig.mockResolvedValueOnce({ ok: false as const, error: 'falha ao salvar' })
    await act(async () => {
      root.render(<KeyTab api={api} />)
    })
    await settle()

    await act(async () => {
      button(container, 'Ativar uso ilimitado').click()
    })
    await settle()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('falha ao salvar')
    expect(container.querySelector('[data-unlimited-status]')?.textContent).toBe(
      'Teto mensal interno ativo'
    )
  })

  it('503 mostra aviso em âmbar e não acusa a chave', async () => {
    const { api } = makeApi({
      testOutcome: {
        ok: true,
        model: 'gemini-3.8-flash',
        warning:
          'Chave aceita, mas o serviço do Gemini está sobrecarregado (HTTP 503). Tente novamente em instantes; a voz continua disponível.',
        durationMs: 12
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

    const outcome = container.querySelector('[data-test-key-outcome]')
    expect(outcome?.className).toContain('text-amber-200')
    expect(container.textContent).toContain('Chave aceita')
    expect(container.textContent).not.toContain('autenticação')
  })
})

describe('describeTestError', () => {
  it('sucesso sem warning é verde', () => {
    expect(describeTestError({ ok: true })).toBe('Conexão testada com sucesso.')
  })

  it('sucesso com warning mostra o aviso', () => {
    const warning = 'Chave aceita, mas o serviço está sobrecarregado.'
    expect(describeTestError({ ok: true, warning })).toBe(warning)
  })

  it('server 503 não culpa a chave', () => {
    const text = describeTestError({
      ok: false,
      error: { kind: 'server', message: 'high demand' }
    })
    expect(text).toContain('sobrecarregado')
    expect(text).toContain('não foi recusada')
  })

  it('timeout não significa chave inválida', () => {
    const text = describeTestError({
      ok: false,
      error: { kind: 'timeout', message: 'demorou' }
    })
    expect(text).toContain('não significa que a chave seja inválida')
  })
})

describe('decreaseMonthlyCap', () => {
  it('divide pela metade', () => {
    expect(decreaseMonthlyCap(2_000_000)).toBe(1_000_000)
  })

  it('respeita o piso', () => {
    expect(decreaseMonthlyCap(150_000)).toBe(100_000)
    expect(decreaseMonthlyCap(100_000)).toBe(100_000)
  })

  it('valor não finito cai no piso', () => {
    expect(decreaseMonthlyCap(Number.NaN)).toBe(100_000)
  })
})
