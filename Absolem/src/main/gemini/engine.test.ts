import { describe, expect, it, vi } from 'vitest'
import { GeminiEngine, type ChatSinks } from './engine'
import { createChatHistory } from './history'
import { FakeTransport } from './testing/fakeTransport'
import { createUsageMeter } from './usage'

const NOW = new Date('2026-11-26T12:00:00.000Z')
const MODEL = 'gemini-2.0-flash'
const CAP = 2_000_000
const API_KEY = 'stub-key'

function memoryStore(): {
  get<T>(key: string, defaultValue: T): T
  set(key: string, value: unknown): void
} {
  const data = new Map<string, unknown>()
  return {
    get<T>(key: string, defaultValue: T): T {
      return data.has(key) ? (data.get(key) as T) : defaultValue
    },
    set(key: string, value: unknown): void {
      data.set(key, value)
    }
  }
}

function makeHarness(options?: {
  configured?: boolean
  scenario?: ConstructorParameters<typeof FakeTransport>[0]
}) {
  const configured = options?.configured ?? true
  const transport = new FakeTransport(
    options?.scenario ?? { generateSteps: [{ text: 'ok', usage: { input: 10, output: 2 } }] }
  )
  const keys = {
    hasApiKey: vi.fn(() => configured),
    getApiKey: vi.fn(() => (configured ? API_KEY : null)),
    setApiKey: vi.fn(() => ({ ok: true })),
    clearApiKey: vi.fn(() => ({ ok: true }))
  }
  const store = memoryStore()
  const usage = createUsageMeter({ store, cap: () => CAP, now: () => NOW })
  const history = createChatHistory({ store })
  const engine = new GeminiEngine({
    transport,
    keys,
    config: () => ({ model: MODEL, temperature: 0.7, monthlyTokenCap: CAP }),
    usage,
    history,
    now: () => NOW
  })
  return { engine, transport, keys, store, usage, history }
}

function collectSinks(): ChatSinks & { events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = []
  return {
    events,
    delta: (text) => events.push({ type: 'delta', text }),
    done: (usage) => events.push({ type: 'done', usage }),
    error: (error) => events.push({ type: 'error', ...error })
  }
}

describe('GeminiEngine: chave e estado', () => {
  it('sem chave não chama o SDK e devolve auth', async () => {
    const { engine, transport } = makeHarness({ configured: false })
    const sinks = collectSinks()

    await engine.send('req-1', 'olá', sinks)
    const testResult = await engine.testKey()

    expect(sinks.events).toEqual([
      { type: 'error', kind: 'auth', message: 'Chave do Gemini não configurada.' }
    ])
    expect(testResult.ok).toBe(false)
    expect(testResult.error?.kind).toBe('auth')
    expect(transport.requests).toHaveLength(0)
    expect(transport.generateAttempts).toBe(0)
  })

  it('erro 401 vira kind auth e não apaga a chave', async () => {
    const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 })
    const { engine, keys } = makeHarness({
      scenario: { generateErrors: [unauthorized], generateSteps: [{ text: 'ok' }] }
    })

    const result = await engine.testKey()

    expect(result.ok).toBe(false)
    expect(result.error?.kind).toBe('auth')
    expect(keys.clearApiKey).not.toHaveBeenCalled()
    expect(keys.hasApiKey()).toBe(true)
    expect(engine.status().configured).toBe(true)
    expect(engine.status().lastError).toEqual({
      kind: 'auth',
      message: 'Chave de API inválida, ausente ou sem permissão.'
    })
  })

  it('status reflete configured, uso, teto e disabledReason', async () => {
    const { engine, keys } = makeHarness({
      scenario: { generateSteps: [{ text: 'ok', usage: { input: 300, output: 100 } }] }
    })

    const before = engine.status()
    expect(before.configured).toBe(true)
    expect(before.model).toBe(MODEL)
    expect(before.usage).toEqual({ today: 0, month: 0, cap: CAP, percent: 0 })
    expect(before.disabledReason).toBeNull()

    await engine.testKey()
    const after = engine.status()
    expect(after.usage.month).toBe(400)
    expect(after.lastError).toBeNull()

    // Simula chave apagada (o store é a fonte da verdade).
    keys.hasApiKey.mockReturnValue(false)
    keys.getApiKey.mockReturnValue(null)
    const withoutKey = engine.status()
    expect(withoutKey.configured).toBe(false)
    expect(withoutKey.disabledReason).toBe('Chave do Gemini não configurada.')
  })

  it('grava a chave sem devolver o valor e valida tamanho', () => {
    const { engine, keys } = makeHarness()

    expect(engine.setKey('curta')).toEqual({
      ok: false,
      error: 'Chave inválida: curta demais.'
    })
    expect(keys.setApiKey).not.toHaveBeenCalled()

    expect(engine.setKey(API_KEY)).toEqual({ ok: true })
    expect(keys.setApiKey).toHaveBeenCalledWith(API_KEY)
    expect(JSON.stringify(engine.status())).not.toContain(API_KEY)
  })

  it('test-key contabiliza tokens da chamada mínima', async () => {
    const { engine, transport, usage } = makeHarness()

    const result = await engine.testKey()

    expect(result.ok).toBe(true)
    expect(result.model).toBe(MODEL)
    expect(result.usage).toEqual({ input: 10, output: 2, total: 12, estimated: false })
    expect(transport.generateAttempts).toBe(1)
    expect(usage.snapshot().today).toBe(12)
    expect(usage.snapshot().month).toBe(12)
  })
})
