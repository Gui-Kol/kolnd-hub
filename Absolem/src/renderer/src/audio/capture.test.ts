import { describe, expect, it, vi } from 'vitest'
import {
  PCM_WORKLET_NAME,
  buildAudioConstraints,
  createPcmCapture,
  type AudioContextLike,
  type AudioNodeLike,
  type AudioWorkletNodeLike,
  type MediaStreamLike,
  type MediaStreamTrackLike,
  type PcmCaptureOptions
} from './capture'

interface FakeTrack extends MediaStreamTrackLike {
  stop: ReturnType<typeof vi.fn>
}

interface FakeWorklet extends AudioWorkletNodeLike {
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  port: {
    onmessage: ((event: { data: ArrayBufferLike }) => void) | null
    close: ReturnType<typeof vi.fn>
  }
}

function fakeStream(tracks: FakeTrack[]): MediaStreamLike {
  return { getTracks: () => tracks }
}

function fakeTrack(): FakeTrack {
  return { stop: vi.fn(), onended: null }
}

function fakeContext(overrides: Partial<AudioContextLike> = {}) {
  const source: AudioNodeLike = { connect: vi.fn(), disconnect: vi.fn() }
  const worklet: FakeWorklet = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    port: { onmessage: null, close: vi.fn() }
  }
  const context: AudioContextLike = {
    state: 'running',
    destination: {},
    audioWorklet: { addModule: vi.fn(async () => undefined) },
    createMediaStreamSource: vi.fn(() => source),
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    onstatechange: null,
    ...overrides
  }
  return { context, source, worklet }
}

function setup(
  overrides: Partial<PcmCaptureOptions> = {},
  contextOverrides: Partial<AudioContextLike> = {}
) {
  const { context, source, worklet } = fakeContext(contextOverrides)
  const tracks = [fakeTrack()]
  const stream = fakeStream(tracks)
  const chunks: Uint8Array[] = []
  const errors: unknown[] = []
  const ended = vi.fn()
  const capture = createPcmCapture({
    createContext: () => context,
    getUserMedia: async () => stream,
    createWorkletNode: () => worklet,
    workletUrl: '/pcm-worklet.js',
    onChunk: (chunk) => chunks.push(chunk),
    onError: (error) => errors.push(error),
    onTrackEnded: ended,
    ...overrides
  })
  return { capture, context, source, worklet, tracks, stream, chunks, errors, ended }
}

function message(data: number[]): { data: ArrayBufferLike } {
  return { data: new Uint8Array(data).buffer }
}

