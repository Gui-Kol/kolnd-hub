import { describe, expect, it, vi } from 'vitest'
import { DEGRADATION_STEPS, createPerfMonitor, degradationEffectsForLevel } from './perf'

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

  it('nível 2 remove contorno de partes pequenas', () => {
    expect(degradationEffectsForLevel(2).removeSmallOutlines).toBe(true)
    expect(DEGRADATION_STEPS[1].removeSmallOutlines).toBe(true)
    expect(degradationEffectsForLevel(1).removeSmallOutlines).toBe(false)
  })

  it('degradação nível 3 remove contorno e luz direcional', () => {
    const effects = degradationEffectsForLevel(3)
    expect(effects.removeOutlines).toBe(true)
    expect(effects.directionalToAmbientOnly).toBe(true)
    expect(effects.minimalBody).toBe(true)
    expect(effects.noNoise).toBe(true)

    expect(DEGRADATION_STEPS[2].removeOutlines).toBe(true)
    expect(DEGRADATION_STEPS[2].directionalToAmbientOnly).toBe(true)

    // O callback no nível 3 entrega o passo com os flags da task 19.
    const onDegrade = vi.fn()
    const perf = createPerfMonitor({ onDegrade })
    for (let index = 0; index < 800; index += 1) perf.reportFrame(30)
    expect(perf.getLevel()).toBe(3)
    const level3Call = onDegrade.mock.calls.find((call) => call[0] === 3)
    expect(level3Call?.[1].removeOutlines).toBe(true)
    expect(level3Call?.[1].directionalToAmbientOnly).toBe(true)
  })
})
