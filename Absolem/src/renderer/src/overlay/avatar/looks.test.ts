import { describe, expect, it } from 'vitest'
import { AVATAR_LOOKS, DEFAULT_AVATAR_LOOK, resolveAvatarLook } from './looks'

describe('resolveAvatarLook', () => {
  it('aceita os dois acabamentos declarados', () => {
    expect(AVATAR_LOOKS).toEqual(['holo', 'storybook'])
    expect(resolveAvatarLook('holo')).toBe('holo')
    expect(resolveAvatarLook('storybook')).toBe('storybook')
  })

  it('valor desconhecido cai no default', () => {
    expect(DEFAULT_AVATAR_LOOK).toBe('storybook')
    expect(resolveAvatarLook('neon')).toBe(DEFAULT_AVATAR_LOOK)
    expect(resolveAvatarLook(undefined)).toBe(DEFAULT_AVATAR_LOOK)
    expect(resolveAvatarLook(null)).toBe(DEFAULT_AVATAR_LOOK)
    expect(resolveAvatarLook(42)).toBe(DEFAULT_AVATAR_LOOK)
    expect(resolveAvatarLook({})).toBe(DEFAULT_AVATAR_LOOK)
  })
})
