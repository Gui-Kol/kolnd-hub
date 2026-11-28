import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../../src/shared/config'
import { LiveSession } from '../../src/main/gemini/live'
import { FakeLiveTransport } from '../../src/main/gemini/testing/fakeLiveTransport'
import { VoiceController, type VoiceSessionHandlers } from '../../src/main/voice/controller'
import { createVad } from '../../src/renderer/src/audio/vad'
import {
  createPlayback,
  type AudioBufferLike,
  type AudioBufferSourceLike,
  type AudioParamLike,
  type GainNodeLike,
  type PlaybackAudioContextLike
} from '../../src/renderer/src/audio/playback'

/**
 * Integração de barge-in (T11), sem microfone e sem arquivo de áudio:
 * - o áudio de fala é gerado em código (senoide);
 * - o relógio é `performance.now()` falso e controlado;
 * - o transporte Live é o fake da task 06;
 * - VAD -> playback.flush() -> controlador -> LiveConnection.interrupt().
 *
 * A asserção registra a latência medida e exige menos de 300 ms.
 */

const FRAME_MS = 20
const FRAME_SAMPLES = 320

function config(): VoiceConfig {
  return {
    enabled: false,
    inputDeviceId: null,
    outputDeviceId: null,
    outputVolume: 1,
    maxSessionMinutes: 15,
    silenceTimeoutSeconds: 20
  }
}

function speechFrame(index: number): Float32Array {
  const frame = new Float32Array(FRAME_SAMPLES)
  for (let sample = 0; sample < FRAME_SAMPLES; sample += 1) {
    const t = (index * FRAME_SAMPLES + sample) / 16_000
    frame[sample] = Math.sin(2 * Math.PI * 220 * t) * 0.5
  }
  return frame
}

function noiseFrame(): Float32Array {
  return new Float32Array(FRAME_SAMPLES).fill(0.001)
}

function fakePlayback(clock: { now: number }) {
  const sources: AudioBufferSourceLike[] = []
  const gain: AudioParamLike = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn()
  }
  const master: GainNodeLike = { gain, connect: vi.fn(), disconnect: vi.fn() }
  const context = {
    get currentTime() {
      return clock.now / 1000
    },
    destination: {},
    createBuffer: (_channels: number, length: number, sampleRate: number): AudioBufferLike => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length)
    }),
    createBufferSource: (): AudioBufferSourceLike => {
      const source: AudioBufferSourceLike = {
        buffer: null,
        onended: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      }
      sources.push(source)
      return source
    },
    createGain: () => master
  } as PlaybackAudioContextLike
  return { playback: createPlayback({ context, headroomMs: 60 }), sources, gain }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('barge-in com áudio sintético', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fala durante speaking interrompe em menos de 300 ms', async () => {
    const clock = { now: 0 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now)

    const transport = new FakeLiveTransport()
    const usage = { checkBudget: () => undefined, record: () => undefined }
    const { playback, sources, gain } = fakePlayback(clock)

    let session: LiveSession | null = null
    const controller = new VoiceController({
      getConfig: config,
      updateConfig: () => ({ success: true }),
      hasConsent: () => true,
      persistConsent: () => ({ ok: true }),
      requestConsent: async () => true,
      hasApiKey: () => true,
      checkBudget: () => undefined,
      createSession: (handlers: VoiceSessionHandlers) => {
        session = new LiveSession({
          transport,
          keys: { getApiKey: () => 'chave-de-teste' },
          usage,
          model: 'gemini-live-teste',
          temperature: 0.7,
          systemInstruction: 'Teste.',
          handlers,
          sleep: async () => undefined
        })
        return session
      },
      setAvatarState: () => undefined,
      pushState: () => undefined,
      pushAudio: (push) => playback.enqueue(push.data, push.sampleRate),
      pushTranscript: () => undefined,
      isOverlayVisible: () => true,
      showOverlay: () => undefined,
      notify: () => undefined,
      memoryEnabled: () => false,
      history: { append: () => undefined }
    })

    controller.start()
    await flushAsync()
    expect(controller.getState()).toBe('listening')
    expect(session).not.toBeNull()

    // O modelo começa a falar: um chunk PCM16 24 kHz de 100 ms chega ao
    // playback e o estado vira speaking.
    const modelAudio = new Uint8Array(4800)
    const view = new DataView(modelAudio.buffer)
    for (let index = 0; index < 2400; index += 1) view.setInt16(index * 2, 0x3000, true)
    transport.last?.emit({ type: 'audio', data: modelAudio, sampleRate: 24_000 })
    expect(controller.getState()).toBe('speaking')
    expect(playback.pending()).toBe(1)

    const vad = createVad()
    let latency: number | null = null
    let speechOnset: number | null = null

    // 300 ms de ruído (não dispara) seguidos de fala sintética.
    for (let index = 0; index < 15; index += 1) {
      clock.now += FRAME_MS
      vad.process(noiseFrame(), clock.now)
    }
    for (let index = 0; index < 20; index += 1) {
      clock.now += FRAME_MS
      if (speechOnset === null) speechOnset = clock.now - FRAME_MS
      const events = vad.process(speechFrame(index), clock.now)
      for (const event of events) {
        if (event.type !== 'speech-start') continue
        // Ordem real do overlay: corta o áudio local e avisa o main.
        playback.flush()
        controller.handleBargeIn()
        // O push `voice:state` (listening/barge-in) chega logo depois e chama
        // flush de novo; sem buffers pendentes isso não refaz a rampa.
        playback.flush()
        latency = performance.now() - (speechOnset ?? 0)
      }
      if (latency !== null) break
    }

    expect(latency).not.toBeNull()
    // Latência medida pelo relógio controlado (onset da fala -> flush).
    console.info(`barge-in: latência medida = ${latency} ms`)
    expect(latency!).toBeLessThan(300)
    expect(transport.last?.interrupts).toBe(1)
    expect(controller.getState()).toBe('listening')
    expect(playback.pending()).toBe(0)
    expect(sources.length).toBe(1)
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1)
    expect(playback.getStats()).toMatchObject({ flushes: 1, skippedFlushes: 1 })

    controller.stop('teste')
  })
})
