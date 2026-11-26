import { describe, expect, it, vi } from 'vitest'
import { NO_SOURCES_WARNING } from '../search/answer'
import { createWebSearchDefinition } from '../search/tools'
import { GeminiEngine, type ChatSinks } from './engine'
import { createChatHistory } from './history'
import { FakeTransport } from './testing/fakeTransport'
import { createUsageMeter } from './usage'

const NOW = new Date('2026-11-26T12:00:00.000Z')
const MODEL = 'gemini-2.0-flash'
const CAP = 2_000_000

function memoryStore() {
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

function harness(routeResult: unknown) {
  const transport = new FakeTransport({
    streamStepsByAttempt: [
      [{ functionCalls: [{ name: 'web_search', args: { query: 'satélites' } }] }],
      [{ text: 'Fato verificado [1] e citação inventada [9].' }]
    ]
  })
  const keys = {
    hasApiKey: () => true,
    getApiKey: () => 'stub-key',
    setApiKey: () => ({ ok: true }),
    clearApiKey: () => ({ ok: true })
  }
  const store = memoryStore()
  const usage = createUsageMeter({ store, cap: () => CAP, now: () => NOW })
  const history = createChatHistory({ store })
  const route = vi.fn(async () => ({ ok: true as const, result: routeResult }))
  const engine = new GeminiEngine({
    transport,
    keys,
    config: () => ({ model: MODEL, temperature: 0.7, monthlyTokenCap: CAP }),
    usage,
    history,
    now: () => NOW,
    tools: () => [createWebSearchDefinition()],
    route
  })
  return { engine, history, route }
}

function collect(): ChatSinks & { text: () => string } {
  let text = ''
  return {
    delta: (delta) => {
      text += delta
    },
    done: () => undefined,
    error: () => undefined,
    text: () => text
  }
}

describe('engine: resposta com fontes e aviso', () => {
  it('segura a resposta, corrige citação e anexa fontes no fim', async () => {
    const { engine, history } = harness({
      answer: 'Resumo.',
      sources: [{ title: 'Fonte A', url: 'https://a.example/x' }],
      noSources: false,
      warnings: ['Aviso: página suspeita.']
    })
    const sinks = collect()

    await engine.send('req-web', 'pesquise satélites', sinks)
    const final = sinks.text()

    expect(final.indexOf('Aviso: página suspeita.')).toBeLessThan(final.indexOf('Fato verificado'))
    expect(final).toContain('Fato verificado [1] e citação inventada.')
    expect(final).not.toContain('[9]')
    expect(final.trimEnd().endsWith('Fontes:\n[1] Fonte A - https://a.example/x')).toBe(true)
    expect(history.getTurns().at(-1)?.text).toContain('https://a.example/x')
  })

  it('sem metadata de grounding avisa e não inventa fonte', async () => {
    const { engine } = harness({
      answer: 'Sem fontes.',
      sources: [],
      noSources: true,
      warnings: []
    })
    const sinks = collect()

    await engine.send('req-web-2', 'pesquise sem fontes', sinks)
    const final = sinks.text()

    expect(final).toContain(NO_SOURCES_WARNING)
    expect(final).not.toContain('Fontes:')
  })
})