describe('captura de microfone', () => {
  it('inicia, entrega chunks e para liberando stream/contexto', async () => {
    const fake = setup()
    await fake.capture.start()

    expect(fake.capture.isActive()).toBe(true)
    expect(fake.context.audioWorklet.addModule).toHaveBeenCalledWith('/pcm-worklet.js')
    expect(fake.source.connect).toHaveBeenCalledWith(fake.worklet)
    expect(fake.worklet.connect).toHaveBeenCalledWith(fake.context.destination)
    expect(PCM_WORKLET_NAME).toBe('absolem-pcm16')

    fake.worklet.port.onmessage?.(message([1, 2, 3, 4]))
    expect(fake.chunks).toHaveLength(1)
    expect(Array.from(fake.chunks[0] ?? [])).toEqual([1, 2, 3, 4])
    expect(fake.capture.getStats()).toMatchObject({ chunks: 1, bytes: 4, starts: 1, stops: 0 })

    fake.capture.stop()
    fake.capture.stop()

    expect(fake.capture.isActive()).toBe(false)
    expect(fake.tracks[0].stop).toHaveBeenCalledTimes(1)
    expect(fake.worklet.disconnect).toHaveBeenCalledTimes(1)
    expect(fake.context.close).toHaveBeenCalledTimes(1)
    expect(fake.capture.getStats().stops).toBe(1)
    expect(fake.worklet.port.onmessage).toBeNull()
  })

  it('stop durante o start não reativa a captura depois', async () => {
    const pendingStream: { resolve: ((stream: MediaStreamLike) => void) | null } = { resolve: null }
    const tracks = [fakeTrack()]
    const stream = fakeStream(tracks)
    const fake = setup({
      getUserMedia: () =>
        new Promise<MediaStreamLike>((resolve) => {
          pendingStream.resolve = resolve
        })
    })

    const starting = fake.capture.start()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(pendingStream.resolve).not.toBeNull()

    fake.capture.stop()
    pendingStream.resolve?.(stream)
    await starting

    expect(fake.capture.isActive()).toBe(false)
    expect(tracks[0].stop).toHaveBeenCalledTimes(1)
    expect(fake.worklet.connect).not.toHaveBeenCalled()
    expect(fake.capture.getStats()).toMatchObject({
      cancelledStarts: 1,
      starts: 1,
      stops: 1
    })
  })

  it('retoma o contexto suspenso no start e ao voltar de suspensão', async () => {
    const fake = setup({}, { state: 'suspended' })
    await fake.capture.start()

    expect(fake.context.resume).toHaveBeenCalledTimes(1)

    fake.context.state = 'suspended'
    fake.context.onstatechange?.(new Event('statechange'))
    expect(fake.context.resume).toHaveBeenCalledTimes(2)

    fake.context.state = 'running'
    fake.context.onstatechange?.(new Event('statechange'))
    expect(fake.context.resume).toHaveBeenCalledTimes(2)
    expect(fake.capture.getStats().resumes).toBe(2)
  })

  it('microfone removido para a captura e avisa sem entregar chunks', async () => {
    const fake = setup()
    await fake.capture.start()

    fake.tracks[0].onended?.(new Event('ended'))

    expect(fake.capture.isActive()).toBe(false)
    expect(fake.ended).toHaveBeenCalledTimes(1)
    expect(fake.tracks[0].stop).toHaveBeenCalledTimes(1)
    expect(fake.capture.getStats().trackEnded).toBe(1)

    fake.worklet.port.onmessage?.(message([9, 9]))
    expect(fake.chunks).toHaveLength(0)
  })

  it('falha no start libera recursos e reporta uma vez', async () => {
    const tracks = [fakeTrack()]
    const fake = setup({
      getUserMedia: async () => {
        throw new Error('dispositivo indisponível')
      }
    })

    await fake.capture.start()

    expect(fake.capture.isActive()).toBe(false)
    expect(fake.context.close).toHaveBeenCalledTimes(1)
    expect(fake.errors).toHaveLength(1)
    expect(fake.capture.getStats()).toMatchObject({ errors: 1, starts: 1 })
    expect(tracks[0].stop).not.toHaveBeenCalled()
  })

  it('start concorrente e idempotente', async () => {
    const getUserMedia = vi.fn(async () => fakeStream([fakeTrack()]))
    const fake = setup({ getUserMedia })

    await Promise.all([fake.capture.start(), fake.capture.start()])

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(fake.capture.getStats().starts).toBe(1)
  })

  it('10 ciclos start/stop não deixam contexto, track ou worklet ativos', async () => {
    const contexts: FakeWorklet[] = []
    let closed = 0
    let stopped = 0
    const capture = createPcmCapture({
      createContext: () => {
        const fake = fakeContext()
        fake.context.close = vi.fn(async () => {
          closed += 1
        })
        contexts.push(fake.worklet)
        return fake.context
      },
      getUserMedia: async () => {
        const track: FakeTrack = {
          onended: null,
          stop: vi.fn(() => {
            stopped += 1
          })
        }
        return fakeStream([track])
      },
      createWorkletNode: () => {
        const current = contexts[contexts.length - 1]
        if (!current) throw new Error('contexto ausente')
        return current
      },
      workletUrl: '/pcm-worklet.js',
      onChunk: () => undefined
    })

    for (let cycle = 0; cycle < 10; cycle += 1) {
      await capture.start()
      expect(capture.isActive()).toBe(true)
      capture.stop()
      expect(capture.isActive()).toBe(false)
    }

    expect(contexts).toHaveLength(10)
    expect(closed).toBe(10)
    expect(stopped).toBe(10)
    expect(capture.getStats()).toMatchObject({ starts: 10, stops: 10, errors: 0 })
  })

  it('mantém AEC, supressão de ruído e AGC nas constraints', () => {
    expect(buildAudioConstraints('mic-1').audio).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      deviceId: { exact: 'mic-1' }
    })
  })
})
