import { describe, expect, it, vi } from 'vitest'
import { normalizeBlocklist, DEFAULT_SCREEN_BLOCKLIST } from '../../shared/screen'
import { createDefaultToolRegistry } from '../gemini/tools/internal'
import type { ForegroundWindow } from '../overlay/foreground'
import type { CaptureControllerDeps, CapturedImage } from './controller'
import { createCaptureController } from './controller'
import { registerScreenTool, SCREEN_TOOL_NAME } from './tool'

const SCREEN = { id: 'screen:0:0', name: 'Tela 1', displayId: '0', kind: 'screen' as const }
const DISPLAY = { id: '0', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }

function image(): CapturedImage {
  const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0x01, 0x02, 0x03])
  return { mime: 'image/jpeg', data: data.buffer, width: 1280, height: 720 }
}

function foreground(title: string, processName = 'app'): ForegroundWindow {
  return { title, processName, pid: 10, bounds: { x: 0, y: 0, width: 800, height: 600 } }
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

describe('política de privacidade da tela', () => {
  it('off não registra a tool', () => {
    const { registry, handlers } = createDefaultToolRegistry()
    const handler = vi.fn()

    expect(registerScreenTool(registry, handlers, { mode: 'off', handler })).toBe(false)
    expect(registry.getTool(SCREEN_TOOL_NAME)).toBeNull()
    expect(handlers.has(SCREEN_TOOL_NAME)).toBe(false)

    expect(registerScreenTool(registry, handlers, { mode: 'ask', handler })).toBe(true)
    expect(registry.getTool(SCREEN_TOOL_NAME)).toMatchObject({
      category: 'screen',
      sensitive: true
    })
    expect(handlers.has(SCREEN_TOOL_NAME)).toBe(true)
  })

  it('blocklist recusa por título', async () => {
    const grab = vi.fn(async () => image())
    const controller = createCaptureController(
      deps({
        getPrivacy: () => ({ mode: 'on', blocklist: ['1password'], proactive: false }),
        getForeground: async () => foreground('1Password - Cofre', '1Password.exe'),
        grab
      })
    )

    const result = await controller.capture({ kind: 'active-window' })

    expect(result).toMatchObject({ ok: false, error: { code: 'blocked' } })
    expect(grab).not.toHaveBeenCalled()

    const byProcess = createCaptureController(
      deps({
        getPrivacy: () => ({ mode: 'on', blocklist: ['bitwarden'], proactive: false }),
        getForeground: async () => foreground('Navegador', 'Bitwarden'),
        grab
      })
    )
    const second = await byProcess.capture({ kind: 'active-window' })
    expect(second).toMatchObject({ ok: false, error: { code: 'blocked' } })
    expect(grab).not.toHaveBeenCalled()
  })

  it('ask pede confirmação', async () => {
    const confirm = vi.fn(async () => false)
    const grab = vi.fn(async () => image())
    const controller = createCaptureController(
      deps({
        getPrivacy: () => ({ mode: 'ask', blocklist: [], proactive: false }),
        confirm,
        grab
      })
    )

    const denied = await controller.capture({ kind: 'screen' })

    expect(denied).toMatchObject({ ok: false, error: { code: 'denied' } })
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'screen',
        title: 'Tela 1',
        displayId: '0',
        reason: expect.stringContaining('Gemini')
      })
    )
    expect(grab).not.toHaveBeenCalled()

    confirm.mockResolvedValue(true)
    const accepted = await controller.capture({ kind: 'screen' })
    expect(accepted.ok).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(grab).toHaveBeenCalledTimes(1)
  })

  it('auditoria não contém a imagem', async () => {
    const audit = vi.fn()
    const controller = createCaptureController(deps({ audit }))

    const result = await controller.capture({ kind: 'screen' })

    expect(result.ok).toBe(true)
    const event = audit.mock.calls[0]?.[0]
    expect(Object.keys(event).sort()).toEqual(
      ['at', 'bytes', 'h', 'kind', 'mode', 'sha256', 'titleHash', 'w'].sort()
    )
    expect(event).not.toHaveProperty('data')
    expect(event).not.toHaveProperty('image')
    expect(event).not.toHaveProperty('base64')
    expect(event).toMatchObject({ kind: 'screen', mode: 'on', w: 1280, h: 720, bytes: 8 })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('data:image')
    expect(serialized).not.toContain(Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'))
  })

  it('lista é normalizada (trim, sem duplicata)', () => {
    expect(normalizeBlocklist([' 1Password ', '1PASSWORD', '', 42, 'Nubank', 'nubank'])).toEqual([
      '1password',
      'nubank'
    ])
    expect(normalizeBlocklist(undefined)).toEqual([])
    expect([...DEFAULT_SCREEN_BLOCKLIST]).toEqual(
      expect.arrayContaining(['1password', 'bitwarden', 'keepass', 'nubank', 'itaú'])
    )
  })
})
