import { describe, expect, it } from 'vitest'
import type { AvatarState } from '../../../../shared/avatar'
import { EXPRESSION_TARGETS } from './expressions'
import type { ExpressionTargets } from './expressions'

const STATES: AvatarState[] = ['idle', 'listening', 'speaking', 'thinking', 'error']

const NEW_KEYS = [
  'lidDroop',
  'browRaise',
  'browFurrow',
  'smile',
  'breathe',
  'lookAside',
  'smokeStrength'
] as const

const OLD_KEYS = [
  'eyeOpenness',
  'antennaLift',
  'headTilt',
  'mouthOpen',
  'particleSpeed',
  'pulse',
  'sway',
  'alert',
  'aura'
] as const

function differsInAtLeast(
  left: ExpressionTargets,
  right: ExpressionTargets,
  minimum: number
): boolean {
  const keys = [...OLD_KEYS, ...NEW_KEYS]
  const differences = keys.filter((key) => left[key] !== right[key]).length
  return differences >= minimum
}

describe('alvos de expressao do personagem', () => {
  it('os nove canais antigos continuam nos cinco estados', () => {
    for (const state of STATES) {
      for (const key of OLD_KEYS) {
        expect(typeof EXPRESSION_TARGETS[state][key]).toBe('number')
      }
    }
  })

  it('todo canal novo esta em 0..1 ou -1..1', () => {
    for (const state of STATES) {
      for (const key of NEW_KEYS) {
        const value = EXPRESSION_TARGETS[state][key]
        if (key === 'lookAside') {
          expect(value).toBeGreaterThanOrEqual(-1)
          expect(value).toBeLessThanOrEqual(1)
        } else {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('cada estado tem assinatura distinta em pelo menos 3 canais', () => {
    for (let left = 0; left < STATES.length; left += 1) {
      for (let right = left + 1; right < STATES.length; right += 1) {
        const leftTarget = EXPRESSION_TARGETS[STATES[left]]
        const rightTarget = EXPRESSION_TARGETS[STATES[right]]
        expect(differsInAtLeast(leftTarget, rightTarget, 3)).toBe(true)
      }
    }
  })

  it('idle tem lidDroop maior que listening', () => {
    expect(EXPRESSION_TARGETS.idle.lidDroop).toBeGreaterThan(EXPRESSION_TARGETS.listening.lidDroop)
    expect(EXPRESSION_TARGETS.idle.smile).toBeGreaterThan(0)
    expect(EXPRESSION_TARGETS.idle.breathe).toBeGreaterThan(0)
  })

  it('speaking zera a baforada e error franze a sobrancelha', () => {
    expect(EXPRESSION_TARGETS.speaking.smokeStrength).toBe(0)
    expect(EXPRESSION_TARGETS.error.browFurrow).toBeGreaterThan(0.9)
    expect(EXPRESSION_TARGETS.error.smile).toBe(0)
  })
})
