import { describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../../shared/config'
import type { VoiceStateChange } from '../../shared/voice'
import { VoiceController, type VoiceSessionHandlers, type VoiceSessionLike } from './controller'

/**
 * Concorrência da voz (task 05): start/stop, cancelamento durante o connect e
 * shutdown. Sessão, relógio e pushes falsos; nenhuma rede/microfone.
 */

class FakeSession implements VoiceSessionLike {
  readonly closes: string[] = []
  readonly history: Array<{ role: 'user' | 'model'; text: string }> = []
  sent: Uint8Array[] = []
  interrupts = 0
  connect = vi.fn(async () => undefined)
  private closed = false

  constructor(readonly handlers: VoiceSessionHandlers) {}

  sendAudio(pcm: Uint8Array): void {
    this.sent.push(pcm)
  }

  sendText(): void {}

  sendToolResponse(): void {}

  interrupt(): void {
    this.interrupts += 1
  }

  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.closes.push(reason)
  }

  appendHistory(role: 'user' | 'model', text: string): void {
    this.history.push({ role, text })
  }
}

function voiceConfig(): VoiceConfig {
  return {
    enabled: false,
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 1,
    maxSessionMinutes: 60,
    silenceTimeoutSeconds: 60
  }
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve()
}

function setup(options: { deferredConnect?: boolean } = {}) {
  const sessions: FakeSession[] = []
  const statePushes: VoiceStateChange[] = []
  const audio: unknown[] = []
  const transcripts: unknown[] = []
  const routeToolCall = vi.fn(async () => ({ ok: true as const, result: null }))
  let releaseConnect: (() => void) | null = null
  const config = voiceConfig()

  const controller = new VoiceController({
    getConfig: () => config,
    updateConfig: () => ({ success: true }),
    hasConsent: () => true,
    persistConsent: () => ({ ok: true }),
    requestConsent: async () => true,
    hasApiKey: () => true,
    checkBudget: () => undefined,
    createSession: (handlers) => {
      const session = new FakeSession(handlers)
      if (options.deferredConnect) {
        session.connect = vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseConnect = resolve
            })
        )
      }
      sessions.push(session)
      return session
    },
    setAvatarState: () => undefined,
    pushState: (change) => statePushes.push(change),
    pushAudio: (push) => audio.push(push),
    pushTranscript: (push) => transcripts.push(push),
    routeToolCall,
    isOverlayVisible: () => true,
    showOverlay: () => undefined,
    notify: () => undefined,
    memoryEnabled: () => false,
    history: { append: vi.fn() }
  })

  return {
    controller,
    sessions,
    statePushes,
    audio,
    transcripts,
    routeToolCall,
    releaseConnect: () => releaseConnect?.()
  }
}

describe('concorrência da voz', () => {
  it('100 ciclos start/stop fecham cada sessão uma única vez', async () => {
    const { controller, sessions } = setup()
    const startedAt = performance.now()

    for (let cycle = 0; cycle < 100; cycle += 1) {
      expect(controller.start().state).toBe('connecting')
      await flushAsync()
      expect(controller.getState()).toBe('listening')
      controller.stop()
      controller.stop()
    }

    expect(performance.now() - startedAt).toBeLessThan(2_000)
    expect(sessions).toHaveLength(100)
    for (const session of sessions) expect(session.closes).toEqual(['user'])
    expect(controller.getState()).toBe('off')
  })

  it('stop durante o connect descarta a sessão tardia e eventos seguintes', async () => {
    const { controller, sessions, audio, transcripts, routeToolCall, releaseConnect } = setup({
      deferredConnect: true
    })

    controller.start()
    await flushAsync()
    expect(sessions).toHaveLength(1)
    controller.stop()
    releaseConnect()
    await flushAsync()

    expect(sessions[0]?.closes).toEqual(['user'])
    expect(controller.getState()).toBe('off')

    sessions[0]?.handlers.onAudio(new Uint8Array([1, 2]), 24_000)
    sessions[0]?.handlers.onTranscript({ role: 'model', text: 'tardio', final: true })
    sessions[0]?.handlers.onToolCall([{ name: 'get_current_time', args: {} }])
    await flushAsync()

    expect(audio).toHaveLength(0)
    expect(transcripts).toHaveLength(0)
    expect(routeToolCall).not.toHaveBeenCalled()
  })

  it('shutdown encerra a sessão ativa uma única vez', async () => {
    const { controller, sessions } = setup()
    controller.start()
    await flushAsync()

    controller.shutdown()
    controller.shutdown()

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.closes).toEqual(['shutdown'])
    expect(controller.getState()).toBe('off')
  })

  it('barge-in sem sessão não arma timer nem altera o estado', () => {
    const { controller } = setup()
    controller.handleBargeIn()
    expect(controller.getState()).toBe('off')
    expect(controller.status().sessionActive).toBe(false)
  })
})
