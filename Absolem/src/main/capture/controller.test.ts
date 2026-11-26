import { describe, expect, it, vi } from 'vitest'
import type { CaptureSource } from '../../shared/screen'
import { MAX_CAPTURE_BYTES } from '../../shared/screen'
import type { CaptureControllerDeps, CapturedImage } from './controller'
import { createCaptureController } from './controller'

const SCREEN: CaptureSource = {
  id: 'screen:0:0',
  name: 'Tela 1',
  displayId: '0',
  kind: 'screen'
}

const DISPLAY = { id: '0', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }

function image(bytes = 6): CapturedImage {
  const data = new Uint8Array(bytes)
  data.set([0xff, 0xd8, 0xff, 0xe0])
  return { mime: 'image/jpeg', data: data.buffer, width: 1280, height: 720 }
}

function deps(overrides: Partial<CaptureControllerDeps> = {}): CaptureControllerDeps {
  return {
    getPrivacy: () => ({ mode: 'on', blocklist: [], proactive: false }),
    isOverlayVisible: () => false,
    hideOverlay: vi.fn(),
    showOverlay: vi.fn(),
    sleep: vi.fn(async () => undefined),
    listScreens: async () => [SCREEN],
    getDisplays: () => [DISPLAY],
    grab: async () => image(),
    audit: vi.fn(),
    ...overrides
  }
}

describe('controlador de captura', () => {
  it('overlay é escondido antes e reexibido depois', async () => {
    const events: string[] = []
    let visible = true
    const controller = createCaptureController(
      deps({
        isOverlayVisible: () => visible,
        hideOverlay: () => {
          visible = false
          events.push('hide')
        },
        showOverlay: () => {
          visible = true
          events.push('show')
        },
        sleep: async (ms) => {
          expect(ms).toBe(120)
          events.push('sleep')
        },
        grab: async () => {
          events.push(visible ? 'grab-visivel' : 'grab-oculto')
          return image()
        }
      })
    )

    const result = await controller.capture({ kind: 'screen' })

    expect(result.ok).toBe(true)
    expect(events).toEqual(['hide', 'sleep', 'grab-oculto', 'show'])
  })

  it('erro não deixa overlay oculto', async () => {
    const events: string[] = []
    const controller = createCaptureController(
      deps({
        isOverlayVisible: () => true,
        hideOverlay: () => events.push('hide'),
        showOverlay: () => events.push('show'),
        grab: async () => {
          throw new Error('renderer caiu')
        }
      })
    )

    const result = await controller.capture({ kind: 'screen' })

    expect(result).toMatchObject({ ok: false, error: { code: 'grab' } })
    expect(events).toEqual(['hide', 'show'])
  })

  it('buffer acima de 8 MB é recusado', async () => {
    const showOverlay = vi.fn()
    const audit = vi.fn()
    const controller = createCaptureController(
      deps({
        isOverlayVisible: () => true,
        showOverlay,
        grab: async () => image(MAX_CAPTURE_BYTES + 1),
        audit
      })
    )

    const result = await controller.capture({ kind: 'screen' })

    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } })
    expect(showOverlay).toHaveBeenCalledTimes(1)
    expect(audit).not.toHaveBeenCalled()
  })
})
