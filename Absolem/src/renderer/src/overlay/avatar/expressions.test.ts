import { describe, expect, it } from 'vitest'
import {
  EXPRESSION_TARGETS,
  MAX_STEP_SECONDS,
  TRANSITION_TAU_SECONDS,
  createExpressionEngine
} from './expressions'

function run(engine: ReturnType<typeof createExpressionEngine>, seconds: number, step = 0.016) {
  const frames = Math.round(seconds / step)
  let frame = engine.update(0)
  for (let index = 0; index < frames; index += 1) {
    frame = engine.update(step)
  }
  return frame
}

describe('motor de expressões', () => {
  it('transição idle -> listening converge em menos de 400 ms', () => {
    const engine = createExpressionEngine({ random: () => 0.5 })
    engine.update(0.016)

    engine.setState('listening')
    const frame = run(engine, 0.4)

    const target = EXPRESSION_TARGETS.listening
    expect(Math.abs(frame.antennaLift - target.antennaLift)).toBeLessThan(0.05)
    expect(Math.abs(frame.headTilt - target.headTilt)).toBeLessThan(0.05)
    expect(engine.getState()).toBe('listening')
  })

  it('error retorna a idle após o tempo definido', () => {
    const engine = createExpressionEngine({ random: () => 0.5 })
    engine.setState('error')

    const duringError = run(engine, 1)
    expect(engine.getState()).toBe('error')
    expect(duringError.alert).toBeGreaterThan(0.9)

    const after = run(engine, 2.2)
    expect(engine.getState()).toBe('idle')
    // Alerta já voltou ao alvo de idle (sem cor de erro residual).
    expect(after.alert).toBeLessThan(0.05)
  })

  it('delta maior não acelera além do teto', () => {
    const engine = createExpressionEngine({ random: () => 0.5 })
    engine.update(0.016)
    engine.setState('listening')

    const frame = engine.update(1)

    // O motor limita o passo a MAX_STEP_SECONDS antes de interpolar.
    const factor = 1 - Math.exp(-MAX_STEP_SECONDS / TRANSITION_TAU_SECONDS)
    const expected =
      EXPRESSION_TARGETS.idle.antennaLift +
      (EXPRESSION_TARGETS.listening.antennaLift - EXPRESSION_TARGETS.idle.antennaLift) * factor

    expect(frame.antennaLift).toBeCloseTo(expected, 5)
    expect(frame.antennaLift).toBeLessThan(EXPRESSION_TARGETS.listening.antennaLift - 0.2)
  })
})
