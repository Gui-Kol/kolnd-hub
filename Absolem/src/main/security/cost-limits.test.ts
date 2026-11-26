import { describe, expect, it } from 'vitest'
import { GeminiEngine } from '../gemini/engine'
import { createChatHistory } from '../gemini/history'
import { FakeTransport } from '../gemini/testing/fakeTransport'
import {
  createUsageMeter,
  dayKey,
  monthKey,
  normalizeUsageState,
  type UsageMeter
} from '../gemini/usage'

/**
 * Governança de custo (task 13/T3).
 *
 * Cobre o que o gate de custo exige: bloqueio em 100% sem tocar na rede,
 * liberação ao aumentar o teto, `requestId` idempotente, reset mensal e
 * medidor nunca negativo. Nenhum teste usa chave real ou rede.
 */

const MODEL = 'gemini-2.0-flash'
const NOW = new Date('2026-11-26T12:00:00.000Z')

class MemoryStore {
  readonly data = new Map<string, unknown>()

  get<T>(key: string, defaultValue: T): T {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value)
  }
}

function createMeter(options: { cap?: number; now?: () => Date } = {}): {
  usage: UsageMeter
  store: MemoryStore
  setCap: (cap: number) => void
} {
  const store = new MemoryStore()
  let cap = options.cap ?? 2_000_000
  const usage = createUsageMeter({
    store,
    cap: () => cap,
    now: options.now ?? (() => new Date('2026-11-26T12:00:00.000Z'))
  })
  return { usage, store, setCap: (next) => (cap = next) }
}

function createEngine(usage: UsageMeter, transport: FakeTransport): GeminiEngine {
  return new GeminiEngine({
    transport,
    keys: {
      hasApiKey: () => true,
      getApiKey: () => 'stub-key',
      setApiKey: () => ({ ok: true }),
      clearApiKey: () => ({ ok: true })
    },
    config: () => ({ model: MODEL, temperature: 0.7, monthlyTokenCap: usage.getCap() }),
    usage,
    history: createChatHistory({ store: new MemoryStore() }),
    now: () => NOW
  })
}

describe('limites de custo', () => {
  it('100% bloqueia sem chamar a rede', async () => {
    const { usage } = createMeter({ cap: 20 })
    usage.record({ input: 20, output: 0 })
    expect(usage.snapshot().percent).toBe(100)

    const transport = new FakeTransport({
      generateSteps: [{ text: 'não deveria ser chamado', usage: { input: 1, output: 1 } }],
      streamSteps: [{ text: 'não deveria ser chamado' }]
    })
    const engine = createEngine(usage, transport)

    const test = await engine.testKey()
    expect(test.ok).toBe(false)
    expect(test.error?.kind).toBe('quota')
    expect(transport.generateAttempts).toBe(0)

    const events: string[] = []
    await engine.send('req-bloqueado', 'oi', {
      delta: () => events.push('delta'),
      done: () => events.push('done'),
      error: (error) => events.push(`error:${error.kind}`)
    })
    expect(events).toEqual(['error:quota'])
    expect(transport.streamAttempts).toBe(0)
  })

  it('aumento do teto libera a chamada seguinte', async () => {
    const { usage, setCap } = createMeter({ cap: 20 })
    usage.record({ input: 20, output: 0 })
    const transport = new FakeTransport({
      generateSteps: [{ text: 'ok', usage: { input: 2, output: 1 } }],
      streamSteps: [{ text: 'ok' }]
    })
    const engine = createEngine(usage, transport)

    expect((await engine.testKey()).ok).toBe(false)
    expect(transport.generateAttempts).toBe(0)

    setCap(10_000)
    const released = await engine.testKey()
    expect(released.ok).toBe(true)
    expect(transport.generateAttempts).toBe(1)
  })

  it('requestId repetido não conta duas vezes', () => {
    const { usage, store } = createMeter()
    usage.record({ input: 10, output: 5 }, { requestId: 'turno-1' })
    const first = usage.snapshot()
    usage.record({ input: 10, output: 5 }, { requestId: 'turno-1' })
    expect(usage.snapshot()).toEqual(first)
    expect(usage.monthTokens()).toBe(15)

    usage.record({ input: 2, output: 1 }, { requestId: 'turno-2' })
    expect(usage.monthTokens()).toBe(18)
    const day = normalizeUsageState(store.get('usage', null)).days[dayKey(NOW)]
    expect(day).toEqual({ input: 12, output: 6, calls: 2 })
  })

  it('reset mensal zera o acumulado do mês anterior', () => {
    let now = new Date('2026-11-26T12:00:00.000Z')
    const { usage } = createMeter({ cap: 100, now: () => now })
    usage.record({ input: 90, output: 10 })
    expect(usage.snapshot().month).toBe(100)
    expect(() => usage.checkBudget()).toThrow()

    now = new Date('2026-12-01T00:00:01.000Z')
    expect(usage.snapshot()).toEqual({
      today: 0,
      month: 0,
      cap: 100,
      percent: 0
    })
    expect(() => usage.checkBudget()).not.toThrow()
    expect(usage.monthTokens()).toBe(0)
    expect(monthKey(now)).toBe('2026-12')
  })

  it('valores negativos nunca reduzem o medidor', () => {
    const { usage } = createMeter()
    usage.record({ input: -50, output: -10 })
    expect(usage.snapshot()).toEqual({ today: 0, month: 0, cap: 2_000_000, percent: 0 })
    usage.record({ input: 5, output: 5 })
    expect(usage.monthTokens()).toBe(10)
  })

  it('aumentar o teto reduz o percentual sem zerar o consumo', () => {
    const { usage, setCap } = createMeter({ cap: 100 })
    usage.record({ input: 80, output: 20 })
    expect(usage.snapshot().percent).toBe(100)
    setCap(400)
    expect(usage.snapshot()).toMatchObject({ month: 100, cap: 400, percent: 25 })
  })
})
