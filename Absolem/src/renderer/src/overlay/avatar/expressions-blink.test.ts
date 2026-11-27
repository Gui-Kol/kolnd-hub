import { describe, expect, it } from 'vitest'
import {
  BLINK_DURATION_SECONDS,
  EXPRESSION_TARGETS,
  LID_DROOP_OPEN_FACTOR,
  createExpressionEngine
} from './expressions'

const STEP = 0.016

function run(engine: ReturnType<typeof createExpressionEngine>, seconds: number) {
  const frames = Math.ceil(seconds / STEP)
  let frame = engine.update(0)
  for (let index = 0; index < frames; index += 1) frame = engine.update(STEP)
  return frame
}

describe('palpebra do motor de expressoes', () => {
  it('em idle a palpebra cobre entre 30% e 50% do olho', () => {
    const engine = createExpressionEngine({ random: () => 0.5 })
    const frame = run(engine, 1)

    expect(frame.lidClosure).toBeGreaterThanOrEqual(0.3)
    expect(frame.lidClosure).toBeLessThanOrEqual(0.5)
    // A conta combina a abertura do estado com o peso da palpebra.
    const expectedKeep = 1 - EXPRESSION_TARGETS.idle.lidDroop * LID_DROOP_OPEN_FACTOR
    expect(frame.lidClosure).toBeCloseTo(1 - EXPRESSION_TARGETS.idle.eyeOpenness * expectedKeep, 4)
  })

  it('piscada leva lidClosure a 1 em 160 ms', () => {
    const engine = createExpressionEngine({ random: () => 0 })
    let blinkStarted = false
    let elapsedSinceBlink = 0
    let maxClosure = 0

    for (let index = 0; index < Math.ceil(5 / STEP); index += 1) {
      const frame = engine.update(STEP)
      if (!blinkStarted && frame.blink < 1) blinkStarted = true
      if (!blinkStarted) continue
      elapsedSinceBlink += STEP
      maxClosure = Math.max(maxClosure, frame.lidClosure)
      if (elapsedSinceBlink >= BLINK_DURATION_SECONDS) break
    }

    expect(blinkStarted).toBe(true)
    expect(maxClosure).toBeGreaterThanOrEqual(0.999)
  })

  it('speaking nao pisca', () => {
    const engine = createExpressionEngine({ random: () => 0 })
    engine.setState('speaking')

    for (let index = 0; index < Math.ceil(8 / STEP); index += 1) {
      const frame = engine.update(STEP)
      expect(frame.blink).toBe(1)
    }
    expect(engine.getState()).toBe('speaking')
  })

  it('thinking fecha mais a palpebra que idle', () => {
    const idle = run(createExpressionEngine({ random: () => 0.5 }), 1)
    const thinkingEngine = createExpressionEngine({ random: () => 0.5 })
    thinkingEngine.setState('thinking')
    const thinking = run(thinkingEngine, 1)

    expect(thinking.lidClosure).toBeGreaterThan(idle.lidClosure)
  })
})
