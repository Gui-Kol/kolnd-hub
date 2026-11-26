import { describe, expect, it, vi } from 'vitest'
import { GeminiClient } from './client'
import { GeminiError } from './errors'
import { FakeTransport, type FakeTransportScenario } from './testing/fakeTransport'

const BASE_REQUEST = {
  apiKey: 'stub-key',
  model: 'gemini-2.0-flash',
  temperature: 0.7,
  systemInstruction: 'teste',
  contents: [{ role: 'user' as const, text: 'olá' }]
}

function makeClient(
  scenario: FakeTransportScenario,
  options?: {
    maxAttempts?: number
    deadlines?: { connectMs?: number; firstTokenMs?: number; totalMs?: number }
  }
): { client: GeminiClient; transport: FakeTransport; sleep: ReturnType<typeof vi.fn> } {
  const transport = new FakeTransport(scenario)
  const sleep = vi.fn(async () => undefined)
  const client = new GeminiClient({
    transport,
    retry: { maxAttempts: options?.maxAttempts ?? 2, baseDelayMs: 1, random: () => 0 },
    deadlines: options?.deadlines,
    sleep
  })
  return { client, transport, sleep }
}

async function capture(promise: Promise<unknown>): Promise<GeminiError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(GeminiError)
    return err as GeminiError
  }
  throw new Error('esperava um GeminiError, mas a chamada resolveu')
}

describe('GeminiClient: retry e taxonomia', () => {
  it('429 faz duas tentativas e respeita o teto', async () => {
    const error429 = Object.assign(new Error('rate limited'), { status: 429 })
    const { client, transport, sleep } = makeClient({
      streamErrors: [error429, error429, error429],
      streamSteps: [{ text: 'nunca usado' }]
    })

    const failure = await capture(client.streamText(BASE_REQUEST))

    expect(failure.kind).toBe('quota')
    expect(failure.retryable).toBe(true)
    expect(transport.streamAttempts).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('401 não tenta de novo', async () => {
    const error401 = Object.assign(new Error('unauthorized'), { status: 401 })
    const { client, transport, sleep } = makeClient({ streamErrors: [error401] })

    const failure = await capture(client.streamText(BASE_REQUEST))

    expect(failure.kind).toBe('auth')
    expect(failure.retryable).toBe(false)
    expect(transport.streamAttempts).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('timeout aborta a conexão e vira kind timeout', async () => {
    const { client, transport } = makeClient(
      { hang: true },
      { maxAttempts: 1, deadlines: { connectMs: 10, firstTokenMs: 40, totalMs: 200 } }
    )

    const startedAt = Date.now()
    const failure = await capture(client.streamText(BASE_REQUEST))

    expect(failure.kind).toBe('timeout')
    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(transport.streamAttempts).toBe(1)
  })

  it('erro desconhecido não vaza stack nem mensagem original', async () => {
    const sentinel = new Error('SEGREDO_INTERNO_XYZ')
    sentinel.stack = 'SEGREDO_INTERNO_XYZ\n    at stack-do-sdk.js:1:1'
    const { client } = makeClient({ generateErrors: [sentinel], generateSteps: [{ text: 'ok' }] })

    const failure = await capture(client.generateText(BASE_REQUEST))

    expect(failure.kind).toBe('unknown')
    expect(failure.message).toBe('Falha inesperada ao falar com o Gemini.')
    expect(JSON.stringify(failure)).not.toContain('SEGREDO_INTERNO_XYZ')
    expect(failure.stack ?? '').not.toContain('stack-do-sdk.js')
  })

  it('abort do usuário não é retry e vira cancelled', async () => {
    const { client, transport } = makeClient(
      { hang: true },
      { deadlines: { connectMs: 5_000, firstTokenMs: 5_000, totalMs: 10_000 } }
    )
    const controller = new AbortController()
    const pending = client.streamText(BASE_REQUEST, { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)

    const failure = await capture(pending)

    expect(failure.kind).toBe('cancelled')
    expect(failure.retryable).toBe(false)
    expect(transport.streamAttempts).toBe(1)
  })

  it('entrega deltas em ordem e soma usage do provedor', async () => {
    const { client } = makeClient({
      streamSteps: [
        { text: 'Olá' },
        { text: ', ' },
        { text: 'mundo', usage: { input: 12, output: 3, total: 15 } }
      ]
    })
    const deltas: string[] = []

    const result = await client.streamText(BASE_REQUEST, { onDelta: (text) => deltas.push(text) })

    expect(deltas.join('')).toBe('Olá, mundo')
    expect(result.text).toBe('Olá, mundo')
    expect(result.usage).toEqual({ input: 12, output: 3, total: 15 })
  })
})
