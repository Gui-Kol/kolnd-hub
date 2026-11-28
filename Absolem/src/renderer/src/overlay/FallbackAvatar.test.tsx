// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_OVERLAY_LAYOUT } from '../../../shared/overlay'
import { AvatarArea } from './AvatarArea'
import { FallbackAvatar, type FallbackAvatarColors } from './avatar/FallbackAvatar'

const reactGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

const COLORS: FallbackAvatarColors = {
  primary: '#1f7f96',
  belly: '#ade4ef',
  detail: '#f06292'
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('fallback estático do avatar', () => {
  it('sem Canvas2D monta o SVG e esconde o canvas', () => {
    const canvasRef = { current: null }
    act(() => {
      root.render(
        <AvatarArea
          layout={{ ...DEFAULT_OVERLAY_LAYOUT, width: 480, height: 560 }}
          canvasRef={canvasRef}
          fallback
          fallbackAvatar={<FallbackAvatar colors={COLORS} />}
          ariaLabel="Avatar do Absolem"
          ariaPressed={false}
        />
      )
    })

    const avatar = container.querySelector('.overlay-avatar') as HTMLDivElement
    const canvas = container.querySelector('.overlay-canvas') as HTMLCanvasElement
    const svg = container.querySelector('svg.fallback-avatar')
    expect(avatar.classList.contains('overlay-avatar--fallback')).toBe(true)
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(canvas.style.display).toBe('none')
  })

  it('SVG usa as cores do tema', () => {
    act(() => {
      root.render(<FallbackAvatar colors={COLORS} />)
    })

    const svg = container.querySelector('svg.fallback-avatar') as SVGSVGElement
    expect(svg.style.getPropertyValue('--avatar-body')).toBe('#1f7f96')
    expect(svg.style.getPropertyValue('--avatar-belly')).toBe('#ade4ef')
    expect(svg.style.getPropertyValue('--avatar-detail')).toBe('#f06292')
    // Bola: círculo com gradiente radial e diâmetro de 46% do menor lado.
    const ball = svg.querySelector('circle[fill^="url(#"]')
    expect(ball).not.toBeNull()
    expect(ball?.getAttribute('r')).toBe('23')
    expect(svg.querySelector(`[stop-color="${COLORS.primary}"]`)).not.toBeNull()
    expect(svg.querySelector(`circle[stroke="${COLORS.detail}"]`)).not.toBeNull()
  })

  it('reduced motion não adiciona animação', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    })) as unknown as typeof window.matchMedia

    try {
      act(() => {
        root.render(<FallbackAvatar colors={COLORS} />)
      })
      const svg = container.querySelector('svg.fallback-avatar') as SVGSVGElement
      expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
      expect(svg.querySelector('animate, animateTransform, animateMotion')).toBeNull()
      expect(svg.style.animation).toBe('')
      expect(svg.style.transition).toBe('')
      expect(svg.querySelector('[style*="animation"]')).toBeNull()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})
