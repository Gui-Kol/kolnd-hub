import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPausableLoop, isPageHidden } from './visibility'

afterEach(() => {
  vi.useRealTimers()
})

describe('createPausableLoop', () => {
  it('não cria timer enquanto desabilitado', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const loop = createPausableLoop({ run, intervalMs: 60, isVisible: () => true })

    vi.advanceTimersByTime(300)
    expect(run).not.toHaveBeenCalled()
    expect(loop.isRunning()).toBe(false)
  })

  it('roda no intervalo e pausa/retoma com a visibilidade sem duplicar timers', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    let visible = true
    const loop = createPausableLoop({ run, intervalMs: 60, isVisible: () => visible })

    loop.setEnabled(true)
    expect(loop.isRunning()).toBe(true)
    vi.advanceTimersByTime(180)
    expect(run).toHaveBeenCalledTimes(3)

    visible = false
    loop.sync()
    expect(loop.isRunning()).toBe(false)
    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledTimes(3)

    visible = true
    loop.sync()
    loop.sync()
    expect(loop.isRunning()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(120)
    expect(run).toHaveBeenCalledTimes(5)
  })

  it('stop limpa o timer e impede reativação implícita', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const loop = createPausableLoop({ run, intervalMs: 60, isVisible: () => true })

    loop.setEnabled(true)
    loop.stop()
    expect(loop.isRunning()).toBe(false)
    expect(loop.isEnabled()).toBe(false)
    vi.advanceTimersByTime(300)
    expect(run).not.toHaveBeenCalled()

    loop.sync()
    expect(loop.isRunning()).toBe(false)
  })

  it('setEnabled(false) pausa e setEnabled(true) reabre', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const loop = createPausableLoop({ run, intervalMs: 50, isVisible: () => true })

    loop.setEnabled(true)
    loop.setEnabled(false)
    expect(loop.isRunning()).toBe(false)
    vi.advanceTimersByTime(200)
    expect(run).not.toHaveBeenCalled()

    loop.setEnabled(true)
    expect(loop.isRunning()).toBe(true)
    vi.advanceTimersByTime(50)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('isPageHidden', () => {
  it('considera apenas o estado hidden', () => {
    expect(isPageHidden(undefined)).toBe(false)
    expect(isPageHidden({ visibilityState: 'visible' } as Document)).toBe(false)
    expect(isPageHidden({ visibilityState: 'hidden' } as Document)).toBe(true)
  })
})
