import { describe, expect, it } from 'vitest'
import type { ChatSinks } from './engine'
import { GeminiEngine } from './engine'
import { createChatHistory } from './history'
import { FakeTransport, type FakeTransportScenario } from './testing/fakeTransport'
import { createUsageMeter } from './usage'

const NOW = new Date('2026-11-26T12:00:00.000Z')
const MODEL = 'gemini-2.0-flash'
const CAP = 2_000_000
const API_KEY = 'stub-key'

function makeHarness(scenario: FakeTransportScenario) {
  const transport = new FakeTransport(scenario)
  const data = new Map<string, unknown>()
  const store = {
    get<T>(key: string, defaultValue: T): T {
      return data.has(key) ? (data.get(key) as T) : defaultValue
    },
    set(key: string, value: unknown): void {
      data.set(key, value)
    }
  }
  const usage = createUsageMeter({ store, cap: () => CAP, now: () => NOW })
  const history = createChatHistory({ store })
  const engine = new GeminiEngine({
    transport,
    keys: {
      hasApiKey: () => true,
      getApiKey: () => API_KEY,
      setApiKey: () => ({ ok: true }),
      clearApiKey: () => ({ ok: true })
    },
    config: () => ({ model: MODEL, temperature: 0.7, monthlyTokenCap: CAP }),
    usage,
    history,
    now: () => NOW
  })
  return { engine, transport, usage, history }
}

interface Recorder {
  sinks: ChatSinks
  events: Array<{ type: 'delta' | 'done' | 'error'; text?: string; kind?: string; usage?: unknown }>
}

function recorder(): Recorder {
  const events: Recorder['events'] = []
  return {
    events,
    sinks: {
      delta: (text) => events.push({ type: 'delta', text }),
      done: (usage) => events.push({ type: 'done', usage }),
      error: (error) => events.push({ type: 'error', kind: error.kind })
    }
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('timeout esperando condição do teste'))
        return
      }
      setTimeout(tick, 2)
    }
    tick()
  })
}

describe('GeminiEngine: streaming de texto', () => {
  it('deltas chegam em ordem', async () => {
    const { engine } = makeHarness({
      streamSteps: [{ text: 'Olá' }, { text: ', ' }, { text: 'mundo' }]
    })
    const { sinks, events } = recorder()

    await engine.send('req-1', 'oi', sinks)

    expect(events.filter((event) => event.type === 'delta').map((event) => event.text)).toEqual([
      'Olá',
      ', ',
      'mundo'
    ])
    expect(events.at(-1)?.type).toBe('done')
  })

  it('cancel interrompe e emite chat:error kind cancelled', async () => {
    const { engine } = makeHarness({
      streamSteps: [{ text: 'primeiro' }, { text: 'nunca', delayMs: 200 }]
    })
    const { sinks, events } = recorder()

    const sending = engine.send('req-1', 'oi', sinks)
    await waitFor(() => events.some((event) => event.type === 'delta'))
    expect(engine.cancel('req-1')).toBe(true)
    await sending

    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', kind: 'cancelled' }
    ])
    expect(events.some((event) => event.text === 'nunca')).toBe(false)
    expect(events.at(-1)?.type).toBe('error')
  })

  it('segundo requestId cancela o primeiro e nenhum delta atrasado escapa', async () => {
    const { engine } = makeHarness({
      streamSteps: [{ text: 'A' }, { text: 'B', delayMs: 50 }]
    })
    const first = recorder()
    const second = recorder()

    const firstSending = engine.send('req-1', 'primeiro', first.sinks)
    await waitFor(() => first.events.some((event) => event.type === 'delta'))
    const deltasWhenCancelled = first.events.filter((event) => event.type === 'delta').length

    const secondSending = engine.send('req-2', 'segundo', second.sinks)
    expect(engine.getActiveRequestId()).toBe('req-2')
    await Promise.all([firstSending, secondSending])

    expect(first.events.filter((event) => event.type === 'delta')).toHaveLength(deltasWhenCancelled)
    expect(first.events.some((event) => event.kind === 'cancelled')).toBe(true)
    expect(
      second.events.filter((event) => event.type === 'delta').map((event) => event.text)
    ).toEqual(['A', 'B'])
    expect(second.events.at(-1)?.type).toBe('done')
  })

  it('done traz usage e grava o histórico', async () => {
    const { engine, usage, history } = makeHarness({
      streamSteps: [{ text: 'resposta', usage: { input: 20, output: 5, total: 25 } }]
    })
    const { sinks, events } = recorder()

    await engine.send('req-1', 'pergunta', sinks)

    const done = events.find((event) => event.type === 'done')
    expect(done?.usage).toEqual({ input: 20, output: 5, total: 25, estimated: false })
    expect(usage.snapshot().month).toBe(25)
    expect(history.getTurns().map((turn) => [turn.role, turn.text])).toEqual([
      ['user', 'pergunta'],
      ['model', 'resposta']
    ])
  })
})
