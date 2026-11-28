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

  it('loga somente metadados de áudio e transcrição', async () => {
    const entries: unknown[] = []
    const secret = 'frase privada que não pode aparecer'
    const transport = new FakeLiveTransport()
    const diagnosticSession = new LiveSession({
      transport,
      keys: { getApiKey: () => 'chave-de-teste' },
      usage: { checkBudget: () => undefined, record: () => ({}) },
      model: 'gemini-live-teste',
      handlers: { onTranscript: () => undefined },
      logger: {
        debug: (_scope, _message, ...args) => entries.push(args[0]),
        info: () => undefined,
        warn: () => undefined
      },
      sleep: async () => undefined
    })

    await diagnosticSession.connect()
    diagnosticSession.sendAudio(new Uint8Array([1, 2, 3, 4]))
    transport.last?.emit({ type: 'transcript', role: 'user', text: secret, final: true })

    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('"bytes":4')
    expect(serialized).toContain(`"chars":${secret.length}`)
    diagnosticSession.close('teste')
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

  it('loga tipo sanitizado quando a conexão falha', async () => {
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

    expect(warnings[0]).toMatchObject({ kind: 'invalid', attempt: 1, retryable: false })
    expect(JSON.stringify(warnings)).not.toContain('segredo-nao-pode-vazar')
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

  it('preserva áudio e tool response durante a reconexão e envia uma vez', async () => {
    const sleepControl: { release: (() => void) | null } = { release: null }
    const transport = new FakeLiveTransport()
    const session = new LiveSession({
      transport,
      keys: { getApiKey: () => 'chave-de-teste' },
      usage: { checkBudget: () => undefined, record: () => ({}) },
      model: 'gemini-live-teste',
      sleep: () =>
        new Promise<void>((resolve) => {
          sleepControl.release = resolve
        })
    })
    await session.connect()

    transport.last?.emit({ type: 'error', error: networkError() })
    session.sendAudio(new Uint8Array([1, 2, 3, 4]))
    session.sendAudio(new Uint8Array([5, 6]))
    session.sendToolResponse([{ name: 'get_current_time', response: { ok: true } }])

    expect(session.getStats()).toMatchObject({
      bufferedAudioChunks: 2,
      bufferedAudioBytes: 6,
      pendingToolResponses: 1
    })
    expect(transport.last?.audio).toHaveLength(0)

    sleepControl.release?.()
    await vi.waitFor(() => expect(transport.connects).toHaveLength(2))
    await vi.waitFor(() => expect(transport.last?.audio).toHaveLength(2))

    expect(Array.from(transport.last?.audio[0] ?? [])).toEqual([1, 2, 3, 4])
    expect(Array.from(transport.last?.audio[1] ?? [])).toEqual([5, 6])
    expect(transport.last?.toolResponses).toHaveLength(1)
    expect(session.getStats()).toMatchObject({
      bufferedAudioChunks: 0,
      bufferedAudioBytes: 0,
      pendingToolResponses: 0,
      sentAudioChunks: 2
    })
    session.close('teste')
  })

  it('novo erro depois da reconexão encerra em vez de ficar mudo', async () => {
    const onError = vi.fn()
    const { transport, session } = setup({ onError })
    await session.connect()

    transport.last?.emit({ type: 'error', error: networkError() })
    await vi.waitFor(() => expect(transport.connects).toHaveLength(2))
    expect(session.isConnected()).toBe(true)

    transport.last?.emit({ type: 'error', error: networkError() })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(session.isClosed()).toBe(true)
    expect(session.getStats()).toMatchObject({ attempts: 2, reconnects: 1 })
  })

  it('close durante a reconexão não abre conexão órfã', async () => {
    const sleepControl: { release: (() => void) | null } = { release: null }
    const transport = new FakeLiveTransport()
    const session = new LiveSession({
      transport,
      keys: { getApiKey: () => 'chave-de-teste' },
      usage: { checkBudget: () => undefined, record: () => ({}) },
      model: 'gemini-live-teste',
      sleep: () =>
        new Promise<void>((resolve) => {
          sleepControl.release = resolve
        })
    })
    await session.connect()
    transport.last?.emit({ type: 'error', error: networkError() })
    session.sendAudio(new Uint8Array([1, 2]))

    session.close('teste')
    sleepControl.release?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(transport.connects).toHaveLength(1)
    expect(session.getStats().bufferedAudioBytes).toBe(0)
    expect(session.isClosed()).toBe(true)
  })

  it('eventos do servidor depois do close são descartados', async () => {
    const onAudio = vi.fn()
    const onTranscript = vi.fn()
    const onToolCall = vi.fn()
    const onTurnComplete = vi.fn()
    const onClose = vi.fn()
    const { transport, session } = setup({
      onAudio,
      onTranscript,
      onToolCall,
      onTurnComplete,
      onClose
    })
    await session.connect()
    session.close('usuário')

    transport.last?.emit({ type: 'audio', data: new Uint8Array([1]), sampleRate: 24_000 })
    transport.last?.emit({ type: 'transcript', role: 'model', text: 'tardio', final: true })
    transport.last?.emit({ type: 'toolCall', calls: [{ name: 'get_current_time', args: {} }] })
    transport.last?.emit({ type: 'turnComplete' })

    expect(onAudio).not.toHaveBeenCalled()
    expect(onTranscript).not.toHaveBeenCalled()
    expect(onToolCall).not.toHaveBeenCalled()
    expect(onTurnComplete).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(transport.last?.closes).toBe(1)
  })

  it('100 sessões concorrentes fecham uma vez e não deixam callbacks tardios', async () => {
    const startedAt = performance.now()
    const results = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const calls = {
          audio: 0,
          transcript: 0,
          tool: 0,
          turn: 0,
          close: 0
        }
        const { transport, session } = setup({
          onAudio: () => {
            calls.audio += 1
          },
          onTranscript: () => {
            calls.transcript += 1
          },
          onToolCall: () => {
            calls.tool += 1
          },
          onTurnComplete: () => {
            calls.turn += 1
          },
          onClose: () => {
            calls.close += 1
          }
        })
        await session.connect()
        session.sendAudio(new Uint8Array([1, 2]))
        for (let index = 0; index < 100; index += 1) session.close('fim')
        transport.last?.emit({ type: 'audio', data: new Uint8Array([3]), sampleRate: 24_000 })
        transport.last?.emit({ type: 'turnComplete' })
        return { calls, closes: transport.last?.closes ?? 0, stats: session.getStats() }
      })
    )

    expect(performance.now() - startedAt).toBeLessThan(2_000)
    for (const result of results) {
      expect(result.closes).toBe(1)
      expect(result.calls).toEqual({ audio: 0, transcript: 0, tool: 0, turn: 0, close: 1 })
      expect(result.stats.bufferedAudioBytes).toBe(0)
      expect(result.stats.bufferedAudioChunks).toBe(0)
    }
  })

  it('close durante o connect fecha a conexão que chegar depois', async () => {
    const control: { release: ((connection: unknown) => void) | null } = { release: null }
    const connection = {
      sendAudio: vi.fn(),
      sendText: vi.fn(),
      sendImage: vi.fn(),
      sendImageAndText: vi.fn(),
      sendToolResponse: vi.fn(),
      interrupt: vi.fn(),
      close: vi.fn()
    }
    const transport = {
      connect: () =>
        new Promise((resolve) => {
          control.release = resolve
        })
    }
    const session = new LiveSession({
      transport: transport as never,
      keys: { getApiKey: () => 'chave-de-teste' },
      usage: { checkBudget: () => undefined, record: () => ({}) },
      model: 'gemini-live-teste'
    })

    const connecting = session.connect()
    session.close('cancelado')
    control.release?.(connection)
    await connecting

    expect(connection.close).toHaveBeenCalledTimes(1)
    expect(session.isClosed()).toBe(true)
    expect(session.isConnected()).toBe(false)
  })
})
