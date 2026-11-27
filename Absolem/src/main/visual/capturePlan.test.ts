import { describe, expect, it } from 'vitest'
import { AVATAR_STATES } from '../../shared/avatar'
import {
  DEFAULT_VISUAL_SIZES,
  buildVisualHash,
  parseVisualLook,
  parseVisualSizes,
  parseVisualStates,
  visualFileName
} from './capturePlan'

describe('plano de captura visual', () => {
  it('sem ambiente usa os cinco estados e os dois tamanhos da task', () => {
    expect(parseVisualStates(undefined)).toEqual([...AVATAR_STATES])
    expect(parseVisualSizes(undefined)).toEqual(DEFAULT_VISUAL_SIZES)
  })

  it('aceita lista com espacos, minusculas e remove duplicados', () => {
    expect(parseVisualStates(' idle, ERROR ,idle,thinking ')).toEqual(['idle', 'error', 'thinking'])
    expect(parseVisualSizes('480x560, 320x360,480x560')).toEqual([
      { width: 480, height: 560 },
      { width: 320, height: 360 }
    ])
  })

  it('ignora estado e tamanho invalidos e cai no default quando so sobra lixo', () => {
    expect(parseVisualStates('dormindo')).toEqual([...AVATAR_STATES])
    expect(parseVisualSizes('10x10,480x1000,abc')).toEqual(DEFAULT_VISUAL_SIZES)
    expect(parseVisualSizes('240x260,480x560')).toEqual([
      { width: 240, height: 260 },
      { width: 480, height: 560 }
    ])
  })

  it('look desconhecido cai em storybook', () => {
    expect(parseVisualLook('holo')).toBe('holo')
    expect(parseVisualLook(' STORYBOOK ')).toBe('storybook')
    expect(parseVisualLook('neon')).toBe('storybook')
  })

  it('nome e hash seguem o contrato da task', () => {
    expect(visualFileName('storybook', 'speaking', { width: 320, height: 360 })).toBe(
      'storybook-speaking-320x360.png'
    )
    expect(buildVisualHash('holo', 'error', false)).toBe('overlay?look=holo&state=error&debug=0')
    expect(buildVisualHash('storybook', 'speaking', true)).toBe(
      'overlay?look=storybook&state=speaking&debug=0&fakeVoice=1'
    )
  })
})
