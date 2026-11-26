import { describe, expect, it } from 'vitest'
import type { OverlayPosition } from '../../shared/config'
import { computeOverlayBounds } from './geometry'

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
const size = { width: 320, height: 360 }

describe('computeOverlayBounds', () => {
  it('bottom-left aplica margem em x e y', () => {
    expect(computeOverlayBounds(workArea, size, 'bottom-left')).toEqual({
      x: 16,
      y: 704,
      width: 320,
      height: 360
    })
  })

  it('bottom-right encosta na borda direita', () => {
    const bounds = computeOverlayBounds(workArea, size, 'bottom-right')

    expect(bounds.x + bounds.width).toBe(workArea.width - 16)
    expect(bounds.y).toBe(704)
  })

  it('tamanho maior que a workArea é limitado', () => {
    const smallArea = { x: 10, y: 20, width: 800, height: 600 }
    const bounds = computeOverlayBounds(smallArea, { width: 2000, height: 2000 }, 'bottom-left')

    expect(bounds).toEqual({ x: 10, y: 20, width: 800, height: 600 })
  })

  it('offset negativo não sai da tela', () => {
    const bounds = computeOverlayBounds(workArea, size, 'bottom-left', 16, {
      offsetX: -1000,
      offsetY: -1000
    })

    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x)
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y)
    expect(bounds).toEqual({ x: 0, y: 0, width: 320, height: 360 })
  })

  it('posição inválida cai em bottom-left', () => {
    const invalid = computeOverlayBounds(workArea, size, 'middle' as OverlayPosition)
    const fallback = computeOverlayBounds(workArea, size, 'bottom-left')

    expect(invalid).toEqual(fallback)
  })
})
