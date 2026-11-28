import { describe, expect, it } from 'vitest'
import {
  FRAME_BYTES,
  FRAME_SAMPLES,
  downmixToMono,
  packInt16,
  resample48to16,
  splitPcm16Frames
} from './pcm'

describe('PCM da captura', () => {
  it('downmix de estéreo para mono usa a média dos canais', () => {
    const mono = downmixToMono([new Float32Array([1, 0.5, -1]), new Float32Array([0.5, -1, 0])])
    expect(Array.from(mono)).toEqual([0.75, -0.25, -0.5])

    const single = downmixToMono([new Float32Array([0.1, -0.2])])
    expect(single[0]).toBeCloseTo(0.1, 6)
    expect(single[1]).toBeCloseTo(-0.2, 6)
    expect(downmixToMono([]).length).toBe(0)
  })

  it('reduz 48k para 16k mantendo 20 ms', () => {
    const input = new Float32Array(960)
    for (let index = 0; index < input.length; index += 1) input[index] = index / 960
    const output = resample48to16(input)
    expect(output.length).toBe(320)
    expect(output.length).toBe(FRAME_SAMPLES)
    // Cada amostra de saída é a média de três amostras de entrada.
    expect(output[0]).toBeCloseTo((0 + 1 / 960 + 2 / 960) / 3, 6)
  })

  it('bloco de 20 ms tem 640 bytes', () => {
    const samples = new Float32Array(FRAME_SAMPLES).fill(0.5)
    const pcm = packInt16(samples)
    expect(pcm.length).toBe(320)
    expect(pcm.byteLength).toBe(640)
    expect(pcm.byteLength).toBe(FRAME_BYTES)
    expect(pcm[0]).toBe(Math.round(0.5 * 0x7fff))

    const frames = splitPcm16Frames(new Int16Array(700))
    expect(frames.map((frame) => frame.length)).toEqual([320, 320, 60])
  })
})
