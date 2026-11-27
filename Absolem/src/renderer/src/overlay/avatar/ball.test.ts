import { describe, expect, it } from 'vitest'
import { AVATAR_STATES } from '../../../../shared/avatar'
import {
  BALL_COLORS,
  ballColorForState,
  ballDiameter,
  ballVisualFrame,
  createAvatarBall
} from './ball'

const EXPECTED_COLORS: Record<string, string> = {
  idle: '#3b82f6',
  listening: '#22c55e',
  speaking: '#eab308',
  thinking: '#f59e0b',
  error: '#ef4444'
}

const ZERO_METRICS = {
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  degradation: 0
}

interface FakeContext {
  setTransform: () => void
  clearRect: () => void
  createRadialGradient: () => { addColorStop: () => void }
  beginPath: () => void
  arc: () => void
  fill: () => void
  stroke: () => void
  fillStyle: string
  strokeStyle: string
  lineWidth: number
}

function createCanvas(width = 480, height = 360): HTMLCanvasElement {
  const gradient = { addColorStop: () => undefined }
  const context: FakeContext = {
    setTransform: () => undefined,
    clearRect: () => undefined,
    createRadialGradient: () => gradient,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0
  }
  return {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    parentElement: null,
    getContext: (type: string) => (type === '2d' ? context : null)
  } as unknown as HTMLCanvasElement
}

