import { describe, expect, it } from 'vitest'
import { LATENCY_DEFAULT_CAPACITY, LatencyTracker, percentile } from './latency'

describe('agregador de latências', () => {
  it('calcula p50/p95/máximo sem guardar conteúdo', () => {
    const tracker = new LatencyTracker()
    for (const value of [10, 20, 30, 40, 50]) tracker.record('connect', value)

    expect(tracker.summary()).toEqual({
      connect: { samples: 5, p50Ms: 30, p95Ms: 50, maxMs: 50 }
    })
    expect(tracker.count('connect')).toBe(5)
    expect(JSON.stringify(tracker.summary())).not.toContain('texto')
  })

  it('ignora valores inválidos e limita a janela', () => {
    const tracker = new LatencyTracker(3)
    tracker.record('phase', Number.NaN)
    tracker.record('phase', -1)
    tracker.record('', 10)
    for (const value of [1, 2, 3, 4]) tracker.record('phase', value)

    expect(tracker.count('phase')).toBe(3)
    expect(tracker.summary().phase).toEqual({ samples: 3, p50Ms: 3, p95Ms: 4, maxMs: 4 })
    tracker.reset()
    expect(tracker.summary()).toEqual({})
  })

  it('percentil usa a mesma convenção do baseline', () => {
    expect(percentile([], 0.95)).toBe(0)
    expect(percentile([5], 0.5)).toBe(5)
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2)
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4)
    expect(LATENCY_DEFAULT_CAPACITY).toBeGreaterThan(0)
  })
})
