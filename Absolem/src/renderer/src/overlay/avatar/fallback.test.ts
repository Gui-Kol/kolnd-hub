import { describe, expect, it, vi } from 'vitest'
import { createContextLossGuard, detectWebGLBackend } from './fallback'

describe('robustez do avatar', () => {
  it('sem WebGL monta fallback', () => {
    expect(detectWebGLBackend({ getContext: () => null })).toBe('fallback')
    expect(detectWebGLBackend({ getContext: () => ({}) })).toBe('webgl2')
    expect(
      detectWebGLBackend({
        getContext: () => {
          throw new Error('bloqueado')
        }
      })
    ).toBe('fallback')
  })

  it('contexto perdido tenta recriar uma vez', () => {
    const recreate = vi.fn()
    const onFallback = vi.fn()
    const guard = createContextLossGuard({
      recreate,
      onFallback,
      schedule: () => 1,
      clearScheduled: () => {}
    })

    const preventDefault = vi.fn()
    expect(guard.handleLost({ preventDefault })).toBe('recreate')
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(recreate).toHaveBeenCalledTimes(1)
    expect(guard.attempts()).toBe(1)
    expect(onFallback).not.toHaveBeenCalled()

    // Segunda perda sem restauração: fallback, sem nova tentativa.
    expect(guard.handleLost({ preventDefault })).toBe('fallback')
    expect(recreate).toHaveBeenCalledTimes(1)
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(guard.isFallback()).toBe(true)
  })
})
