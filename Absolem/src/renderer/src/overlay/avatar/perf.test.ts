import { describe, expect, it, vi } from 'vitest'
import { DEGRADATION_STEPS, createPerfMonitor } from './perf'

describe('degradação de desempenho', () => {
  it('frame lento dispara primeiro passo', () => {
    const onDegrade = vi.fn()
    const perf = createPerfMonitor({ onDegrade })

    // 70 frames de 30 ms = 2,1 s de janela; média 30 ms > 20 ms.
    for (let index = 0; index < 70; index += 1) perf.reportFrame(30)

    expect(perf.getLevel()).toBe(1)
    expect(onDegrade).toHaveBeenCalledTimes(1)
    expect(onDegrade).toHaveBeenCalledWith(1, DEGRADATION_STEPS[0])

    // Frame rápido não sobe de nível nem reverte.
    for (let index = 0; index < 120; index += 1) perf.reportFrame(10)
    expect(perf.getLevel()).toBe(1)
  })

  it('degradação é monotônica e logada uma vez por nível', () => {
    const levels: number[] = []
    const perf = createPerfMonitor({
      onDegrade: (level) => {
        levels.push(level)
      }
    })

    // ~24 s de frames lentos: três janelas de 2 s, uma por passo.
    for (let index = 0; index < 800; index += 1) perf.reportFrame(30)

    expect(levels).toEqual([1, 2, 3])
    expect(perf.getLevel()).toBe(3)

    // Continua lento: nada além do teto, nenhum log repetido.
    for (let index = 0; index < 200; index += 1) perf.reportFrame(30)
    expect(perf.getLevel()).toBe(3)
    expect(levels).toEqual([1, 2, 3])

    // A degradação nunca volta atrás.
    for (let index = 0; index < 500; index += 1) perf.reportFrame(5)
    expect(perf.getLevel()).toBe(3)
  })
})
