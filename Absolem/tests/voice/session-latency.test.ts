import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceConfig } from '../../src/shared/config'
import { LiveSession } from '../../src/main/gemini/live'
import { FakeLiveTransport } from '../../src/main/gemini/testing/fakeLiveTransport'
import { percentile } from '../../src/main/latency'
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
 * Medição da tarefa 03 sem microfone, rede ou arquivo de áudio:
 * - transporte Live fake;
 * - PCM sintético (senoide) e relógio de VAD controlado;
 * - 10 sessões fake em sequência para provar que nada fica pendente.
 *
 * Só metadados agregados são impressos (`VOICE_LATENCY_JSON`): contagens,
 * milissegundos, bytes e sample rate. Nenhum texto/áudio vai para o log.
 */

const FRAME_MS = 20
const FRAME_SAMPLES = 320
const SESSIONS = 10

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

function fakePlayback() {
  const sources: AudioBufferSourceLike[] = []
  const gain: AudioParamLike = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn()
  }
  const master: GainNodeLike = { gain, connect: vi.fn(), disconnect: vi.fn() }
  const context = {
    currentTime: 0,
    state: 'running',
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

/** PCM16 24 kHz com amplitude constante, 100 ms. */
function modelAudio(): Uint8Array {
  const bytes = new Uint8Array(4800)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < 2400; index += 1) view.setInt16(index * 2, 0x3000, true)
  return bytes
}

interface SessionResult {
  bargeInMs: number
  summary: ReturnType<VoiceController['latencySummary']>
  pending: number
  timers: number
}

async function runSession(): Promise<SessionResult> {
  const transport = new FakeLiveTransport()
  const { playback } = fakePlayback()
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
        usage: { checkBudget: () => undefined, record: () => undefined },
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

  // Primeiro áudio/fim de turno: alimentam as fases `first-audio` e `turn`.
  transport.last?.emit({ type: 'audio', data: modelAudio(), sampleRate: 24_000 })
  expect(controller.getState()).toBe('speaking')
  transport.last?.emit({ type: 'turnComplete' })
  expect(controller.getState()).toBe('listening')

  // Novo turno do modelo; então o usuário fala e o VAD dispara barge-in.
  transport.last?.emit({ type: 'audio', data: modelAudio(), sampleRate: 24_000 })
  expect(controller.getState()).toBe('speaking')
  const vad = createVad()
  let simulatedNow = 0
  let onset: number | null = null
  let bargeInMs = 0
  for (let index = 0; index < 15; index += 1) {
    simulatedNow += FRAME_MS
    vad.process(noiseFrame(), simulatedNow)
  }
  for (let index = 0; index < 20; index += 1) {
    simulatedNow += FRAME_MS
    if (onset === null) onset = simulatedNow - FRAME_MS
    const events = vad.process(speechFrame(index), simulatedNow)
    for (const event of events) {
      if (event.type !== 'speech-start') continue
      // Ordem real: flush local, IPC de barge-in, push de estado (flush 2x).
      playback.flush()
      controller.handleBargeIn()
      playback.flush()
      bargeInMs = simulatedNow - (onset ?? 0)
    }
    if (bargeInMs > 0) break
  }

  expect(bargeInMs).toBeGreaterThan(0)
  expect(controller.getState()).toBe('listening')
  expect(transport.last?.interrupts).toBe(1)
  expect(playback.pending()).toBe(0)
  expect(playback.getStats()).toMatchObject({ flushes: 1, skippedFlushes: 1 })

  controller.stop('teste')
  expect(transport.last?.closes).toBe(1)
  const summary = controller.latencySummary()
  return {
    bargeInMs,
    summary,
    pending: playback.pending(),
    timers: vi.getTimerCount()
  }
}

describe('latência e ciclo de vida da voz (fake)', () => {
  beforeEach(() => {
    // Só timeouts são falsos: performance.now continua real para as métricas.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('10 sessões fake não deixam timers/playback/conexões pendentes', async () => {
    const results: SessionResult[] = []
    for (let index = 0; index < SESSIONS; index += 1) results.push(await runSession())

    for (const result of results) {
      expect(result.pending).toBe(0)
      expect(result.timers).toBe(0)
      expect(result.summary.connect?.samples).toBe(1)
      expect(result.summary['first-audio']?.samples).toBe(1)
      expect(result.summary.turn?.samples).toBe(1)
      expect(result.summary['barge-in']?.samples).toBe(1)
    }

    const bargeIn = results.map((result) => result.bargeInMs)
    const p95 = percentile(bargeIn, 0.95)
    const connect = results.map((result) => result.summary.connect?.p50Ms ?? 0)
    const firstAudio = results.map((result) => result.summary['first-audio']?.p50Ms ?? 0)
    const turn = results.map((result) => result.summary.turn?.p50Ms ?? 0)

    console.info(
      `VOICE_LATENCY_JSON ${JSON.stringify({
        sessions: SESSIONS,
        bargeInP95Ms: p95,
        connectP50Ms: percentile(connect, 0.5),
        firstAudioP50Ms: percentile(firstAudio, 0.5),
        turnP50Ms: percentile(turn, 0.5),
        pendingPlayback: 0,
        pendingTimers: 0
      })}`
    )

    expect(p95).toBeLessThanOrEqual(300)
    expect(percentile(connect, 0.95)).toBeLessThan(1_000)
    expect(percentile(firstAudio, 0.95)).toBeLessThan(1_000)
  })

  it('chunks de microfone chegam uma vez, em ordem, sem perda', async () => {
    const transport = new FakeLiveTransport()
    const controller = new VoiceController({
      getConfig: config,
      updateConfig: () => ({ success: true }),
      hasConsent: () => true,
      persistConsent: () => ({ ok: true }),
      requestConsent: async () => true,
      hasApiKey: () => true,
      checkBudget: () => undefined,
      createSession: (handlers) =>
        new LiveSession({
          transport,
          keys: { getApiKey: () => 'chave-de-teste' },
          usage: { checkBudget: () => undefined, record: () => undefined },
          model: 'gemini-live-teste',
          handlers,
          sleep: async () => undefined
        }),
      setAvatarState: () => undefined,
      pushState: () => undefined,
      pushAudio: () => undefined,
      pushTranscript: () => undefined,
      isOverlayVisible: () => true,
      showOverlay: () => undefined,
      notify: () => undefined,
      memoryEnabled: () => false,
      history: { append: () => undefined }
    })
    controller.start()
    await flushAsync()

    const chunks: Uint8Array[] = []
    for (let index = 0; index < 50; index += 1) {
      const chunk = new Uint8Array(640)
      chunk[0] = index
      chunk[1] = 0xa5
      chunks.push(chunk)
      controller.handleAudioChunk(chunk)
    }

    expect(transport.last?.audio).toHaveLength(50)
    expect(transport.last?.audio.map((chunk) => chunk[0])).toEqual(
      Array.from({ length: 50 }, (_value, index) => index)
    )
    expect(transport.last?.audio.every((chunk) => chunk.byteLength === 640)).toBe(true)

    controller.stop('teste')
    expect(vi.getTimerCount()).toBe(0)
  })
})
