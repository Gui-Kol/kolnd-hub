import { describe, expect, it, vi } from 'vitest'
import {
  GRAB_MAX_SIDE,
  buildDesktopConstraints,
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

function canvas(encoded: Uint8Array, onDraw?: (dw: number, dh: number) => void): CanvasElementLike {
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
    toBlob: (callback) => {
      callback({
        arrayBuffer: async () => {
          const copy = new Uint8Array(encoded.byteLength)
          copy.set(encoded)
          return copy.buffer
        }
      })
    }
  }
}

function factories(options: {
  width: number
  height: number
  encoded: Uint8Array
  tracks: FakeTrack[]
  onDraw?: (dw: number, dh: number) => void
}): GrabFactories {
  const stream: GrabMediaStreamLike = {
    getTracks: () => options.tracks
  }
  return {
    createVideo: () => video(options.width, options.height),
    createCanvas: () => canvas(options.encoded, options.onDraw),
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
})
