import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../../shared/tools'
import type { ChatUsagePayload, GeminiErrorSummary } from '../../shared/gemini'
import { GeminiEngine, type ChatSinks } from './engine'
import { createChatHistory } from './history'
import { FakeTransport, type FakeTransportScenario } from './testing/fakeTransport'
import { createToolRegistry } from './tools/registry'
import { routeToolCall, type ToolCallResult } from './tools/router'
import { createUsageMeter } from './usage'

const NOW = new Date('2026-11-26T12:00:00.000Z')
const CAP = 2_000_000
const API_KEY = 'stub-key'

const TIME_TOOL: ToolDefinition = {
  name: 'get_current_time',
  description: 'Devolve a hora atual.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  },
  sensitive: false,
  category: 'internal',
  timeoutMs: 2_000
}

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

interface HarnessOptions {
  scenario: FakeTransportScenario
  route?: (call: { name: string; args: Record<string, unknown> }) => Promise<ToolCallResult>
  maxToolContinuations?: number
}

function makeHarness(options: HarnessOptions) {
  const transport = new FakeTransport(options.scenario)
  const store = memoryStore()
  const usage = createUsageMeter({ store, cap: () => CAP, now: () => NOW })
  const history = createChatHistory({ store })
  const route = vi.fn(
    options.route ??
      (async () => ({ ok: true as const, result: { iso: '2026-11-26T12:00:00.000Z' } }))
  )
  const engine = new GeminiEngine({
    transport,
    keys: {
      hasApiKey: () => true,
      getApiKey: () => API_KEY,
      setApiKey: () => ({ ok: true }),
      clearApiKey: () => ({ ok: true })
    },
    config: () => ({ model: 'gemini-2.0-flash', temperature: 0.7, monthlyTokenCap: CAP }),
    usage,
    history,
    now: () => NOW,
    tools: () => [TIME_TOOL],
    route,
    ...(options.maxToolContinuations === undefined
      ? {}
      : { maxToolContinuations: options.maxToolContinuations })
  })
  return { engine, transport, usage, history, route }
}

function collectSinks() {
  const deltas: string[] = []
  const done: ChatUsagePayload[] = []
  const errors: GeminiErrorSummary[] = []
  const calls: string[][] = []
  const sinks: ChatSinks = {
    delta: (text) => deltas.push(text),
    done: (payload) => done.push(payload),
    error: (error) => errors.push(error),
    functionCalls: (list) => calls.push(list.map((call) => call.name))
  }
  return { sinks, deltas, done, errors, calls }
}

