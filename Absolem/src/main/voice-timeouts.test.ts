import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../shared/config'
import {
  VoiceController,
  type VoiceSessionHandlers,
  type VoiceSessionLike
} from './voice/controller'

class FakeSession implements VoiceSessionLike {
  closes: string[] = []
  connect = vi.fn(async () => undefined)
  constructor(readonly handlers: VoiceSessionHandlers) {}
  sendAudio(): void {}
  sendText(): void {}
  interrupt(): void {}
  close(reason: string): void {
    this.closes.push(reason)
  }
  appendHistory(): void {}
}

function voiceConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    enabled: false,
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 1,
    maxSessionMinutes: 15,
    silenceTimeoutSeconds: 20,
    ...overrides
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function setup(overrides: Partial<VoiceConfig> = {}) {
  const sessions: FakeSession[] = []
  const notify = vi.fn()
  const controller = new VoiceController({
    getConfig: () => voiceConfig(overrides),
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
    isOverlayVisible: () => true,
    showOverlay: () => undefined,
    notify,
    memoryEnabled: () => false,
    history: { append: () => undefined }
  })
  controller.start()
  await flushAsync()
  return { controller, sessions, notify }
}

describe('timeouts da voz', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('20 s sem fala fecha', async () => {
    vi.useFakeTimers()
    const { controller, sessions, notify } = await setup({ silenceTimeoutSeconds: 20 })
    expect(controller.getState()).toBe('listening')

    vi.advanceTimersByTime(19_999)
    expect(controller.getState()).toBe('listening')

    vi.advanceTimersByTime(1)
    expect(controller.getState()).toBe('off')
    expect(sessions[0].closes).toEqual(['timeout-silence'])
    expect(notify).toHaveBeenCalledWith('Sessão de voz encerrada após 20 s sem fala.')
  })

  it('15 min fecha', async () => {
    vi.useFakeTimers()
    const { controller, sessions, notify } = await setup({
      maxSessionMinutes: 15,
      silenceTimeoutSeconds: 3600
    })

    vi.advanceTimersByTime(15 * 60 * 1000 - 1)
    expect(controller.getState()).toBe('listening')

    vi.advanceTimersByTime(1)
    expect(controller.getState()).toBe('off')
    expect(sessions[0].closes).toEqual(['timeout-max-duration'])
    expect(notify).toHaveBeenCalledWith('Sessão de voz encerrada após 15 min (limite de custo).')
  })

  it('hide fecha', async () => {
    const { controller, sessions } = await setup()

    controller.notifyOverlayHidden()

    expect(controller.getState()).toBe('off')
    expect(sessions[0].closes).toEqual(['hide'])
    expect(controller.status().sessionActive).toBe(false)
  })
})
