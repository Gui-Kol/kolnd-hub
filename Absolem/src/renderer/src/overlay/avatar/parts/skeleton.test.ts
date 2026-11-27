import { describe, expect, it } from 'vitest'
import { SKELETON, scaleSkeleton } from './skeleton'

describe('esqueleto de ancoragens', () => {
  it('toda ancora e finita', () => {
    for (const [name, anchor] of Object.entries(SKELETON)) {
      expect(Number.isFinite(anchor.x), `${name}.x`).toBe(true)
      expect(Number.isFinite(anchor.y), `${name}.y`).toBe(true)
      expect(Number.isFinite(anchor.z), `${name}.z`).toBe(true)
    }
  })

  it('head esta acima de neck', () => {
    expect(SKELETON.head.y).toBeGreaterThan(SKELETON.neck.y)
  })

  it('maos ficam a frente do corpo (z > bellyCenter.z)', () => {
    expect(SKELETON.handLeft.z).toBeGreaterThan(SKELETON.bellyCenter.z)
    expect(SKELETON.handRight.z).toBeGreaterThan(SKELETON.bellyCenter.z)
  })

  it('scaleSkeleton nao muta o original', () => {
    const snapshot = Object.fromEntries(
      Object.entries(SKELETON).map(([name, anchor]) => [name, anchor.clone()])
    )

    const scaled = scaleSkeleton(0.22)

    for (const [name, anchor] of Object.entries(SKELETON)) {
      const original = snapshot[name as keyof typeof SKELETON]
      expect(anchor.x).toBe(original.x)
      expect(anchor.y).toBe(original.y)
      expect(anchor.z).toBe(original.z)
      expect(scaled[name as keyof typeof scaled]).not.toBe(anchor)
      expect(scaled[name as keyof typeof scaled].x).toBeCloseTo(anchor.x * 0.22)
      expect(scaled[name as keyof typeof scaled].y).toBeCloseTo(anchor.y * 0.22)
      expect(scaled[name as keyof typeof scaled].z).toBeCloseTo(anchor.z * 0.22)
    }

    scaled.hips.set(99, 99, 99)
    expect(SKELETON.hips.x).toBe(snapshot.hips.x)
    expect(SKELETON.hips.y).toBe(snapshot.hips.y)
    expect(SKELETON.hips.z).toBe(snapshot.hips.z)
  })
})