function installBrowser(raf: (callback: FrameRequestCallback) => number): () => void {
  const fakeWindow = {
    requestAnimationFrame: raf,
    cancelAnimationFrame: () => undefined,
    devicePixelRatio: 1,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
  const scope = globalThis as unknown as Record<string, unknown>
  const hadWindow = 'window' in scope
  const hadDocument = 'document' in scope
  const previousWindow = scope.window
  const previousDocument = scope.document
  scope.window = fakeWindow
  scope.document = fakeDocument
  return () => {
    if (hadWindow) scope.window = previousWindow
    else delete scope.window
    if (hadDocument) scope.document = previousDocument
    else delete scope.document
  }
}

describe('cores fixas por estado', () => {
  it('cada estado tem a cor aprovada', () => {
    expect(Object.keys(BALL_COLORS).sort()).toEqual(
      ['error', 'idle', 'listening', 'speaking', 'thinking'].sort()
    )
    for (const state of AVATAR_STATES) {
      expect(ballColorForState(state)).toBe(EXPECTED_COLORS[state])
    }
  })
})

describe('ballVisualFrame', () => {
  const amplitudes: Record<string, number> = {
    idle: 0.025,
    listening: 0.06,
    speaking: 0.14,
    thinking: 0.08,
    error: 0
  }

  it('pulso fica sempre em 0..1 e respeita a amplitude do estado', () => {
    for (const state of AVATAR_STATES) {
      let minScale = Number.POSITIVE_INFINITY
      let maxScale = 0
      for (let step = 0; step <= 800; step += 1) {
        for (const level of [0, 0.5, 1]) {
          const frame = ballVisualFrame(state, {
            timeSeconds: step * 0.01,
            level,
            reducedMotion: false
          })
          expect(frame.pulse).toBeGreaterThanOrEqual(0)
          expect(frame.pulse).toBeLessThanOrEqual(1)
          expect(Number.isFinite(frame.diameterScale)).toBe(true)
          expect(frame.glow).toBeGreaterThanOrEqual(0)
          expect(frame.glow).toBeLessThanOrEqual(1)
          minScale = Math.min(minScale, frame.diameterScale)
          maxScale = Math.max(maxScale, frame.diameterScale)
        }
      }
      expect(maxScale - 1).toBeLessThanOrEqual(amplitudes[state] + 1e-9)
      expect(1 - minScale).toBeLessThanOrEqual(amplitudes[state] + 1e-9)
    }
  })

  it('nível 0 não explode o pulso de listening/speaking', () => {
    for (const state of ['listening', 'speaking'] as const) {
      for (let step = 0; step <= 200; step += 1) {
        const frame = ballVisualFrame(state, {
          timeSeconds: step * 0.05,
          level: 0,
          reducedMotion: false
        })
        expect(Math.abs(frame.diameterScale - 1)).toBeLessThanOrEqual(amplitudes[state] + 1e-9)
      }
    }
  })

  it('erro fica parado', () => {
    const first = ballVisualFrame('error', {
      timeSeconds: 0,
      level: 1,
      reducedMotion: false
    })
    const later = ballVisualFrame('error', {
      timeSeconds: 7.3,
      level: 1,
      reducedMotion: false
    })
    expect(first).toEqual(later)
    expect(first.diameterScale).toBe(1)
  })

  it('reduced motion é estático em qualquer estado e tempo', () => {
    for (const state of AVATAR_STATES) {
      const atZero = ballVisualFrame(state, {
        timeSeconds: 0,
        level: 1,
        reducedMotion: true
      })
      const later = ballVisualFrame(state, {
        timeSeconds: 5.7,
        level: 1,
        reducedMotion: true
      })
      expect(atZero).toEqual(later)
      expect(atZero.diameterScale).toBe(1)
      expect(atZero.pulse).toBe(0)
    }
  })
})

describe('ballDiameter', () => {
  it('usa 46% do menor lado e aplica a escala do tema', () => {
    expect(ballDiameter(480, 1)).toBeCloseTo(220.8)
    expect(ballDiameter(480, 1.5)).toBeCloseTo(331.2)
    expect(ballDiameter(100, 1)).toBeCloseTo(46)
  })

  it('limita a escala em 0.8..1.5 e cabe na elipse de clique', () => {
    expect(ballDiameter(480, 0.1)).toBe(ballDiameter(480, 0.8))
    expect(ballDiameter(480, 9)).toBe(ballDiameter(480, 1.5))
    expect(ballDiameter(480, 1.5)).toBeLessThan(480 * 0.86)
    expect(ballDiameter(480, 1.5)).toBeLessThan(480 * 0.9)
  })
})

describe('ciclo de vida da bola', () => {
  it('sem loop as métricas ficam zeradas e o dispose é idempotente', () => {
    const handle = createAvatarBall(createCanvas(), { visible: false })

    expect(handle.isRunning()).toBe(false)
    expect(handle.getMetrics()).toEqual(ZERO_METRICS)
    expect(handle.getState()).toBe('idle')

    handle.setState('listening')
    expect(handle.getState()).toBe('listening')
    handle.setTheme({ accent: '#ffffff' })
    handle.setOutlineStrength(0)
    handle.setLook('holo')
    handle.setLevel(0.5)
    handle.resize()

    handle.dispose()
    handle.dispose()
    expect(handle.getMetrics()).toEqual(ZERO_METRICS)
    expect(handle.isRunning()).toBe(false)
  })

  it('cada frame pintado reporta 1 draw e o pause zera as métricas', () => {
    const queued: FrameRequestCallback[] = []
    const restore = installBrowser((callback) => {
      queued.push(callback)
      return queued.length
    })

    try {
      const handle = createAvatarBall(createCanvas(), { visible: true })
      expect(handle.isRunning()).toBe(true)

      queued.shift()?.(100)
      queued.shift()?.(116)

      const metrics = handle.getMetrics()
      expect(metrics.drawCalls).toBe(1)
      expect(metrics.frameMs).toBeCloseTo(16)
      expect(metrics.fps).toBeCloseTo(62.5)
      expect(metrics.triangles).toBe(0)
      expect(metrics.degradation).toBe(0)

      handle.setVisible(false)
      expect(handle.isRunning()).toBe(false)
      expect(handle.getMetrics()).toEqual(ZERO_METRICS)

      handle.dispose()
      handle.dispose()
    } finally {
      restore()
    }
  })
})
