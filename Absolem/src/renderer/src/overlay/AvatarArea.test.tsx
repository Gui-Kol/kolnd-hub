// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_OVERLAY_LAYOUT } from '../../../shared/overlay'
import { AvatarArea, avatarHitBox, avatarFrameStyle } from './AvatarArea'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let canvasRef: { current: HTMLCanvasElement | null }

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  canvasRef = { current: null }
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function renderArea(
  layout = { ...DEFAULT_OVERLAY_LAYOUT, width: 480, height: 560 },
  onDown?: () => void
) {
  act(() => {
    root.render(
      <AvatarArea
        layout={layout}
        canvasRef={canvasRef}
        ariaLabel="Avatar do Absolem"
        ariaPressed={false}
        onPointerDown={onDown}
      />
    )
  })
  const avatar = container.querySelector('.overlay-avatar') as HTMLDivElement
  const hit = container.querySelector('.overlay-avatar__hit') as HTMLDivElement
  const canvas = container.querySelector('.overlay-canvas') as HTMLCanvasElement
  return { avatar, hit, canvas }
}

describe('área do avatar x frame do overlay', () => {
  it('área do avatar recebe width/height do layout', () => {
    const { avatar } = renderArea()
    expect(avatar.style.getPropertyValue('--overlay-width')).toBe('480px')
    expect(avatar.style.getPropertyValue('--overlay-height')).toBe('560px')
    expect(avatar.style.width).toBe('var(--overlay-width)')
    expect(avatar.style.height).toBe('var(--overlay-height)')

    const hit = avatarHitBox({ ...DEFAULT_OVERLAY_LAYOUT, width: 480, height: 560 })
    expect(hit.width).toBe(413)
    expect(hit.height).toBe(504)
    expect(avatar.style.getPropertyValue('--overlay-hit-width')).toBe('413px')
    expect(avatar.style.getPropertyValue('--overlay-hit-height')).toBe('504px')

    // Trocou o layout (240x260), as vars acompanham sem estado escondido.
    const small = avatarFrameStyle({ ...DEFAULT_OVERLAY_LAYOUT, width: 240, height: 260 })
    expect(small['--overlay-width']).toBe('240px')
    expect(small['--overlay-height']).toBe('260px')
  })

  it('pointer-events só na área desenhada', () => {
    let clicks = 0
    const { avatar, hit, canvas } = renderArea(undefined, () => {
      clicks += 1
    })

    expect(avatar.style.pointerEvents).toBe('none')
    expect(hit.style.pointerEvents).toBe('auto')
    expect(canvas.style.pointerEvents).toBe('none')

    const frame = { width: 480, height: 560 }
    const box = avatarHitBox({ ...DEFAULT_OVERLAY_LAYOUT, ...frame })
    expect(box.width).toBeLessThan(frame.width)
    expect(box.height).toBeLessThan(frame.height)

    // Clique no canto vazio (frame) não ativa a voz; só a elipse central.
    act(() => {
      avatar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(clicks).toBe(0)
    act(() => {
      hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(clicks).toBe(1)
    expect(hit.getAttribute('role')).toBe('button')
  })
})
