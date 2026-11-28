import { describe, expect, it, vi } from 'vitest'
import {
  GRAB_MAX_SIDE,
  buildDesktopConstraints,
  decodeDataUrl,
  grabFrame,
  type CanvasElementLike,
  type GrabFactories,
  type GrabMediaStreamLike,
  type VideoElementLike
} from './grab'

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
}

function video(width: number, height: number): VideoElementLike {
  return { srcObject: null, videoWidth: width, videoHeight: height, readyState: 4 }
}

function canvas(
  encoded: Uint8Array,
  onDraw?: (dw: number, dh: number) => void,
  onEncode?: (type?: string, quality?: number) => void
): CanvasElementLike {
  return {
    width: 0,
    height: 0,
    getContext: (type) =>
      type === '2d'
        ? {
            drawImage: (_image, _dx, _dy, dw, dh) => {
              onDraw?.(dw, dh)
            }
          }
        : null,
    toDataURL: (type, quality) => {
      onEncode?.(type, quality)
      return `data:${type ?? 'image/png'};base64,${Buffer.from(encoded).toString('base64')}`
    }
  }
}

function factories(options: {
  width: number
  height: number
  encoded: Uint8Array
  tracks: FakeTrack[]
  onDraw?: (dw: number, dh: number) => void
  onEncode?: (type?: string, quality?: number) => void
}): GrabFactories {
  const stream: GrabMediaStreamLike = {
    getTracks: () => options.tracks
  }
  return {
    createVideo: () => video(options.width, options.height),
    createCanvas: () => canvas(options.encoded, options.onDraw, options.onEncode),
    getUserMedia: vi.fn(async () => stream)
  }
}

describe('captura de um frame', () => {
  it('fecha todas as tracks', async () => {
    const tracks: FakeTrack[] = [{ stop: vi.fn() }, { stop: vi.fn() }]
    const grab = factories({
      width: 1280,
      height: 720,
      encoded: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      tracks
    })

    await grabFrame('screen:0:0', grab)

    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1)
    expect(tracks[1]?.stop).toHaveBeenCalledTimes(1)
  })

  it('limita a 1280 no maior lado', async () => {
    const draws: Array<{ width: number; height: number }> = []
    const grab = factories({
      width: 2560,
      height: 1440,
      encoded: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      tracks: [{ stop: vi.fn() }],
      onDraw: (width, height) => draws.push({ width, height })
    })

    const frame = await grabFrame('screen:0:0', grab)

    expect(draws).toEqual([{ width: GRAB_MAX_SIDE, height: 720 }])
    expect(frame.width).toBe(1280)
    expect(frame.height).toBe(720)
    expect(grab.getUserMedia).toHaveBeenCalledWith(
      buildDesktopConstraints('screen:0:0', GRAB_MAX_SIDE, GRAB_MAX_SIDE)
    )
  })

  it('JPEG tem assinatura FFD8', async () => {
    const grab = factories({
      width: 800,
      height: 600,
      encoded: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      tracks: [{ stop: vi.fn() }]
    })

    const frame = await grabFrame('screen:0:0', grab)
    const bytes = new Uint8Array(frame.data)

    expect(frame.mime).toBe('image/jpeg')
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8])
    expect(frame.bytes).toBe(6)
  })

  it('JPEG usa qualidade 0.75 e PNG sem perdas quando pedido', async () => {
    const calls: Array<{ type?: string; quality?: number }> = []
    const jpeg = factories({
      width: 800,
      height: 600,
      encoded: new Uint8Array([0xff, 0xd8]),
      tracks: [{ stop: vi.fn() }],
      onEncode: (type, quality) => calls.push({ type, quality })
    })
    await grabFrame('screen:0:0', jpeg)
    expect(calls[0]).toEqual({ type: 'image/jpeg', quality: 0.75 })

    calls.length = 0
    const png = factories({
      width: 800,
      height: 600,
      encoded: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      tracks: [{ stop: vi.fn() }],
      onEncode: (type, quality) => calls.push({ type, quality })
    })
    const frame = await grabFrame('screen:0:0', png, { lossless: true })

    expect(calls[0]).toEqual({ type: 'image/png', quality: undefined })
    expect(frame.mime).toBe('image/png')
  })

  it('falha de encode encerra a track', async () => {
    const tracks: FakeTrack[] = [{ stop: vi.fn() }]
    const grab: GrabFactories = {
      createVideo: () => video(800, 600),
      createCanvas: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined }),
        toDataURL: () => {
          throw new Error('falha ao codificar a imagem da tela')
        }
      }),
      getUserMedia: vi.fn(async () => ({ getTracks: () => tracks }))
    }

    await expect(grabFrame('screen:0:0', grab)).rejects.toThrow('codificar')
    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1)
  })

  it('usa toBlob como fallback quando toDataURL não existe', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01])
    const grab: GrabFactories = {
      createVideo: () => video(640, 360),
      createCanvas: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined }),
        toBlob: (callback, type, quality) => {
          expect(type).toBe('image/jpeg')
          expect(quality).toBe(0.75)
          callback({
            arrayBuffer: async () => {
              const copy = new Uint8Array(bytes.byteLength)
              copy.set(bytes)
              return copy.buffer
            }
          })
        }
      }),
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
    }

    const frame = await grabFrame('screen:0:0', grab)
    expect(frame.bytes).toBe(bytes.byteLength)
    expect(Array.from(new Uint8Array(frame.data))).toEqual(Array.from(bytes))
  })

  it('timeout do primeiro frame encerra a track', async () => {
    vi.useFakeTimers()
    try {
      const tracks: FakeTrack[] = [{ stop: vi.fn() }]
      const grab: GrabFactories = {
        createVideo: () => ({
          srcObject: null,
          videoWidth: 0,
          videoHeight: 0,
          readyState: 0,
          addEventListener: vi.fn()
        }),
        createCanvas: () => canvas(new Uint8Array([0xff, 0xd8])),
        getUserMedia: vi.fn(async () => ({ getTracks: () => tracks }))
      }

      const pending = grabFrame('screen:0:0', grab, { frameTimeoutMs: 50 })
      const expectation = expect(pending).rejects.toThrow('tempo esgotado')
      await vi.advanceTimersByTimeAsync(60)
      await expectation
      expect(tracks[0]?.stop).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('50 ciclos encerram todas as tracks e não retêm stream', async () => {
    const streams: FakeTrack[][] = []
    const grab: GrabFactories = {
      createVideo: () => video(1280, 720),
      createCanvas: () => canvas(new Uint8Array([0xff, 0xd8, 0xff])),
      getUserMedia: vi.fn(async () => {
        const tracks: FakeTrack[] = [{ stop: vi.fn() }]
        streams.push(tracks)
        return { getTracks: () => tracks }
      })
    }

    for (let index = 0; index < 50; index += 1) {
      await grabFrame('screen:0:0', grab)
    }

    expect(grab.getUserMedia).toHaveBeenCalledTimes(50)
    expect(streams).toHaveLength(50)
    expect(
      streams.every((tracks) => tracks.every((track) => track.stop.mock.calls.length === 1))
    ).toBe(true)
  })

  it('decodeDataUrl devolve os mesmos bytes e recusa payload inválido', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10])
    const url = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`

    expect(Array.from(new Uint8Array(decodeDataUrl(url)))).toEqual(Array.from(bytes))
    expect(() => decodeDataUrl('não é data url')).toThrow('inválidos')
    expect(() => decodeDataUrl('data:image/jpeg')).toThrow('sem payload')
  })
})
