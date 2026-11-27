import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIVE_VOICE_NAME } from '../../shared/voice'
import { GeminiError } from './errors'
import { LiveSession, type LiveSessionHandlers } from './live'
import { FakeLiveTransport } from './testing/fakeLiveTransport'

function networkError(): Error {
  const error = new Error('socket hang up') as Error & { code: string }
  error.code = 'ECONNRESET'
  return error
}

function setup(
  handlers: LiveSessionHandlers = {},
  budgetError?: GeminiError,
  voiceName: string = LIVE_VOICE_NAME
) {
  const transport = new FakeLiveTransport()
  const records: Array<{ input: number; output: number }> = []
  const checkBudget = vi.fn(() => {
    if (budgetError) throw budgetError
  })
  const usage = {
    checkBudget,
    record: (amounts: { input: number; output: number }) => {
      records.push(amounts)
      return {}
    }
  }
  const session = new LiveSession({
    transport,
    keys: { getApiKey: () => 'chave-de-teste' },
    usage,
    model: 'gemini-live-teste',
    voiceName,
    temperature: 0.4,
    systemInstruction: 'Você é o Absolem.',
    handlers,
    sleep: async () => undefined,
    now: () => 10_000
  })
  return { transport, session, records, checkBudget }
}

describe('sessão Live no main', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('conecta e envia áudio', async () => {
    const onAudio = vi.fn()
    const { transport, session } = setup({ onAudio })
    await session.connect()

    expect(transport.connects).toHaveLength(1)
    expect(transport.connects[0]).toMatchObject({
      model: 'gemini-live-teste',
      voiceName: LIVE_VOICE_NAME,
      temperature: 0.4,
      systemInstruction: 'Você é o Absolem.'
    })

    session.sendAudio(new Uint8Array([1, 2, 3, 4]))
    expect(transport.last?.audio).toHaveLength(1)
    expect(Array.from(transport.last?.audio[0] ?? [])).toEqual([1, 2, 3, 4])

    transport.last?.emit({
      type: 'audio',
      data: new Uint8Array([9, 8]),
      sampleRate: 24_000
    })
    expect(onAudio).toHaveBeenCalledWith(new Uint8Array([9, 8]), 24_000)

    session.close('teste')
  })

  it('erro de rede reconecta uma vez', async () => {
    const onError = vi.fn()
    const { transport, session } = setup({ onError })
    transport.failures = [networkError()]

    await session.connect()

    expect(transport.connects).toHaveLength(2)
    expect(transport.connects[0]?.voiceName).toBe(LIVE_VOICE_NAME)
    expect(transport.connects[1]?.voiceName).toBe(LIVE_VOICE_NAME)
    expect(session.isConnected()).toBe(true)
    expect(onError).not.toHaveBeenCalled()
    session.close('teste')
  })

  it('segunda falha vira error', async () => {
    const onError = vi.fn()
    const onClose = vi.fn()
    const { transport, session } = setup({ onError, onClose })
    transport.failures = [networkError(), networkError()]

    await expect(session.connect()).rejects.toMatchObject({ kind: 'network' })

    expect(transport.connects).toHaveLength(2)
    expect(session.isConnected()).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ kind: 'network' })
    expect(onClose).toHaveBeenCalledWith('error')
  })

  it('teto bloqueado não conecta', async () => {
    const { transport, session, checkBudget } = setup(
      {},
      new GeminiError('quota', 'Limite mensal de tokens atingido.')
    )

    await expect(session.connect()).rejects.toMatchObject({ kind: 'quota' })
    expect(checkBudget).toHaveBeenCalledTimes(1)
    expect(transport.connects).toHaveLength(0)
  })

  it('devolve toolResponse ao Live', async () => {
    const { transport, session } = setup()
    await session.connect()

    session.sendToolResponse([
      { name: 'get_current_time', response: { ok: true, result: { iso: '12:00' } } }
    ])

    expect(transport.last?.toolResponses[0]).toEqual([
      { name: 'get_current_time', response: { ok: true, result: { iso: '12:00' } } }
    ])
    session.close('teste')
  })

  it('reconecta após erro em sessão e mantém a voz', async () => {
    const { transport, session } = setup()
    await session.connect()

    transport.last?.emit({ type: 'error', error: networkError() })

    await vi.waitFor(() => expect(transport.connects).toHaveLength(2))
    expect(transport.connects[0]?.voiceName).toBe(LIVE_VOICE_NAME)
    expect(transport.connects[1]?.voiceName).toBe(LIVE_VOICE_NAME)
    expect(session.isConnected()).toBe(true)
    session.close('teste')
  })

  it('loga detalhe sanitizado quando a conexão falha', async () => {
    const warnings: Array<Record<string, unknown>> = []
    const transport = new FakeLiveTransport()
    const session = new LiveSession({
      transport,
      keys: { getApiKey: () => 'chave-de-teste' },
      usage: { checkBudget: () => undefined, record: () => ({}) },
      model: 'gemini-live-teste',
      maxAttempts: 1,
      sleep: async () => undefined,
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: (_scope: string, _message: unknown, ...args: unknown[]) => {
          warnings.push((args[0] ?? {}) as Record<string, unknown>)
        }
      }
    })
    transport.failures = [new Error('INVALID_ARGUMENT: api_key=segredo-nao-pode-vazar')]

    await expect(session.connect()).rejects.toMatchObject({ kind: 'invalid' })

    expect(warnings[0]).toMatchObject({
      kind: 'invalid',
      detail: 'INVALID_ARGUMENT: api_key=[redigido]'
    })
  })

  it('close é idempotente e contabiliza o áudio uma vez', async () => {
    const onClose = vi.fn()
    const { transport, session, records } = setup({ onClose })
    await session.connect()
    session.sendAudio(new Uint8Array(32_000))

    session.close('usuário')
    session.close('usuário')

    expect(transport.last?.closes).toBe(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('usuário')
    expect(records).toHaveLength(1)
    expect(records[0]).toEqual({ input: 32, output: 0 })
  })
})
