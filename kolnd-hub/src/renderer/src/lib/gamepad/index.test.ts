import { describe, expect, it } from 'vitest'
import * as gamepad from './index'

// Smoke do barrel: garante que a superfície pública usada pelos componentes
// continua exportada e funcional.
describe('gamepad/index (barrel)', () => {
  it('reexporta mapeamento, perfis e detecção', () => {
    expect(typeof gamepad.mappingsEqual).toBe('function')
    expect(typeof gamepad.detectProfile).toBe('function')
    expect(typeof gamepad.friendlyControllerName).toBe('function')
    expect(typeof gamepad.buildAutoConfig).toBe('function')
    expect(typeof gamepad.parseGamepadId).toBe('function')
    expect(typeof gamepad.axisToDirection).toBe('function')
    expect(gamepad.GAMEPAD_PROFILES).toBeTruthy()
    expect(gamepad.GENERIC_PROFILE).toBeTruthy()
    expect(gamepad.AXIS_DEADZONE).toBe(0.5)
  })

  it('reexporta ações e rótulos', () => {
    expect(Array.isArray(gamepad.GAMEPAD_ACTIONS)).toBe(true)
    expect(gamepad.GAMEPAD_ACTIONS).toContain('confirm')
    expect(gamepad.GAMEPAD_ACTION_LABELS.confirm).toBeTruthy()
  })

  it('os helpers continuam funcionando através do barrel', () => {
    expect(gamepad.axisToDirection(0.1)).toBe(0)
    expect(gamepad.axisToDirection(-0.9)).toBe(-1)
    expect(gamepad.axisToDirection(0.9)).toBe(1)
    expect(
      gamepad.mappingsEqual(gamepad.GENERIC_PROFILE.mapping, gamepad.GENERIC_PROFILE.mapping)
    ).toBe(true)
  })
})
