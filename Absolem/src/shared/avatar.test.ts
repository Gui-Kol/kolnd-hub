import { describe, expect, it } from 'vitest'
import { AVATAR_STATES, clampAvatarLevel, isAvatarState, normalizeAvatarState } from './avatar'

describe('contrato de estado do avatar', () => {
  it('estado desconhecido cai em idle', () => {
    expect(normalizeAvatarState('dancing')).toBe('idle')
    expect(normalizeAvatarState(undefined)).toBe('idle')
    expect(normalizeAvatarState(42)).toBe('idle')
    expect(normalizeAvatarState('error')).toBe('error')

    for (const state of AVATAR_STATES) {
      expect(isAvatarState(state)).toBe(true)
      expect(normalizeAvatarState(state)).toBe(state)
    }
  })

  it('nível é limitado a 0..1', () => {
    expect(clampAvatarLevel(-1)).toBe(0)
    expect(clampAvatarLevel(0)).toBe(0)
    expect(clampAvatarLevel(0.42)).toBe(0.42)
    expect(clampAvatarLevel(1)).toBe(1)
    expect(clampAvatarLevel(2)).toBe(1)
    expect(clampAvatarLevel(Number.NaN)).toBe(0)
    expect(clampAvatarLevel('0.5')).toBe(0)
  })
})
