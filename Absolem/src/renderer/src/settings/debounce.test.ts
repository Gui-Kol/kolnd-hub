import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebounced, createThrottled } from './timing'

describe('temporização da aba Aparência', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('última edição vence', () => {
    const calls: string[] = []
    const debounced = createDebounced((value: string) => calls.push(value), 100)

    debounced.schedule('a')
    vi.advanceTimersByTime(60)
    debounced.schedule('b')
    vi.advanceTimersByTime(99)
    expect(calls).toEqual([])

    vi.advanceTimersByTime(1)
    expect(calls).toEqual(['b'])
    expect(debounced.isPending()).toBe(false)
  })

  it('throttle grava no máximo uma vez por janela', () => {
    const calls: number[] = []
    const throttled = createThrottled((value: number) => calls.push(value), 300)

    throttled.schedule(1)
    throttled.schedule(2)
    throttled.schedule(3)
    expect(calls).toEqual([1])

    vi.advanceTimersByTime(299)
    expect(calls).toEqual([1])

    vi.advanceTimersByTime(1)
    expect(calls).toEqual([1, 3])

    throttled.schedule(4)
    vi.advanceTimersByTime(300)
    expect(calls).toEqual([1, 3, 4])
  })

  it('descartar cancela envios pendentes', () => {
    const debouncedCalls: string[] = []
    const throttledCalls: string[] = []
    const debounced = createDebounced((value: string) => debouncedCalls.push(value), 100)
    const throttled = createThrottled((value: string) => throttledCalls.push(value), 300)

    throttled.schedule('primeiro')
    debounced.schedule('pendente')
    throttled.schedule('pendente')

    debounced.cancel()
    throttled.cancel()

    vi.advanceTimersByTime(1000)
    expect(debouncedCalls).toEqual([])
    expect(throttledCalls).toEqual(['primeiro'])
    expect(debounced.isPending()).toBe(false)
    expect(throttled.isPending()).toBe(false)
  })
})
