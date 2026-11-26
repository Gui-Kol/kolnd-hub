import { describe, expect, it, vi } from 'vitest'
import { createRenderLoop } from './renderLoop'

interface Harness {
  loop: ReturnType<typeof createRenderLoop>
  onFrame: ReturnType<typeof vi.fn>
  pending: Map<number, (timeMs: number) => void>
  cancel: ReturnType<typeof vi.fn>
  frame: (timeMs: number) => void
}

function harness(): Harness {
  let nextId = 1
  const pending = new Map<number, (timeMs: number) => void>()
  const raf = (callback: (timeMs: number) => void): number => {
    const id = nextId++
    pending.set(id, callback)
    return id
  }
  const cancel = vi.fn((id: number) => {
    pending.delete(id)
  })
  const onFrame = vi.fn()
  const loop = createRenderLoop({ raf, cancel, onFrame })

  return {
    loop,
    onFrame,
    pending,
    cancel,
    frame(timeMs: number): void {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback(timeMs)
    }
  }
}

describe('createRenderLoop', () => {
  it('não agenda dois frames', () => {
    const h = harness()

    h.loop.start()
    h.loop.start()
    h.loop.start()

    expect(h.pending.size).toBe(1)

    h.frame(1000)
    expect(h.onFrame).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(1)
  })

  it('stop cancela o frame pendente', () => {
    const h = harness()

    h.loop.start()
    expect(h.pending.size).toBe(1)

    h.loop.stop()
    expect(h.loop.isRunning()).toBe(false)
    expect(h.cancel).toHaveBeenCalledTimes(1)
    expect(h.pending.size).toBe(0)

    // Mesmo que um callback atrasado escape do cancelamento, ele não executa.
    h.frame(2000)
    expect(h.onFrame).not.toHaveBeenCalled()
  })

  it('delta usa o tempo real', () => {
    const h = harness()
    h.loop.start()

    h.frame(1000)
    h.frame(1016)
    h.frame(1049)

    expect(h.onFrame).toHaveBeenNthCalledWith(1, 0, 1000)
    expect(h.onFrame).toHaveBeenNthCalledWith(2, 0.016, 1016)
    expect(h.onFrame).toHaveBeenNthCalledWith(3, 0.033, 1049)
  })

  it('retoma ao ficar visível', () => {
    const h = harness()

    h.loop.start()
    h.frame(1000)
    h.loop.stop()
    expect(h.onFrame).toHaveBeenCalledTimes(1)

    h.loop.start()
    expect(h.loop.isRunning()).toBe(true)
    expect(h.pending.size).toBe(1)

    h.frame(5000)
    expect(h.onFrame).toHaveBeenCalledTimes(2)
    // Após retomar, o primeiro delta é 0 (sem referência antiga).
    expect(h.onFrame).toHaveBeenNthCalledWith(2, 0, 5000)
  })
})
