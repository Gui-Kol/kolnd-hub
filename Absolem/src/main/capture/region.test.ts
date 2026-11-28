import { describe, expect, it } from 'vitest'
import { computeRegionRect, normalizeRegionSelection, regionKeyAction } from '../../shared/screen'
import { createRegionSelector } from './regionWindow'

function setup() {
  const created: Array<{ destroyed: number }> = []
  const windows = created
  const selector = createRegionSelector({
    getDisplays: () => [
      { id: '0', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
      { id: '1', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
    ],
    createWindow: () => {
      const window = { destroyed: 0 }
      windows.push(window)
      return {
        destroy: () => {
          window.destroyed += 1
        }
      }
    }
  })
  return { selector, windows }
}

describe('seleção de região', () => {
  it('área menor que 32x32 é rejeitada', () => {
    const { selector } = setup()

    expect(
      normalizeRegionSelection({ displayId: '0', rect: { x: 10, y: 10, width: 31, height: 40 } })
    ).toBeNull()
    expect(
      normalizeRegionSelection({ displayId: '0', rect: { x: 10, y: 10, width: 32, height: 32 } })
    ).toEqual({
      displayId: '0',
      rect: { x: 10, y: 10, width: 32, height: 32 }
    })
    expect(
      selector.resolveSelection({ displayId: '0', rect: { x: 0, y: 0, width: 8, height: 8 } })
    ).toBe(false)
    expect(computeRegionRect(120, 80, 40, 20)).toEqual({ x: 40, y: 20, width: 80, height: 60 })
  })

  it('Esc resolve cancelado', async () => {
    const { selector, windows } = setup()

    const pending = selector.select()
    expect(selector.isOpen()).toBe(true)
    expect(regionKeyAction('Escape')).toBe('cancel')
    selector.cancel()

    await expect(pending).resolves.toBeNull()
    expect(selector.isOpen()).toBe(false)
    expect(windows).toHaveLength(2)
    expect(windows.every((window) => window.destroyed === 1)).toBe(true)
  })

  it('janela é destruída após confirmar', async () => {
    const { selector, windows } = setup()
    const pending = selector.select()

    expect(regionKeyAction('Enter')).toBe('confirm')
    const accepted = selector.resolveSelection({
      displayId: '1',
      rect: { x: 100, y: 120, width: 640, height: 480 }
    })

    expect(accepted).toBe(true)
    await expect(pending).resolves.toEqual({
      displayId: '1',
      rect: { x: 100, y: 120, width: 640, height: 480 }
    })
    expect(windows.every((window) => window.destroyed === 1)).toBe(true)
    expect(selector.isOpen()).toBe(false)
  })
})
