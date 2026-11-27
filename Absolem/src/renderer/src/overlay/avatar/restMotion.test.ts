import { describe, expect, it } from 'vitest'
import { applyExpressionFrame, createExpressionBase } from './expressionMapping'
import type { ExpressionChannels, ExpressionRig, RigNode } from './expressionMapping'
import {
  BREATHE_HZ,
  REST_SWAY_AMPLITUDE,
  bodySway,
  breatheAmount,
  headMicroTilt,
  restSway,
  smokeStrengthForState
} from './restMotion'

function node(x = 0, y = 0, z = 0): RigNode {
  return {
    position: { x, y, z },
    rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

function makeRig(): ExpressionRig {
  return {
    lids: [node(), node()],
    brows: [node(-0.1, 0.12, 0.2), node(0.1, 0.12, 0.2)],
    pupils: [node(-0.1, 0, 0.15), node(0.1, 0, 0.15)],
    mouthCorners: [node(-0.12, 0.03, 0), node(0.12, 0.03, 0)],
    jaw: node(0, 0, -0.1),
    mouth: node(0, -0.1, 0.2),
    upperLip: node(0, -0.05, 0.2),
    body: node(),
    turbanTassel: node()
  }
}

function channels(): ExpressionChannels {
  return {
    lidClosure: 0.4,
    browRaise: 0.3,
    browFurrow: 0,
    lookAside: 0.2,
    mouthOpen: 0.2,
    mouthWidth: 0.5,
    smile: 0.5,
    breathe: 0.5,
    antennaLift: 0.8
  }
}

describe('movimento de repouso', () => {
  it('reduced motion zera breathe, sway e smokeStrength', () => {
    expect(restSway(1.7, 1, true)).toBe(0)
    expect(bodySway(1.7, 1, true)).toBe(0)
    expect(headMicroTilt(1.7, true)).toBe(0)
    expect(breatheAmount(0.8, 1.7, true)).toBe(0)
    expect(smokeStrengthForState('idle', 0.25, true)).toBe(0)
    expect(smokeStrengthForState('thinking', 0.6, true)).toBe(0)
  })

  it('fala interrompe baforada', () => {
    expect(smokeStrengthForState('speaking', 0.6, false)).toBe(0)
    expect(smokeStrengthForState('idle', 0.25, false)).toBeCloseTo(0.25, 6)
    expect(smokeStrengthForState('thinking', 0.6, false)).toBeCloseTo(0.6, 6)
  })

  it('respiracao e lenta e limitada a 0.25 Hz', () => {
    const atZero = breatheAmount(0.5, 0, false)
    const peak = breatheAmount(0.5, 1 / (4 * BREATHE_HZ), false)

    expect(BREATHE_HZ).toBe(0.25)
    expect(atZero).toBeCloseTo(0.25, 6)
    expect(peak).toBeCloseTo(0.5, 6)
    expect(breatheAmount(0.5, 1 / BREATHE_HZ, false)).toBeCloseTo(0.25, 6)
  })

  it('sway lateral fica em 0.03', () => {
    let maximum = 0
    for (let index = 0; index < 240; index += 1) {
      maximum = Math.max(maximum, Math.abs(restSway(index * 0.05, 1, false)))
    }
    expect(REST_SWAY_AMPLITUDE).toBe(0.03)
    expect(maximum).toBeLessThanOrEqual(0.03 + 1e-9)
    expect(maximum).toBeGreaterThan(0.029)
  })

  it('caminho de pose reutiliza os mesmos nos e nao altera a base', () => {
    // O ambiente nao conta alocacoes de forma confiavel; a inspecao deste
    // caminho garante que o rig e a base sao reaproveitados, sem recriar nos.
    const rig = makeRig()
    const base = createExpressionBase(rig)
    const frame = channels()
    const lidReference = rig.lids[0]
    const browReference = rig.brows[0]
    const baseSnapshot = JSON.stringify(base)

    for (let index = 0; index < 600; index += 1) {
      frame.lidClosure = (index % 20) / 20
      frame.breathe = breatheAmount(0.5, index * 0.016, false)
      applyExpressionFrame(rig, base, frame)
      restSway(index * 0.016, 1, false)
      bodySway(index * 0.016, 1, false)
      headMicroTilt(index * 0.016, false)
      smokeStrengthForState('idle', 0.25, false)
    }

    expect(rig.lids[0]).toBe(lidReference)
    expect(rig.brows[0]).toBe(browReference)
    expect(rig.lids).toHaveLength(2)
    expect(JSON.stringify(base)).toBe(baseSnapshot)
  })
})
