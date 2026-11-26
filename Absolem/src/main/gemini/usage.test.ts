import { describe, expect, it } from 'vitest'
import { GeminiEngine } from './engine'
import { createChatHistory } from './history'
import { FakeTransport } from './testing/fakeTransport'
import {
  createUsageMeter,
  dayKey,
  monthKey,
  normalizeUsageState,
  resolveUsage,
  type UsageMeter
} from './usage'

const NOW = new Date('2026-11-26T12:00:00.000Z')
const MODEL = 'gemini-2.0-flash'

function memoryStore() {
  const data = new Map<string, unknown>()
  return {
    data,
    get<T>(key: string, defaultValue: T): T {
      return data.has(key) ? (data.get(key) as T) : defaultValue
    },
    set(key: string, value: unknown): void {
      data.set(key, value)
    }
  }
}

function meter(options?: { cap?: number; store?: ReturnType<typeof memoryStore> }): {
  usage: UsageMeter
  store: ReturnType<typeof memoryStore>
  warnings: Array<{ percent: number; cap: number; used: number }>
  setCap: (cap: number) => void
} {
  const store = options?.store ?? memoryStore()
  let cap = options?.cap ?? 1_000
  const warnings: Array<{ percent: number; cap: number; used: number }> = []
  const usage = createUsageMeter({
    store,
    cap: () => cap,
    now: () => NOW,
    onWarning: (warning) => warnings.push(warning)
  })
  return { usage, store, warnings, setCap: (next) => (cap = next) }
}

describe('medidor de custo', () => {
  it('soma por dia (entrada, saída e chamadas) e persiste', () => {
    const { usage, store } = meter()

    usage.record({ input: 100, output: 20 })
    usage.record({ input: 50, output: 10 })

    const day = normalizeUsageState(store.get('usage', null)).days[dayKey(NOW)]
    expect(day).toEqual({ input: 150, output: 30, calls: 2 })
    expect(usage.snapshot()).toEqual({ today: 180, month: 180, cap: 1_000, percent: 18 })
  })

  it('80% emite aviso uma única vez no mês', () => {
    const { usage, warnings } = meter({ cap: 100 })

    usage.record({ input: 40, output: 0 })
    expect(warnings).toHaveLength(0)
    usage.record({ input: 40, output: 0 })
    expect(warnings).toEqual([{ percent: 80, cap: 100, used: 80, month: monthKey(NOW) }])
    usage.record({ input: 10, output: 0 })
    expect(warnings).toHaveLength(1)
    expect(usage.snapshot().percent).toBe(90)
  })

  it('100% bloqueia sem chamar o transporte e libera ao aumentar o teto', async () => {
    const { usage, setCap } = meter({ cap: 20 })
    usage.record({ input: 20, output: 0 })

    const transport = new FakeTransport({
      generateSteps: [{ text: 'ok', usage: { input: 5, output: 1 } }],
      streamSteps: [{ text: 'resposta' }]
    })
    const engine = new GeminiEngine({
      transport,
      keys: {
        hasApiKey: () => true,
        getApiKey: () => 'stub-key',
        setApiKey: () => ({ ok: true }),
        clearApiKey: () => ({ ok: true })
      },
      config: () => ({ model: MODEL, temperature: 0.7, monthlyTokenCap: usage.getCap() }),
      usage,
      history: createChatHistory({ store: memoryStore() }),
      now: () => NOW
    })

    const blocked = await engine.testKey()
    expect(blocked.ok).toBe(false)
    expect(blocked.error?.kind).toBe('quota')
    expect(blocked.error?.message).toContain('monthlyTokenCap')
    expect(transport.generateAttempts).toBe(0)

    const events: string[] = []
    await engine.send('req-1', 'oi', {
      delta: () => events.push('delta'),
      done: () => events.push('done'),
      error: (error) => events.push(`error:${error.kind}`)
    })
    expect(events).toEqual(['error:quota'])
    expect(transport.streamAttempts).toBe(0)

    // Aumentar o teto (nas configurações) volta a funcionar sem reiniciar.
    setCap(10_000)
    const released = await engine.testKey()
    expect(released.ok).toBe(true)
    expect(transport.generateAttempts).toBe(1)
  })

  it('estimativa por caracteres é marcada com estimated', async () => {
    expect(resolveUsage('12345678', '1234')).toEqual({
      input: 2,
      output: 1,
      total: 3,
      estimated: true
    })
    expect(resolveUsage('x', 'y', { input: 9, output: 4 })).toEqual({
      input: 9,
      output: 4,
      total: 13,
      estimated: false
    })

    const { usage } = meter()
    const engine = new GeminiEngine({
      transport: new FakeTransport({ streamSteps: [{ text: 'sem metadata' }] }),
      keys: {
        hasApiKey: () => true,
        getApiKey: () => 'stub-key',
        setApiKey: () => ({ ok: true }),
        clearApiKey: () => ({ ok: true })
      },
      config: () => ({ model: MODEL, temperature: 0.7, monthlyTokenCap: 1_000 }),
      usage,
      history: createChatHistory({ store: memoryStore() }),
      now: () => NOW
    })
    let payload: { total: number; estimated: boolean } | null = null
    await engine.send('req-1', 'oi', {
      delta: () => undefined,
      done: (result) => {
        payload = result
      },
      error: () => undefined
    })
    expect(payload).not.toBeNull()
    expect(payload).toMatchObject({ estimated: true })
    expect((payload as unknown as { total: number }).total).toBeGreaterThan(0)
    expect(usage.snapshot().month).toBe((payload as unknown as { total: number }).total)
  })

  it('poda dias fora da retenção de 62 dias na escrita', () => {
    const store = memoryStore()
    store.set('usage', {
      days: { '2025-01-01': { input: 999, output: 999, calls: 1 } },
      warnedMonths: []
    })
    const { usage } = meter({ store })
    usage.record({ input: 1, output: 1 })

    const state = normalizeUsageState(store.get('usage', null))
    expect(state.days['2025-01-01']).toBeUndefined()
    expect(state.days[dayKey(NOW)]).toEqual({ input: 1, output: 1, calls: 1 })
  })
})
