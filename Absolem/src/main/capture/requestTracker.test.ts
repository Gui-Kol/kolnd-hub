import { describe, expect, it } from 'vitest'
import { createCaptureRequestTracker } from './requestTracker'

describe('pedidos de captura', () => {
  it('duplicado concorrente não inicia outro pedido', () => {
    const tracker = createCaptureRequestTracker()

    expect(tracker.begin('a')).toBe(true)
    expect(tracker.begin('a')).toBe(false)
    expect(tracker.begin('b')).toBe(true)
    expect(tracker.size()).toBe(2)
    expect(tracker.inflightIds()).toEqual(['a', 'b'])
  })

  it('end libera o id para nova tentativa e limpa cancelamento', () => {
    const tracker = createCaptureRequestTracker()

    tracker.begin('a')
    tracker.cancel('a')
    expect(tracker.isCancelled('a')).toBe(true)
    tracker.end('a')
    expect(tracker.isCancelled('a')).toBe(false)
    expect(tracker.isInflight('a')).toBe(false)

    expect(tracker.begin('a')).toBe(true)
    expect(tracker.isCancelled('a')).toBe(false)
    tracker.end('a')
  })

  it('cancelar id inexistente não vaza estado', () => {
    const tracker = createCaptureRequestTracker()

    tracker.cancel('fantasma')
    expect(tracker.isCancelled('fantasma')).toBe(false)
    expect(tracker.size()).toBe(0)
    tracker.begin('a')
    expect(tracker.isCancelled('a')).toBe(false)
  })

  it('50 ciclos não deixam pedidos nem cancelamentos acumulados', () => {
    const tracker = createCaptureRequestTracker()

    for (let index = 0; index < 50; index += 1) {
      const id = `cycle-${index}`
      expect(tracker.begin(id)).toBe(true)
      if (index % 3 === 0) tracker.cancel(id)
      tracker.end(id)
    }

    expect(tracker.size()).toBe(0)
    expect(tracker.inflightIds()).toEqual([])
    expect(tracker.isCancelled('cycle-0')).toBe(false)
  })

  it('begin sem id é recusado', () => {
    const tracker = createCaptureRequestTracker()
    expect(tracker.begin('')).toBe(false)
    expect(tracker.size()).toBe(0)
  })

  it('100 pedidos concorrentes são deduplicados e cancelados sem sobra', () => {
    const tracker = createCaptureRequestTracker()
    const ids = Array.from({ length: 100 }, (_, index) => `concurrent-${index}`)

    for (const id of ids) expect(tracker.begin(id)).toBe(true)
    for (const id of ids) expect(tracker.begin(id)).toBe(false)
    expect(tracker.size()).toBe(100)

    for (const id of ids) tracker.cancel(id)
    expect(tracker.inflightIds()).toEqual(ids)
    for (const id of ids) expect(tracker.isCancelled(id)).toBe(true)

    for (const id of ids) tracker.end(id)
    expect(tracker.size()).toBe(0)
    expect(tracker.inflightIds()).toEqual([])
    for (const id of ids) expect(tracker.isCancelled(id)).toBe(false)
  })
})
