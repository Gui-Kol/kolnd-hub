// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { MockInstance } from 'vitest'
import { msUntilNextMinute, useMinuteClock } from './useMinuteClock'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let formatCalls: MockInstance
let container: HTMLDivElement
let root: Root
let mounted: boolean

function Harness(): ReactElement {
  const label = useMinuteClock()
  return createElement('output', null, label)
}

function render(): void {
  act(() => root.render(createElement(Harness)))
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function label(): string {
  return container.querySelector('output')?.textContent ?? ''
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 30, 0))
  // Cada wake chama `formatClock` → `toLocaleTimeString`. Contar as chamadas
  // prova quantas vezes o relógio acordou (1 s vs. 1 min).
  formatCalls = vi.spyOn(Date.prototype, 'toLocaleTimeString')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mounted = true
})

afterEach(() => {
  if (mounted) act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('msUntilNextMinute', () => {
  it('meia altura do minuto → metade restante', () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 12, 0, 30, 0))).toBe(30_000)
  })

  it('minuto cheio espera o minuto inteiro (nunca zero)', () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 12, 0, 0, 0))).toBe(60_000)
  })

  it('considera milissegundos', () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 12, 0, 30, 250))).toBe(29_750)
    expect(msUntilNextMinute(new Date(2026, 0, 1, 12, 59, 59, 999))).toBe(1)
  })
})

describe('useMinuteClock', () => {
  it('2 wakes em ~2 min: label muda no minuto cheio e no seguinte', () => {
    render()
    expect(label()).toBe('12:00')
    expect(formatCalls).toHaveBeenCalledTimes(1) // montagem

    // 29,999 s: ainda no mesmo minuto, nenhum wake.
    advance(29_999)
    expect(label()).toBe('12:00')
    expect(formatCalls).toHaveBeenCalledTimes(1)

    // 1 ms depois chega o minuto cheio: 1º wake.
    advance(1)
    expect(label()).toBe('12:01')
    expect(formatCalls).toHaveBeenCalledTimes(2)

    // Intervalo de 60 s (e não de 1 s): 2º wake só no minuto seguinte.
    advance(59_999)
    expect(formatCalls).toHaveBeenCalledTimes(2)
    advance(1)
    expect(label()).toBe('12:02')
    expect(formatCalls).toHaveBeenCalledTimes(3)
  })

  it('desmontar limpa o timeout/intervalo', () => {
    render()
    expect(vi.getTimerCount()).toBe(1)

    act(() => root.unmount())
    mounted = false
    expect(vi.getTimerCount()).toBe(0)
  })
})
