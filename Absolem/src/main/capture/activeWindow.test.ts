import { createHash } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import type { CaptureSource } from '../../shared/screen'
import type { ForegroundWindow } from '../overlay/foreground'
import { computeCropRect, selectDisplayForBounds, type CaptureDisplay } from './activeWindow'
import type { CaptureControllerDeps, CapturedImage } from './controller'
import { createCaptureController } from './controller'

const DISPLAY_15: CaptureDisplay = {
  id: '0',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1.5
}

const SCREEN: CaptureSource = {
  id: 'screen:0:0',
  name: 'Tela 1',
  displayId: '0',
  kind: 'screen'
}

function image(width: number, height: number): CapturedImage {
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02])
  return { mime: 'image/jpeg', data: data.buffer, width, height }
}

function foreground(bounds: ForegroundWindow['bounds'], title = 'Documento'): ForegroundWindow {
  return { title, processName: 'winword', pid: 321, bounds }
}

function deps(overrides: Partial<CaptureControllerDeps> = {}): CaptureControllerDeps {
  return {
    getPrivacy: () => ({ mode: 'on', blocklist: [], proactive: false }),
    isOverlayVisible: () => false,
    hideOverlay: vi.fn(),
    showOverlay: vi.fn(),
    sleep: vi.fn(async () => undefined),
    listScreens: async () => [SCREEN],
    getDisplays: () => [DISPLAY_15],
    getForeground: async () => foreground({ x: 100, y: 50, width: 400, height: 300 }),
    grab: async () => image(2880, 1620),
    crop: (_image, rect) => image(rect.width, rect.height),
    audit: vi.fn(),
    ...overrides
  }
}

describe('janela ativa', () => {
  it('recorta com scaleFactor 1.5', async () => {
    const crop = vi.fn((_image: CapturedImage, rect) => image(rect.width, rect.height))
    const controller = createCaptureController(deps({ crop }))

    const result = await controller.capture({ kind: 'active-window' })

    expect(result.ok).toBe(true)
    expect(crop).toHaveBeenCalledTimes(1)
    expect(crop.mock.calls[0]?.[1]).toEqual({ x: 150, y: 75, width: 600, height: 450 })
    if (result.ok) expect(result.image).toMatchObject({ width: 600, height: 450 })
  })

  it('bounds fora do monitor é recusado', async () => {
    const grab = vi.fn(async () => image(2880, 1620))
    const controller = createCaptureController(
      deps({
        getForeground: async () => foreground({ x: 3000, y: 100, width: 400, height: 300 }),
        grab
      })
    )

    const result = await controller.capture({ kind: 'active-window' })

    expect(result).toMatchObject({ ok: false, error: { code: 'bounds' } })
    expect(grab).not.toHaveBeenCalled()
    expect(selectDisplayForBounds([DISPLAY_15], { x: 3000, y: 100, width: 400, height: 300 })).toBe(
      null
    )
  })

  it('título entra na auditoria como hash', async () => {
    const audit = vi.fn()
    const title = 'Relatório confidencial'
    const controller = createCaptureController(
      deps({
        getForeground: async () => foreground({ x: 100, y: 50, width: 400, height: 300 }, title),
        audit
      })
    )

    const result = await controller.capture({ kind: 'active-window' })

    expect(result.ok).toBe(true)
    const event = audit.mock.calls[0]?.[0]
    expect(event.titleHash).toBe(createHash('sha256').update(title).digest('hex'))
    expect(JSON.stringify(event)).not.toContain(title)
    expect(event).not.toHaveProperty('data')
    expect(event).not.toHaveProperty('title')
    expect(computeCropRect({ x: 100, y: 50, width: 400, height: 300 }, DISPLAY_15)).toEqual({
      x: 150,
      y: 75,
      width: 600,
      height: 450
    })
  })
})
