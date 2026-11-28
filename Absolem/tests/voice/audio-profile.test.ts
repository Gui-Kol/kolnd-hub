import { describe, expect, it } from 'vitest'
import { createVad } from '../../src/renderer/src/audio/vad'
import {
  createPlayback,
  type PlaybackAudioContextLike
} from '../../src/renderer/src/audio/playback'
import {
  TARGET_SAMPLE_RATE,
  packInt16,
  pcm16BytesToFloat,
  pcm16Rms,
  resample48to16
} from '../../src/renderer/src/audio/pcm'

/**
 * Perfil sintético dos caminhos de áudio (task 03). Mede custo por bloco de
 * 20 ms sem microfone/rede e imprime só microssegundos agregados. Os limites
 * são folgados de propósito: o objetivo é detectar regressões grosseiras, não
 * comparar máquinas.
 */

const FRAME_MS = 20
const FRAME_SAMPLES = 320
const FRAMES = 50 // 1 s

function speechFrame(index: number): Float32Array {
  const frame = new Float32Array(FRAME_SAMPLES)
  for (let sample = 0; sample < FRAME_SAMPLES; sample += 1) {
    const t = (index * FRAME_SAMPLES + sample) / 16_000
    frame[sample] = Math.sin(2 * Math.PI * 220 * t) * 0.5
  }
  return frame
}

function fakePlaybackContext(): PlaybackAudioContextLike {
  const gain = {
    value: 1,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined
  }
  return {
    currentTime: 0,
    state: 'running',
    destination: {},
    createBuffer: (_channels, length, sampleRate) => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length)
    }),
    createBufferSource: () => ({
      buffer: null,
      onended: null,
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined
    }),
    createGain: () => ({ gain, connect: () => undefined, disconnect: () => undefined })
  }
}

function averageUs(totalMs: number, count: number): number {
  return Math.round(((totalMs * 1000) / count) * 10) / 10
}

describe('perfil dos caminhos de áudio', () => {
  it('VAD, fila de playback e DSP do worklet têm custo previsível por bloco', () => {
    const vad = createVad()
    const frames = Array.from({ length: FRAMES }, (_value, index) => speechFrame(index))

    const vadStarted = performance.now()
    for (let index = 0; index < frames.length; index += 1) {
      vad.process(frames[index]!, (index + 1) * FRAME_MS)
    }
    const vadUs = averageUs(performance.now() - vadStarted, frames.length)

    const playback = createPlayback({ context: fakePlaybackContext() })
    const pcm = new Uint8Array(FRAME_SAMPLES * 2)
    const playbackStarted = performance.now()
    for (let index = 0; index < FRAMES; index += 1) playback.enqueue(pcm, 24_000)
    const playbackUs = averageUs(performance.now() - playbackStarted, FRAMES)

    const source48k = new Float32Array(960)
    for (let index = 0; index < source48k.length; index += 1)
      source48k[index] = Math.sin(index / 20)
    const dspStarted = performance.now()
    const downsampled = resample48to16(source48k)
    const packed = packInt16(downsampled)
    const bytes = new Uint8Array(packed.buffer)
    pcm16Rms(bytes)
    pcm16BytesToFloat(bytes)
    const dspUs = averageUs(performance.now() - dspStarted, 1)

    console.info(
      `AUDIO_PROFILE_JSON ${JSON.stringify({
        frameMs: FRAME_MS,
        sampleRate: TARGET_SAMPLE_RATE,
        vadUsPerFrame: vadUs,
        playbackEnqueueUsPerChunk: playbackUs,
        dspUsPer20msBlock: dspUs,
        playbackPending: playback.pending()
      })}`
    )

    expect(vadUs).toBeLessThan(5_000)
    expect(playbackUs).toBeLessThan(5_000)
    expect(dspUs).toBeLessThan(20_000)
    expect(playback.pending()).toBe(FRAMES)
    playback.dispose()
  })
})
