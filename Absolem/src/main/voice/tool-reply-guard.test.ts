import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../../shared/config'
import type { GeminiFunctionCall, GeminiFunctionResponse } from '../gemini/transport'
import type { ToolCallResult } from '../gemini/tools/router'
import {
  TOOL_REPLY_GUARD_MS,
  TOOL_REPLY_NUDGE,
  VoiceController,
  type VoiceSessionHandlers,
  type VoiceSessionLike
} from './controller'

/**
 * Vigia de confirmação da voz (T4): depois de `sendToolResponse`, o modelo tem
 * 6 s ou até o `onTurnComplete` para falar o resultado. Sem fala, UM nudge.
 * Timers falsos, sem rede e sem microfone.
 */

class FakeSession implements VoiceSessionLike {
  readonly toolResponses: GeminiFunctionResponse[][] = []
  readonly texts: string[] = []
  connect = vi.fn(async () => undefined)

  constructor(readonly handlers: VoiceSessionHandlers) {}

  sendAudio(): void {}
  interrupt(): void {}
  close(): void {}
  appendHistory(): void {}

  sendText(text: string): void {
    this.texts.push(text)
  }

  sendToolResponse(responses: GeminiFunctionResponse[]): void {
    this.toolResponses.push(responses)
  }
}

function voiceConfig(): VoiceConfig {
  return {
    enabled: false,
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 1,
    maxSessionMinutes: 15,
    silenceTimeoutSeconds: 20
  }
}

function setup(
  routeToolCall: (call: GeminiFunctionCall) => Promise<ToolCallResult> = async () => ({
    ok: true,
    result: { message: 'Abri o aplicativo Insomnia.' }
  })
) {
  const sessions: FakeSession[] = []
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const controller = new VoiceController({
    getConfig: () => voiceConfig(),
    updateConfig: () => ({ success: true }),
    hasConsent: () => true,
    persistConsent: () => ({ ok: true }),
    requestConsent: async () => true,
    hasApiKey: () => true,
    checkBudget: () => undefined,
    createSession: (handlers) => {
      const session = new FakeSession(handlers)
      sessions.push(session)
      return session
    },
    setAvatarState: () => undefined,
    pushState: () => undefined,
    pushAudio: () => undefined,
    pushTranscript: () => undefined,
    routeToolCall,
    isOverlayVisible: () => true,
    showOverlay: () => undefined,
    notify: () => undefined,
    memoryEnabled: () => false,
    history: { append: () => undefined },
    logger
  })
  return { controller, sessions, logger }
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

function requireSession(sessions: FakeSession[]): FakeSession {
  const session = sessions[0]
  if (!session) throw new Error('sessão de voz ausente')
  return session
}

async function startedWithToolCall() {
  const { controller, sessions } = setup()
  controller.toggle()
  await flushAsync()
  const session = requireSession(sessions)
  session.handlers.onToolCall([{ name: 'open_app', args: { name: 'Insomnia' } }])
  await flushAsync()
  return { controller, session }
}

describe('vigia de confirmação depois de ferramenta (voz)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('modelo fala o resultado: nenhum nudge', async () => {
    const { controller, session } = await startedWithToolCall()

    session.handlers.onAudio(new Uint8Array([0, 0]), 24_000)
    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS * 2)
    session.handlers.onTurnComplete()

    expect(session.toolResponses).toHaveLength(1)
    expect(session.texts).toEqual([])
    controller.stop()
  })

  it('transcrição do modelo também conta como resposta', async () => {
    const { controller, session } = await startedWithToolCall()

    session.handlers.onTranscript({
      role: 'model',
      text: 'Abri o aplicativo Insomnia.',
      final: true
    })
    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS * 2)

    expect(session.texts).toEqual([])
    controller.stop()
  })

  it('onTurnComplete sem fala: um nudge imediato', async () => {
    const { controller, session } = await startedWithToolCall()

    session.handlers.onTurnComplete()

    expect(session.texts).toEqual([TOOL_REPLY_NUDGE])
    controller.stop()
  })

  it('6 s sem nada: um nudge', async () => {
    const { controller, session } = await startedWithToolCall()

    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS - 1)
    expect(session.texts).toEqual([])

    vi.advanceTimersByTime(1)
    expect(session.texts).toEqual([TOOL_REPLY_NUDGE])
    controller.stop()
  })

  it('nunca envia um segundo nudge na mesma rodada', async () => {
    const { controller, session } = await startedWithToolCall()

    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS)
    expect(session.texts).toHaveLength(1)

    session.handlers.onTurnComplete()
    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS * 3)
    expect(session.texts).toHaveLength(1)
    controller.stop()
  })

  it('segunda ferramenta em andamento cancela o vigia da primeira', async () => {
    let releaseSecond: (() => void) | undefined
    const routeToolCall = vi.fn(async (call: GeminiFunctionCall): Promise<ToolCallResult> => {
      if (call.name === 'open_app') {
        // Rodada 2 demorada (open_app espera o app abrir): só resolve quando
        // o teste avançar o relógio e liberar a promise manualmente.
        await new Promise<void>((resolve) => {
          releaseSecond = resolve
        })
      }
      return { ok: true, result: { message: 'Abri o aplicativo Insomnia.' } }
    })
    const { controller, sessions } = setup(routeToolCall)
    controller.toggle()
    await flushAsync()
    const session = requireSession(sessions)

    // Rodada 1 (list_apps) rápida: arma o vigia.
    session.handlers.onToolCall([{ name: 'list_apps', args: {} }])
    await flushAsync()
    expect(session.toolResponses).toHaveLength(1)

    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS - 1)

    // Rodada 2 (open_app) ainda rodando: o vigia da rodada 1 deve morrer aqui.
    session.handlers.onToolCall([{ name: 'open_app', args: { name: 'Insomnia' } }])
    await flushAsync()
    expect(releaseSecond).toBeTypeOf('function')

    // Se o timer antigo tivesse vazado, o nudge sairia no meio da ação.
    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS * 2)
    expect(session.texts).toEqual([])

    if (!releaseSecond) throw new Error('segunda ferramenta não iniciou')
    releaseSecond()
    await flushAsync()
    expect(session.toolResponses).toHaveLength(2)

    // Sem fala depois da rodada 2: exatamente um nudge.
    session.handlers.onTurnComplete()
    expect(session.texts).toEqual([TOOL_REPLY_NUDGE])

    controller.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop cancela o vigia', async () => {
    const { controller, session } = await startedWithToolCall()

    controller.stop()
    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS * 3)

    expect(session.texts).toEqual([])
  })

  it('onClose cancela o vigia', async () => {
    const { controller, session } = await startedWithToolCall()

    session.handlers.onClose('fechada')
    vi.advanceTimersByTime(TOOL_REPLY_GUARD_MS * 3)

    expect(session.texts).toEqual([])
    controller.stop()
  })

  it('registra apenas metadados de captura e transcrição', async () => {
    const { controller, sessions, logger } = setup()
    controller.toggle()
    await flushAsync()
    const session = requireSession(sessions)
    controller.handleAudioChunk(new Uint8Array([1, 2, 3, 4]))
    const secret = 'conteúdo privado de teste'
    session.handlers.onTranscript({
      role: 'user',
      text: secret,
      final: true
    })

    const calls = JSON.stringify(logger.debug.mock.calls)
    expect(calls).not.toContain('conteúdo privado de teste')
    expect(calls).toContain('"bytes":4')
    expect(calls).toContain(`"chars":${secret.length}`)
    controller.stop()
  })
})
