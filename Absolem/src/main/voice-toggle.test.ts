import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../shared/config'
import type { VoiceStateChange } from '../shared/voice'
import {
  VoiceController,
  type VoiceSessionHandlers,
  type VoiceSessionLike
} from './voice/controller'

/**
 * Toggle por clique/atalho e interrupt. Tudo com sessão fake: nenhuma rede,
 * nenhum microfone.
 */

class FakeSession implements VoiceSessionLike {
  readonly sent: Uint8Array[] = []
  interrupts = 0
  closes: string[] = []
  history: Array<{ role: 'user' | 'model'; text: string }> = []
  connect = vi.fn(async () => undefined)

  constructor(readonly handlers: VoiceSessionHandlers) {}

  sendAudio(pcm: Uint8Array): void {
    this.sent.push(pcm)
  }

  sendText(): void {}

  interrupt(): void {
    this.interrupts += 1
  }

  close(reason: string): void {
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
    maxSessionMinutes: 15,
    silenceTimeoutSeconds: 20
  }
}

function setup(overrides: { overlayVisible?: boolean; hasKey?: boolean } = {}) {
  const sessions: FakeSession[] = []
  const statePushes: VoiceStateChange[] = []
  const avatarStates: string[] = []
  const notify = vi.fn()
  const showOverlay = vi.fn()
  let config = voiceConfig()
  let consent = true

  const controller = new VoiceController({
    getConfig: () => config,
    updateConfig: (patch) => {
      config = { ...config, ...patch }
      return { success: true }
    },
    hasConsent: () => consent,
    persistConsent: (granted) => {
      consent = granted
      return { ok: true }
    },
    requestConsent: async () => true,
    hasApiKey: () => overrides.hasKey !== false,
    checkBudget: () => undefined,
    createSession: (handlers) => {
      const session = new FakeSession(handlers)
      sessions.push(session)
      return session
    },
    setAvatarState: (state) => avatarStates.push(state),
    pushState: (change) => statePushes.push(change),
    pushAudio: vi.fn(),
    pushTranscript: vi.fn(),
    isOverlayVisible: () => overrides.overlayVisible !== false,
    showOverlay,
    notify,
    memoryEnabled: () => false,
    history: { append: vi.fn() }
  })

  return {
    controller,
    sessions,
    statePushes,
    avatarStates,
    notify,
    showOverlay,
    getConfig: () => config
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('toggle da voz', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('toggle de off conecta', async () => {
    const { controller, sessions, statePushes, avatarStates } = setup()

    const result = controller.toggle()
    expect(result.state).toBe('connecting')
    await flushAsync()

    expect(sessions).toHaveLength(1)
    expect(sessions[0].connect).toHaveBeenCalledTimes(1)
    expect(controller.getState()).toBe('listening')
    expect(statePushes.map((push) => push.state)).toEqual(['connecting', 'listening'])
    expect(avatarStates).toEqual(['thinking', 'listening'])
  })

  it('toggle de listening encerra', async () => {
    const { controller, sessions, statePushes } = setup()
    controller.toggle()
    await flushAsync()

    const result = controller.toggle()
    await flushAsync()

    expect(result.state).toBe('off')
    expect(sessions[0].closes).toEqual(['user'])
    expect(statePushes.map((push) => push.state)).toEqual(['connecting', 'listening', 'off'])
    expect(controller.status().sessionActive).toBe(false)
  })

  it('overlay oculto não inicia captura', async () => {
    const { controller, sessions, showOverlay, notify } = setup({ overlayVisible: false })

    const result = controller.toggle('shortcut')

    expect(result.state).toBe('off')
    expect(sessions).toHaveLength(0)
    expect(showOverlay).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Absolem visível. Clique no avatar para falar.')
  })

  it('interrupt para a resposta sem encerrar a sessão', async () => {
    const { controller, sessions } = setup()
    controller.toggle()
    await flushAsync()
    const session = sessions[0]

    session.handlers.onAudio(new Uint8Array([1, 2]), 24_000)
    expect(controller.getState()).toBe('speaking')

    const result = controller.interrupt()

    expect(session.interrupts).toBe(1)
    expect(result.state).toBe('listening')
    expect(result.sessionActive).toBe(true)
    expect(session.closes).toEqual([])
  })

  it('troca de dispositivo no meio da sessão encerra antes de persistir', async () => {
    const { controller, sessions, getConfig } = setup()
    controller.toggle()
    await flushAsync()

    const result = controller.setDevice({ inputDeviceId: 'headset-usb' })

    expect(result.ok).toBe(true)
    expect(sessions[0].closes).toEqual(['device-changed'])
    expect(controller.getState()).toBe('off')
    expect(getConfig().inputDeviceId).toBe('headset-usb')
  })
})
