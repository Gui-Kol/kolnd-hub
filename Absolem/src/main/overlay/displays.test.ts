import { describe, expect, it, vi } from 'vitest'
import type { OverlayLayout } from '../../shared/config'
import {
  boundsForDisplay,
  computeBoundsForLayout,
  selectDisplay,
  watchDisplayChanges,
  type OverlayDisplay,
  type ScreenLike
} from './displays'

vi.mock('electron', () => ({ screen: {} }))

const layout: OverlayLayout = {
  position: 'bottom-left',
  offsetX: 0,
  offsetY: 0,
  width: 320,
  height: 360
}

function display(
  workArea: { x: number; y: number; width: number; height: number },
  scaleFactor = 1
): OverlayDisplay {
  return { bounds: { ...workArea }, workArea, scaleFactor }
}

function fakeScreen(
  displays: OverlayDisplay[],
  primary: OverlayDisplay
): {
  api: ScreenLike
  handlers: Map<string, Array<() => void>>
  emit: (event: string) => void
} {
  const handlers = new Map<string, Array<() => void>>()
  const api: ScreenLike = {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => primary,
    getDisplayMatching: (rect) =>
      displays.find(
        (item) =>
          rect.x < item.bounds.x + item.bounds.width &&
          rect.x + rect.width > item.bounds.x &&
          rect.y < item.bounds.y + item.bounds.height &&
          rect.y + rect.height > item.bounds.y
      ) ?? primary,
    on: (event, listener) => {
      handlers.set(event, [...(handlers.get(event) ?? []), listener])
    },
    removeListener: (event, listener) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((item) => item !== listener)
      )
    }
  }
  return {
    api,
    handlers,
    emit: (event) => {
      for (const listener of handlers.get(event) ?? []) listener()
    }
  }
}

describe('displays do overlay', () => {
  it('monitor removido volta para o primário', () => {
    const primary = display({ x: 0, y: 0, width: 1920, height: 1080 })
    const screen = fakeScreen([primary], primary)

    const chosen = selectDisplay(screen.api, { x: 2000, y: 100, width: 320, height: 360 })

    expect(chosen).toBe(primary)
  })

  it('métricas alteradas reposiciona', () => {
    const primary = display({ x: 0, y: 0, width: 1920, height: 1080 })
    const screen = fakeScreen([primary], primary)
    const onChange = vi.fn()
    const stop = watchDisplayChanges(onChange, screen.api)

    expect(screen.handlers.get('display-metrics-changed')).toHaveLength(1)

    const before = computeBoundsForLayout(
      layout,
      { x: 0, y: 0, width: 320, height: 360 },
      screen.api
    )
    expect(before.y).toBe(704)

    primary.workArea = { x: 0, y: 0, width: 1280, height: 720 }
    screen.emit('display-metrics-changed')

    expect(onChange).toHaveBeenCalledTimes(1)
    const after = computeBoundsForLayout(
      layout,
      { x: 0, y: 330, width: 320, height: 360 },
      screen.api
    )
    expect(after).toEqual({ x: 16, y: 344, width: 320, height: 360 })

    stop()
    expect(screen.handlers.get('display-metrics-changed')).toHaveLength(0)
  })

  it('bounds ficam em DIPs (nenhuma multiplicação por scaleFactor)', () => {
    const primary = display({ x: 0, y: 0, width: 1280, height: 720 }, 1.5)

    const bounds = boundsForDisplay(primary, layout)

    expect(bounds).toEqual({ x: 16, y: 344, width: 320, height: 360 })
    expect(bounds.x).not.toBe(16 * 1.5)
    expect(bounds.y).not.toBe(344 * 1.5)
  })
})
