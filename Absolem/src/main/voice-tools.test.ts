import { describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../shared/config'
import type { GeminiFunctionCall, GeminiFunctionResponse } from './gemini/transport'
import type { ToolDefinition } from '../shared/tools'
import { createToolRegistry } from './gemini/tools/registry'
import { routeToolCall, type ToolCallResult } from './gemini/tools/router'
import {
  VoiceController,
  type VoiceSessionHandlers,
  type VoiceSessionLike
} from './voice/controller'

/**
 * Ferramentas na voz (T10b): o `onToolCall` do Live passa pelo MESMO roteador
 * da conversa de texto e devolve `sendToolResponse`. Nenhuma rede/microfone.
 */

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

class FakeSession implements VoiceSessionLike {
  readonly toolResponses: GeminiFunctionResponse[][] = []
  readonly history: Array<{ role: 'user' | 'model'; text: string }> = []
  connect = vi.fn(async () => undefined)

  constructor(readonly handlers: VoiceSessionHandlers) {}

  sendAudio(): void {}
  sendText(): void {}
  interrupt(): void {}
  close(): void {}

  appendHistory(role: 'user' | 'model', text: string): void {
    this.history.push({ role, text })
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

function setup(routeToolCall: (call: GeminiFunctionCall) => Promise<ToolCallResult>) {
  const sessions: FakeSession[] = []
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
    history: { append: () => undefined }
  })
  return { controller, sessions }
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

describe('ferramentas na voz (T10b)', () => {
  it('onToolCall roteia e responde ao Live', async () => {
    const registry = createToolRegistry()
    expect(registry.registerTool(TIME_TOOL).ok).toBe(true)
    const handler = vi.fn(() => ({ iso: '2026-11-26T12:00:00.000Z' }))
    const route = (call: GeminiFunctionCall) =>
      routeToolCall(
        {
          registry,
          getHandler: () => handler,
          getPermission: () => 'allow',
          confirm: async () => true,
          confirmTimeoutMs: 10
        },
        call
      )
    const { controller, sessions } = setup(route)
    controller.toggle()
    await flushAsync()

    sessions[0]?.handlers.onToolCall([{ id: 'call-voice-1', name: 'get_current_time', args: {} }])
    await flushAsync()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(sessions[0]?.toolResponses[0]).toEqual([
      {
        id: 'call-voice-1',
        name: 'get_current_time',
        response: { ok: true, result: { iso: '2026-11-26T12:00:00.000Z' } }
      }
    ])
    expect(controller.getState()).toBe('listening')
  })

  it('deny em voz não executa e responde erro ao Live', async () => {
    const registry = createToolRegistry()
    expect(registry.registerTool(TIME_TOOL).ok).toBe(true)
    const handler = vi.fn(() => ({ iso: 'nunca' }))
    const route = (call: GeminiFunctionCall) =>
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
    const { controller, sessions } = setup(route)
    controller.toggle()
    await flushAsync()

    sessions[0]?.handlers.onToolCall([{ name: 'get_current_time', args: {} }])
    await flushAsync()

    expect(handler).not.toHaveBeenCalled()
    expect(sessions[0]?.toolResponses[0]?.[0]?.response).toMatchObject({
      ok: false,
      error: { kind: 'denied' }
    })
    expect('id' in sessions[0]!.toolResponses[0]![0]!).toBe(false)
    // Falha de ferramenta não fecha a sessão.
    expect(controller.getState()).toBe('listening')
  })

  it('registra no histórico do Live a mensagem de cada resultado ok', async () => {
    const { controller, sessions } = setup(async () => ({
      ok: true,
      result: { message: 'Abri o site que você pediu.' }
    }))
    controller.toggle()
    await flushAsync()

    sessions[0]?.handlers.onToolCall([
      { id: 'call-a', name: 'get_current_time', args: {} },
      { id: 'call-b', name: 'get_current_time', args: {} }
    ])
    await flushAsync()

    expect(sessions[0]?.history).toEqual([
      { role: 'model', text: 'Abri o site que você pediu.' },
      { role: 'model', text: 'Abri o site que você pediu.' }
    ])
  })

  it('não registra histórico sintético quando o resultado não tem message', async () => {
    const { controller, sessions } = setup(async () => ({
      ok: true,
      result: { iso: '2026-11-26T12:00:00.000Z' }
    }))
    controller.toggle()
    await flushAsync()

    sessions[0]?.handlers.onToolCall([{ id: 'call-sem-msg', name: 'get_current_time', args: {} }])
    await flushAsync()

    expect(sessions[0]?.history).toEqual([])
  })

  it('limita a mensagem do histórico a 200 caracteres', async () => {
    const longMessage = 'a'.repeat(250)
    const { controller, sessions } = setup(async () => ({
      ok: true,
      result: { message: longMessage }
    }))
    controller.toggle()
    await flushAsync()

    sessions[0]?.handlers.onToolCall([{ id: 'call-longa', name: 'get_current_time', args: {} }])
    await flushAsync()

    expect(sessions[0]?.history).toEqual([{ role: 'model', text: 'a'.repeat(200) }])
  })
})
