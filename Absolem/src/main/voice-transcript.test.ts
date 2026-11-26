import { describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../shared/config'
import type { VoiceStateChange, VoiceTranscriptPush } from '../shared/voice'
import {
  VoiceController,
  type VoiceSessionHandlers,
  type VoiceSessionLike
} from './voice/controller'

class FakeSession implements VoiceSessionLike {
  closes: string[] = []
  history: Array<{ role: 'user' | 'model'; text: string }> = []
  connect = vi.fn(async () => undefined)
  constructor(readonly handlers: VoiceSessionHandlers) {}
  sendAudio(): void {}
  sendText(): void {}
  interrupt(): void {}
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

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function setup(memoryEnabled = false) {
  const sessions: FakeSession[] = []
  const transcripts: VoiceTranscriptPush[] = []
  const appended: Array<{ role: string; text: string }> = []
  const controller = new VoiceController({
    getConfig: voiceConfig,
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
    pushState: (_change: VoiceStateChange) => undefined,
    pushAudio: () => undefined,
    pushTranscript: (push) => transcripts.push(push),
    isOverlayVisible: () => true,
    showOverlay: () => undefined,
    notify: () => undefined,
    memoryEnabled: () => memoryEnabled,
    history: {
      append: (role, text) => {
        appended.push({ role, text })
      }
    }
  })
  controller.start()
  await flushAsync()
  return { controller, session: sessions[0], transcripts, appended }
}

describe('transcrição da voz', () => {
  it('parcial não substitui final', async () => {
    const { session, transcripts } = await setup()

    session.handlers.onTranscript({ role: 'user', text: 'olá', final: false })
    session.handlers.onTranscript({ role: 'user', text: 'olá mundo', final: true })
    session.handlers.onTranscript({ role: 'user', text: 'olá mundo de novo', final: false })

    expect(transcripts).toEqual([
      { role: 'user', text: 'olá', final: false, interrupted: false },
      { role: 'user', text: 'olá mundo', final: true, interrupted: false }
    ])
  })

  it('interrupted marca o turno', async () => {
    const { controller, session, transcripts } = await setup()

    session.handlers.onAudio(new Uint8Array([1, 2]), 24_000)
    expect(controller.getState()).toBe('speaking')
    session.handlers.onTranscript({ role: 'model', text: 'vou responder', final: false })
    session.handlers.onInterrupted()

    expect(transcripts[transcripts.length - 1]).toEqual({
      role: 'model',
      text: 'vou responder',
      final: false,
      interrupted: true
    })
    expect(session.history).toContainEqual({ role: 'model', text: 'vou responder' })
    expect(controller.getState()).toBe('listening')
  })

  it('sem memória nada é gravado', async () => {
    const off = await setup(false)
    off.session.handlers.onTranscript({ role: 'user', text: 'lembre disso', final: true })
    expect(off.appended).toEqual([])
    // O histórico em memória da sessão continua existindo para a reconexão.
    expect(off.session.history).toContainEqual({ role: 'user', text: 'lembre disso' })

    const on = await setup(true)
    on.session.handlers.onTranscript({ role: 'user', text: 'lembre disso', final: true })
    expect(on.appended).toEqual([{ role: 'user', text: 'lembre disso' }])
  })
})
