import { describe, expect, it } from 'vitest'
import { VAD_ATTACK_MS, VAD_PREROLL_MS, VAD_RELEASE_MS, createVad } from './vad'

const FRAME_MS = 20
const FRAME_SAMPLES = 320

function frame(amplitude: number): Float32Array {
  return new Float32Array(FRAME_SAMPLES).fill(amplitude)
}

function feed(
  vad: ReturnType<typeof createVad>,
  amplitude: number,
  frames: number,
  startMs: number
) {
  const events = []
  for (let index = 0; index < frames; index += 1) {
    events.push(...vad.process(frame(amplitude), startMs + (index + 1) * FRAME_MS))
  }
  return events
}

describe('VAD local', () => {
  it('ruído de fundo não dispara', () => {
    const vad = createVad()
    const events = feed(vad, 0.002, 100, 0) // 2 s de ruído
    expect(events).toEqual([])
    expect(vad.isSpeaking()).toBe(false)
  })

  it('fala por 120 ms dispara', () => {
    const vad = createVad()
    expect(feed(vad, 0.2, 5, 0)).toEqual([])
    expect(vad.isSpeaking()).toBe(false)

    const events = feed(vad, 0.2, 1, 5 * FRAME_MS)
    expect(events.map((event) => event.type)).toEqual(['speech-start'])
    expect(vad.isSpeaking()).toBe(true)
    expect(VAD_ATTACK_MS).toBe(120)
  })

  it('saída só após 500 ms de silêncio', () => {
    const vad = createVad()
    feed(vad, 0.2, 6, 0)
    expect(vad.isSpeaking()).toBe(true)

    let events = feed(vad, 0.0005, 24, 6 * FRAME_MS) // 480 ms
    expect(events).toEqual([])
    expect(vad.isSpeaking()).toBe(true)

    events = feed(vad, 0.0005, 1, 30 * FRAME_MS)
    expect(events.map((event) => event.type)).toEqual(['speech-end'])
    expect(vad.isSpeaking()).toBe(false)
    expect(VAD_RELEASE_MS).toBe(500)
  })

  it('pre-roll devolve 300 ms', () => {
    const vad = createVad()
    feed(vad, 0.002, 15, 0)
    const events = feed(vad, 0.2, 6, 15 * FRAME_MS)
    const start = events.find((event) => event.type === 'speech-start')
    if (!start || start.type !== 'speech-start') throw new Error('speech-start ausente')
    expect(start.preroll.length).toBe((VAD_PREROLL_MS / 1000) * 16_000)
    expect(start.preroll.length).toBe(4800)
  })
})