describe('GeminiEngine: loop de ferramentas (T10b)', () => {
  it('executa get_current_time, devolve o resultado e streama a resposta final', async () => {
    const { engine, transport, usage } = makeHarness({
      scenario: {
        streamStepsByAttempt: [
          [
            {
              functionCalls: [{ name: 'get_current_time', args: { timezone: 'UTC' } }],
              usage: { input: 10, output: 2 }
            }
          ],
          [{ text: 'Agora são 12h.', usage: { input: 5, output: 3 } }]
        ]
      }
    })
    const collector = collectSinks()

    await engine.send('req-tool', 'que horas são?', collector.sinks)

    expect(transport.streamAttempts).toBe(2)
    expect(collector.calls).toEqual([['get_current_time']])
    expect(collector.deltas).toEqual(['Agora são 12h.'])
    expect(collector.errors).toHaveLength(0)
    expect(collector.done[0]).toMatchObject({ input: 15, output: 5, total: 20 })

    // Declaração enviada e resultado devolvido no turno seguinte.
    expect(transport.requests[0]?.tools?.map((tool) => tool.name)).toEqual(['get_current_time'])
    const lastContent = transport.requests[1]?.contents.at(-1)
    expect(lastContent?.functionResponses?.[0]).toMatchObject({
      name: 'get_current_time',
      response: { ok: true, result: { iso: '2026-11-26T12:00:00.000Z' } }
    })
    expect(usage.snapshot().month).toBe(20)
  })

  it('deny não executa a ferramenta e o modelo recebe erro estruturado', async () => {
    const registry = createToolRegistry()
    expect(registry.registerTool(TIME_TOOL).ok).toBe(true)
    const handler = vi.fn(() => ({ iso: 'nunca' }))
    const route = (call: { name: string; args: Record<string, unknown> }) =>
      routeToolCall(
        {
          registry,
          getHandler: () => handler,
          getPermission: () => 'deny',
          confirm: async () => true,
          confirmTimeoutMs: 10
        },
        call
      )
    const { engine, transport } = makeHarness({
      route,
      scenario: {
        streamStepsByAttempt: [
          [{ functionCalls: [{ name: 'get_current_time', args: {} }] }],
          [{ text: 'Não posso executar essa ferramenta.' }]
        ]
      }
    })
    const collector = collectSinks()

    await engine.send('req-deny', 'que horas são?', collector.sinks)

    expect(handler).not.toHaveBeenCalled()
    expect(transport.streamAttempts).toBe(2)
    const lastContent = transport.requests[1]?.contents.at(-1)
    expect(lastContent?.functionResponses?.[0]?.response).toMatchObject({
      ok: false,
      error: { kind: 'denied' }
    })
    expect(collector.deltas).toEqual(['Não posso executar essa ferramenta.'])
  })

  it('cancel durante o loop não emite delta posterior', async () => {
    const holder: { engine?: GeminiEngine } = {}
    const harness = makeHarness({
      scenario: {
        streamStepsByAttempt: [
          [{ functionCalls: [{ name: 'get_current_time', args: {} }] }],
          [{ text: 'NÃO DEVERIA APARECER' }]
        ]
      },
      route: async () => {
        holder.engine?.cancel('req-cancel')
        return { ok: true, result: { iso: 'x' } }
      }
    })
    holder.engine = harness.engine
    const collector = collectSinks()

    await harness.engine.send('req-cancel', 'que horas são?', collector.sinks)

    expect(harness.transport.streamAttempts).toBe(1)
    expect(collector.deltas).toEqual([])
    expect(collector.done).toHaveLength(0)
    expect(collector.errors[0]).toMatchObject({ kind: 'cancelled' })
  })

  it('limite de 2 continuações evita loop infinito', async () => {
    const loop = (index: number) => ({
      functionCalls: [{ name: 'get_current_time', args: { attempt: index } }]
    })
    const harness = makeHarness({
      scenario: {
        streamStepsByAttempt: [[loop(0)], [loop(1)], [loop(2)], [loop(3)], [{ text: 'fim' }]]
      }
    })
    const collector = collectSinks()

    await harness.engine.send('req-loop', 'que horas são?', collector.sinks)

    // 1 chamada inicial + 2 continuações; as chamadas do 3º stream não são roteadas.
    expect(harness.transport.streamAttempts).toBe(3)
    expect(harness.route).toHaveBeenCalledTimes(2)
    expect(collector.done).toHaveLength(1)
    expect(collector.errors).toHaveLength(0)
  })

  it('soma os tokens de todas as continuações no usage', async () => {
    const call = (input: number, output: number) => ({
      functionCalls: [{ name: 'get_current_time', args: {} }],
      usage: { input, output }
    })
    const harness = makeHarness({
      scenario: {
        streamStepsByAttempt: [
          [call(100, 10)],
          [call(50, 5)],
          [{ text: 'pronto', usage: { input: 20, output: 2 } }]
        ]
      }
    })
    const collector = collectSinks()

    await harness.engine.send('req-usage', 'que horas são?', collector.sinks)

    expect(collector.done[0]).toMatchObject({ input: 170, output: 17, total: 187 })
    expect(harness.usage.snapshot().month).toBe(187)
  })

  it('turno vazio depois de ferramenta emite a frase pronta da última tool ok', async () => {
    const harness = makeHarness({
      route: async () => ({ ok: true, result: { message: 'Abri o aplicativo Insomnia.' } }),
      scenario: {
        streamStepsByAttempt: [[{ functionCalls: [{ name: 'get_current_time', args: {} }] }], [{}]]
      }
    })
    const collector = collectSinks()

    await harness.engine.send('req-empty-ok', 'abre o Insomnia', collector.sinks)

    expect(collector.deltas).toEqual(['Abri o aplicativo Insomnia.'])
    expect(collector.done).toHaveLength(1)
    expect(collector.errors).toHaveLength(0)
  })

  it('turno vazio depois de ferramenta que falhou emite a frase de falha', async () => {
    const harness = makeHarness({
      route: async () => ({
        ok: false,
        error: { kind: 'failed', message: 'Não consegui abrir o aplicativo Insomnia: sumiu.' }
      }),
      scenario: {
        streamStepsByAttempt: [[{ functionCalls: [{ name: 'get_current_time', args: {} }] }], [{}]]
      }
    })
    const collector = collectSinks()

    await harness.engine.send('req-empty-fail', 'abre o Insomnia', collector.sinks)

    expect(collector.deltas).toEqual(['Não consegui concluir o pedido.'])
    expect(collector.done).toHaveLength(1)
    expect(collector.errors).toHaveLength(0)
  })

  it('resposta não vazia do modelo não é substituída pela frase pronta', async () => {
    const harness = makeHarness({
      route: async () => ({ ok: true, result: { message: 'Abri o aplicativo Insomnia.' } }),
      scenario: {
        streamStepsByAttempt: [
          [{ functionCalls: [{ name: 'get_current_time', args: {} }] }],
          [{ text: 'Pronto, abri o Insomnia.' }]
        ]
      }
    })
    const collector = collectSinks()

    await harness.engine.send('req-text-ok', 'abre o Insomnia', collector.sinks)

    expect(collector.deltas).toEqual(['Pronto, abri o Insomnia.'])
  })
})
