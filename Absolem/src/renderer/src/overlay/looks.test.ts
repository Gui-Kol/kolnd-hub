import { describe, expect, it } from 'vitest'
import { NO_OVERLAY_FLAGS, parseOverlayFlags } from './overlayFlags'

describe('flag look no hash do overlay', () => {
  it('look=holo e look=storybook sao lidos do hash', () => {
    expect(parseOverlayFlags('#overlay?look=holo').look).toBe('holo')
    expect(parseOverlayFlags('#overlay?look=storybook').look).toBe('storybook')
  })

  it('valor desconhecido cai no default', () => {
    expect(parseOverlayFlags('#overlay?look=neon').look).toBeNull()
    expect(parseOverlayFlags('#overlay?look=').look).toBeNull()
    expect(parseOverlayFlags('#overlay').look).toBeNull()
    expect(NO_OVERLAY_FLAGS.look).toBeNull()
  })

  it('nenhum outro parametro do hash e afetado', () => {
    const flags = parseOverlayFlags('#overlay?look=holo&debug=1&slow=1&fakeVoice=true')

    expect(flags).toEqual({
      fakeVoice: true,
      slow: true,
      debug: true,
      look: 'holo',
      state: null
    })

    const withoutLook = parseOverlayFlags('#overlay?debug=1')
    expect(withoutLook.fakeVoice).toBe(false)
    expect(withoutLook.slow).toBe(false)
    expect(withoutLook.debug).toBe(true)
    expect(withoutLook.look).toBeNull()
  })
})
