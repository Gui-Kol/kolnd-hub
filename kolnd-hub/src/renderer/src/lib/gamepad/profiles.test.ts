import { describe, it, expect } from 'vitest'
import { GAMEPAD_PROFILES, GENERIC_PROFILE } from './profiles'
import { GAMEPAD_ACTIONS, type GamepadProfile } from './types'

const PROFILES = Object.keys(GAMEPAD_PROFILES) as GamepadProfile[]

describe('GAMEPAD_PROFILES', () => {
  it('switch usa confirm=1/back=0 (convenção Nintendo); demais confirm=0/back=1', () => {
    expect(GAMEPAD_PROFILES.switch.mapping.confirm).toBe(1)
    expect(GAMEPAD_PROFILES.switch.mapping.back).toBe(0)
    for (const profile of ['xbox', 'playstation', 'generic'] as GamepadProfile[]) {
      expect(GAMEPAD_PROFILES[profile].mapping.confirm).toBe(0)
      expect(GAMEPAD_PROFILES[profile].mapping.back).toBe(1)
    }
  })

  it('todos os perfis têm as 12 ações mapeadas', () => {
    for (const profile of PROFILES) {
      for (const action of GAMEPAD_ACTIONS) {
        expect(typeof GAMEPAD_PROFILES[profile].mapping[action]).toBe('number')
      }
      expect(Object.keys(GAMEPAD_PROFILES[profile].mapping)).toHaveLength(12)
    }
  })

  it('todos os índices de botão ficam entre 0 e 15 (Guide/16 é proibido)', () => {
    for (const profile of PROFILES) {
      for (const action of GAMEPAD_ACTIONS) {
        const index = GAMEPAD_PROFILES[profile].mapping[action]
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThanOrEqual(15)
      }
    }
  })

  it('botões 0–16 têm rótulo amigável em todos os perfis', () => {
    for (const profile of PROFILES) {
      for (let i = 0; i <= 16; i++) {
        expect(GAMEPAD_PROFILES[profile].buttons[i]).toBeTruthy()
      }
    }
  })

  it('GENERIC_PROFILE aponta para o perfil genérico', () => {
    expect(GENERIC_PROFILE).toBe(GAMEPAD_PROFILES.generic)
    expect(GENERIC_PROFILE.mapping.confirm).toBe(0)
  })

  it('mutação do mapping de um perfil não vaza para os outros', () => {
    const copy = { ...GAMEPAD_PROFILES.xbox.mapping }
    expect(GAMEPAD_PROFILES.playstation.mapping).toEqual(copy)
    expect(GAMEPAD_PROFILES.xbox.mapping).not.toBe(GAMEPAD_PROFILES.playstation.mapping)
  })
})
