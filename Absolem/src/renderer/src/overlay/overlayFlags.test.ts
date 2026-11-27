import { describe, expect, it } from 'vitest'
import { NO_OVERLAY_FLAGS, parseOverlayFlags, qaInitialState } from './overlayFlags'

describe('flags de QA visual do overlay', () => {
  it('state válido é lido', () => {
    expect(parseOverlayFlags('#overlay?state=idle').state).toBe('idle')
    expect(parseOverlayFlags('#overlay?state=listening').state).toBe('listening')
    expect(parseOverlayFlags('#overlay?state=speaking').state).toBe('speaking')
    expect(parseOverlayFlags('#overlay?state=thinking').state).toBe('thinking')
    expect(parseOverlayFlags('#overlay?state=error').state).toBe('error')
  })

  it('state inválido é ignorado', () => {
    expect(parseOverlayFlags('#overlay?state=neon').state).toBeNull()
    expect(parseOverlayFlags('#overlay?state=').state).toBeNull()
    expect(parseOverlayFlags('#overlay').state).toBeNull()
    expect(NO_OVERLAY_FLAGS.state).toBeNull()
  })

  it('flags combinadas não se anulam', () => {
    const flags = parseOverlayFlags(
      '#overlay?look=storybook&state=speaking&debug=1&fakeVoice=true&slow=1'
    )
    expect(flags).toEqual({
      fakeVoice: true,
      slow: true,
      debug: true,
      look: 'storybook',
      state: 'speaking'
    })
    expect(qaInitialState(flags)).toBe('speaking')

    // Flags só existem em desenvolvimento; no build empacotado tudo desliga.
    const packaged = parseOverlayFlags('#overlay?debug=1&state=speaking', { enabled: false })
    expect(packaged).toEqual(NO_OVERLAY_FLAGS)
    expect(qaInitialState(packaged)).toBeNull()
  })

  it('nenhuma flag altera o comportamento de voz real', () => {
    const flags = parseOverlayFlags('#overlay?state=speaking&debug=1')

    // O objeto de flags não carrega nada de voz/áudio: só o estado visual.
    expect(Object.keys(flags).sort()).toEqual(['debug', 'fakeVoice', 'look', 'slow', 'state'])
    expect(flags).not.toHaveProperty('voice')
    expect(flags).not.toHaveProperty('audio')
    expect(qaInitialState(flags)).toBe('speaking')
    expect(qaInitialState(NO_OVERLAY_FLAGS)).toBeNull()
  })
})
