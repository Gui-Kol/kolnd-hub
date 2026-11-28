import { describe, expect, it, vi } from 'vitest'
import {
  createPlayback,
  PLAYBACK_FADE_MS,
  PLAYBACK_HEADROOM_MS,
  type AudioBufferLike,
  type AudioBufferSourceLike,
  type AudioParamLike,
  type GainNodeLike,
  type PlaybackAudioContextLike
} from './playback'

interface FakeSource extends AudioBufferSourceLike {
  startedAt: number | null
  stoppedAt: number | null
}

function fakeContext() {
  const sources: FakeSource[] = []
  const gainCalls = {
    set: [] as Array<[number, number]>,
    ramp: [] as Array<[number, number]>
  }
  const gain: AudioParamLike = {
    value: 1,
    setValueAtTime: (value, time) => {
      gainCalls.set.push([value, time])
      gain.value = value
    },
    linearRampToValueAtTime: (value, time) => {
      gainCalls.ramp.push([value, time])
      gain.value = value
    }
  }
  const master: GainNodeLike = {
    gain,
    connect: vi.fn(),
    disconnect: vi.fn()
  }
  const context: PlaybackAudioContextLike & { currentTime: number; resume: () => Promise<void> } = {
    currentTime: 0,
    state: 'running',
    destination: {},
    resume: vi.fn(async () => undefined),
    createBuffer: (channels, length, sampleRate): AudioBufferLike => {
      const data = new Float32Array(length)
      return {
        duration: length / sampleRate,
        getChannelData: () => data
      }
    },
    createBufferSource: (): FakeSource => {
      const source: FakeSource = {
        buffer: null,
        onended: null,
        startedAt: null,
        stoppedAt: null,
        connect: vi.fn(),
        start: (when = 0) => {
          source.startedAt = when
        },
        stop: (when = 0) => {
          source.stoppedAt = when
        }
      }
      sources.push(source)
      return source
    },
    createGain: () => master,
    setSinkId: vi.fn(async () => undefined)
  }
  return { context, sources, gainCalls, master }
}

function pcm(samples: number): Uint8Array {
  const output = new Uint8Array(samples * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < samples; index += 1) {
    view.setInt16(index * 2, 0x4000, true)
  }
  return output
}

describe('reprodução sem estalo', () => {
  it('agenda em ordem sem sobreposição', () => {
    const fake = fakeContext()
    const playback = createPlayback({ context: fake.context, headroomMs: 60 })

    playback.enqueue(pcm(2400), 24_000) // 100 ms
    playback.enqueue(pcm(2400), 24_000)

    expect(fake.sources).toHaveLength(2)
    const first = fake.sources[0]
    const second = fake.sources[1]
    expect(first.startedAt).toBeCloseTo(PLAYBACK_HEADROOM_MS / 1000, 6)
    expect(second.startedAt).toBeCloseTo(0.06 + 0.1, 6)
    expect(second.startedAt!).toBeGreaterThanOrEqual(first.startedAt! + 0.1 - 1e-9)
    expect(playback.pending()).toBe(2)
  })

  it('flush descarta o que não começou', () => {
    const fake = fakeContext()
    const playback = createPlayback({ context: fake.context })

    playback.enqueue(pcm(2400), 24_000)
    playback.enqueue(pcm(2400), 24_000)
    fake.context.currentTime = 0.07 // o primeiro já começou; o segundo não.

    playback.flush()

    expect(fake.sources[0].stoppedAt).toBeCloseTo(0.07 + PLAYBACK_FADE_MS / 1000, 6)
    expect(fake.sources[1].stoppedAt).toBeCloseTo(0.07, 6)
    expect(playback.pending()).toBe(0)
    expect(playback.getLastLevel()).toBe(0)
  })

  it('ganho chega a zero em 20 ms', () => {
    const fake = fakeContext()
    const playback = createPlayback({ context: fake.context })
    playback.enqueue(pcm(2400), 24_000)
    fake.context.currentTime = 0.5

    playback.flush()

    const lastRamp = fake.gainCalls.ramp[fake.gainCalls.ramp.length - 1]
    expect(lastRamp?.[0]).toBe(0)
    expect(lastRamp?.[1]).toBeCloseTo(0.5 + 0.02, 6)
    expect(fake.gainCalls.set[0]?.[1]).toBeCloseTo(0.5, 6)
  })

  it('flush duplicado não refaz a rampa de ganho', () => {
    const fake = fakeContext()
    const playback = createPlayback({ context: fake.context })
    playback.enqueue(pcm(2400), 24_000)
    fake.context.currentTime = 0.01

    playback.flush()
    playback.flush()

    expect(fake.gainCalls.ramp).toHaveLength(1)
    expect(fake.gainCalls.set).toHaveLength(2)
    expect(playback.getStats()).toMatchObject({
      flushes: 1,
      skippedFlushes: 1,
      pending: 0
    })
  })

  it('fila limitada descarta o excedente e conta', () => {
    const fake = fakeContext()
    const playback = createPlayback({ context: fake.context, maxBufferedMs: 250 })

    for (let index = 0; index < 5; index += 1) playback.enqueue(pcm(2400), 24_000)

    expect(playback.getStats()).toMatchObject({ enqueued: 1, dropped: 4, pending: 1 })
    expect(fake.sources).toHaveLength(1)
    expect(playback.getStats().bufferedMs).toBeLessThanOrEqual(250)
  })

  it('retoma contexto suspenso ao enfileirar', () => {
    const fake = fakeContext()
    fake.context.state = 'suspended'
    const playback = createPlayback({ context: fake.context })

    playback.enqueue(pcm(2400), 24_000)

    expect(fake.context.resume).toHaveBeenCalledTimes(1)
    playback.dispose()
    playback.dispose()
    expect(playback.pending()).toBe(0)
  })
})
