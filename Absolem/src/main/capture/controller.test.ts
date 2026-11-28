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

  it('captura usa ocultação temporária sem encerrar o ciclo de voz', async () => {
    const events: string[] = []
    let visible = true
    const controller = createCaptureController(
      deps({
        isOverlayVisible: () => visible,
        hideOverlay: () => {
          visible = false
          events.push('hide-capture-only')
        },
        showOverlay: () => {
          visible = true
          events.push('show')
        },
        grab: async () => {
          events.push(visible ? 'grab-visible' : 'grab-hidden')
          return image()
        }
      })
    )

    const result = await controller.capture({ kind: 'screen', requestId: 'voice-capture' })

    expect(result.ok).toBe(true)
    expect(events).toEqual(['hide-capture-only', 'grab-hidden', 'show'])
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

  it('cancelado antes de esconder não captura nem registra limite', async () => {
    const hideOverlay = vi.fn()
    const grab = vi.fn(async () => image())
    const record = vi.fn()
    const controller = createCaptureController(
      deps({
        isCancelled: () => true,
        hideOverlay,
        grab,
        limits: { check: () => ({ ok: true }), record }
      })
    )

    const result = await controller.capture({ kind: 'screen', requestId: 'cancel-1' })

    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(hideOverlay).not.toHaveBeenCalled()
    expect(grab).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('cancelamento durante a espera do overlay não captura e restaura tudo', async () => {
    const indicators: Array<{ active: boolean }> = []
    let visible = true
    const grab = vi.fn(async () => image())
    const isCancelled = vi.fn().mockReturnValueOnce(false).mockReturnValue(true)
    const controller = createCaptureController(
      deps({
        isCancelled,
        isOverlayVisible: () => visible,
        hideOverlay: () => {
          visible = false
        },
        showOverlay: () => {
          visible = true
        },
        grab,
        pushIndicator: (push) => indicators.push({ active: push.active })
      })
    )

    const result = await controller.capture({ kind: 'screen', requestId: 'cancel-2' })

    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(grab).not.toHaveBeenCalled()
    expect(visible).toBe(true)
    expect(indicators).toEqual([])
  })

  it('cancelamento durante o grab não audita nem envia a imagem', async () => {
    const audit = vi.fn()
    const record = vi.fn()
    const indicators: Array<{ active: boolean }> = []
    let visible = true
    const isCancelled = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true)
    const controller = createCaptureController(
      deps({
        isCancelled,
        isOverlayVisible: () => visible,
        hideOverlay: () => {
          visible = false
        },
        showOverlay: () => {
          visible = true
        },
        pushIndicator: (push) => indicators.push({ active: push.active }),
        audit,
        limits: { check: () => ({ ok: true }), record }
      })
    )

    const result = await controller.capture({ kind: 'screen', requestId: 'cancel-3' })

    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(audit).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
    expect(visible).toBe(true)
    expect(indicators).toEqual([{ active: true }, { active: false }])
  })

  it('grab cancelado devolve código cancelled, não erro desconhecido', async () => {
    let cancelled = false
    const controller = createCaptureController(
      deps({
        isCancelled: () => cancelled,
        grab: async () => {
          cancelled = true
          throw new Error('captura cancelada')
        }
      })
    )

    const result = await controller.capture({ kind: 'screen', requestId: 'cancel-grab' })

    expect(result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('erro marca indicador inativo mesmo com overlay já oculto', async () => {
    const indicators: Array<{ active: boolean }> = []
    const controller = createCaptureController(
      deps({
        isOverlayVisible: () => false,
        pushIndicator: (push) => indicators.push({ active: push.active }),
        grab: async () => {
          throw new Error('renderer caiu')
        }
      })
    )

    await controller.capture({ kind: 'screen' })

    expect(indicators).toEqual([{ active: true }, { active: false }])
  })
})
