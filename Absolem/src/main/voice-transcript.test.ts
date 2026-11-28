import { describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../shared/config'
import type { VoiceStateChange, VoiceTranscriptPush } from '../shared/voice'
import {
  VoiceController,
  type VoiceHistoryTurn,
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
  const turns: VoiceHistoryTurn[] = []
  const started: Array<{ id: string; at: number }> = []
  const ended: Array<{ id: string; at: number }> = []
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
    now: () => 1234,
    history: {
      append: (role, text) => {
        appended.push({ role, text })
      },
      beginSession: (sessionId, at) => started.push({ id: sessionId, at }),
      endSession: (sessionId, at) => ended.push({ id: sessionId, at }),
      appendTurn: (turn) => turns.push(turn)
    }
  })
  controller.start()
  await flushAsync()
  return { controller, session: sessions[0], transcripts, appended, turns, started, ended }
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
    expect(on.appended).toEqual([])
    expect(on.turns).toEqual([
      {
        sessionId: on.started[0]?.id,
        role: 'user',
        content: 'lembre disso',
        at: 1234,
        interrupted: false
      }
    ])
  })

  it('memória ligada abre sessão, grava turno interrompido e encerra', async () => {
    const { controller, session, turns, started, ended } = await setup(true)

    expect(started).toHaveLength(1)
    session.handlers.onTranscript({ role: 'user', text: 'meu nome é Ana', final: true })
    session.handlers.onAudio(new Uint8Array([1, 2]), 24_000)
    session.handlers.onTranscript({ role: 'model', text: 'prazer', final: false })
    session.handlers.onInterrupted()

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ role: 'user', content: 'meu nome é Ana', interrupted: false })
    expect(turns[1]).toMatchObject({ role: 'model', content: 'prazer', interrupted: true })

    controller.stop()
    expect(ended).toHaveLength(1)
    expect(ended[0]?.id).toBe(started[0]?.id)
  })

  it('fim de turno não duplica a transcrição no turno seguinte', async () => {
    const { session, transcripts } = await setup()

    session.handlers.onTranscript({ role: 'model', text: 'primeira resposta', final: true })
    session.handlers.onAudio(new Uint8Array([1, 2]), 24_000)
    session.handlers.onTurnComplete()
    session.handlers.onTranscript({ role: 'model', text: 'segunda', final: false })

    expect(transcripts).toEqual([
      { role: 'model', text: 'primeira resposta', final: true, interrupted: false },
      { role: 'model', text: 'segunda', final: false, interrupted: false }
    ])
    expect(session.history).toEqual([{ role: 'model', text: 'primeira resposta' }])
  })
})
