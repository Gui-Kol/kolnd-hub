import { describe, it, expect } from 'vitest'
import {
  parseGamepadId,
  detectProfile,
  friendlyControllerName,
  buildAutoConfig,
  axisToDirection,
  AXIS_DEADZONE
} from './detect'
import { GAMEPAD_ACTIONS } from './types'

const XBOX_ID = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)'
const PS_ID = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'
const SWITCH_ID = 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'
const MOZILLA_HEX_ID = '030000005e0400008e02000000000000'
const UNKNOWN_ID = 'Generic USB Joystick'

const fakePad = (id: string, mapping = 'standard'): Gamepad =>
  ({
    id,
    mapping,
    index: 0,
    connected: true,
    buttons: [],
    axes: [],
    timestamp: 0
  }) as unknown as Gamepad

describe('parseGamepadId', () => {
  it('extrai vendor/product no formato Chromium (Vendor:/Product:)', () => {
    expect(parseGamepadId(XBOX_ID)).toEqual({ vendorId: '045e', productId: '028e' })
    expect(parseGamepadId(PS_ID)).toEqual({ vendorId: '054c', productId: '0ce6' })
    expect(parseGamepadId(SWITCH_ID)).toEqual({ vendorId: '057e', productId: '2009' })
  })

  it('normaliza vendor/product para minúsculas', () => {
    expect(parseGamepadId('Foo Vendor: 045E Product: 028E')).toEqual({
      vendorId: '045e',
      productId: '028e'
    })
  })

  it('identifica vendor no formato Mozilla hexadecimal (bytes little-endian)', () => {
    expect(parseGamepadId(MOZILLA_HEX_ID).vendorId).toBe('045e')
  })

  it('encontra sigla de vendor embutida no id (fallback)', () => {
    expect(parseGamepadId('045e-028e-Xbox Wireless Controller').vendorId).toBe('045e')
    expect(parseGamepadId('054c-0ce6-Wireless Controller').vendorId).toBe('054c')
    expect(parseGamepadId('057e-2009-Pro Controller').vendorId).toBe('057e')
  })

  it('retorna vazio para id desconhecido ou vazio', () => {
    expect(parseGamepadId(UNKNOWN_ID)).toEqual({})
    expect(parseGamepadId('')).toEqual({})
  })
})

describe('detectProfile', () => {
  it('classifica os 3 vendors cobertos', () => {
    expect(detectProfile(XBOX_ID, 'standard')).toBe('xbox')
    expect(detectProfile(PS_ID, 'standard')).toBe('playstation')
    expect(detectProfile(SWITCH_ID, 'standard')).toBe('switch')
  })

  it('classifica o id Mozilla hexadecimal como xbox', () => {
    expect(detectProfile(MOZILLA_HEX_ID, 'standard')).toBe('xbox')
  })

  it('id desconhecido vira generic', () => {
    expect(detectProfile(UNKNOWN_ID, 'standard')).toBe('generic')
  })

  it('força generic quando mapping !== standard', () => {
    expect(detectProfile(XBOX_ID, 'non-standard')).toBe('generic')
    expect(detectProfile(PS_ID, 'unknown')).toBe('generic')
    expect(detectProfile(SWITCH_ID, '')).toBe('generic')
  })
})

describe('friendlyControllerName', () => {
  it('devolve nome humano por perfil', () => {
    expect(friendlyControllerName(XBOX_ID, 'xbox')).toBe('Controle Xbox')
    expect(friendlyControllerName(PS_ID, 'playstation')).toBe('Controle PlayStation')
    expect(friendlyControllerName(SWITCH_ID, 'switch')).toBe('Nintendo Switch Pro Controller')
  })

  it('genérico usa o id truncado em 80 chars', () => {
    const longId = 'X'.repeat(120)
    expect(friendlyControllerName(longId, 'generic')).toHaveLength(80)
    expect(friendlyControllerName('Controle qualquer', 'generic')).toBe('Controle qualquer')
    expect(friendlyControllerName('', 'generic')).toBe('Controle desconhecido')
  })
})

describe('buildAutoConfig', () => {
  it('monta config completa para os 3 vendors cobertos', () => {
    const cases: Array<[string, string]> = [
      [XBOX_ID, 'xbox'],
      [PS_ID, 'playstation'],
      [SWITCH_ID, 'switch']
    ]
    for (const [id, expectedProfile] of cases) {
      const config = buildAutoConfig(fakePad(id))
      expect(config.profile).toBe(expectedProfile)
      expect(config.controllerId).toBe(id)
      expect(config.controllerName).toBeTruthy()
      expect(config.autoMapped).toBe(true)
      expect(config.vendorId).toBeTruthy()
      expect(config.configuredAt).toBeTruthy()
      expect(Number.isNaN(Date.parse(config.configuredAt))).toBe(false)
      for (const action of GAMEPAD_ACTIONS) {
        expect(typeof config.mapping[action]).toBe('number')
      }
    }
  })

  it('aplica o mapeamento do perfil detectado (switch inverte confirm/back)', () => {
    expect(buildAutoConfig(fakePad(XBOX_ID)).mapping.confirm).toBe(0)
    expect(buildAutoConfig(fakePad(SWITCH_ID)).mapping.confirm).toBe(1)
    expect(buildAutoConfig(fakePad(SWITCH_ID)).mapping.back).toBe(0)
  })

  it('mapping non-standard produz perfil genérico', () => {
    const config = buildAutoConfig(fakePad(XBOX_ID, 'non-standard'))
    expect(config.profile).toBe('generic')
    expect(config.mapping.confirm).toBe(0)
  })
})

describe('axisToDirection', () => {
  it('respeita a deadzone', () => {
    expect(axisToDirection(0)).toBe(0)
    expect(axisToDirection(AXIS_DEADZONE - 0.01)).toBe(0)
    expect(axisToDirection(-AXIS_DEADZONE + 0.01)).toBe(0)
    expect(axisToDirection(AXIS_DEADZONE)).toBe(1)
    expect(axisToDirection(-AXIS_DEADZONE)).toBe(-1)
    expect(axisToDirection(1)).toBe(1)
    expect(axisToDirection(-1)).toBe(-1)
  })

  it('valores não finitos viram 0', () => {
    expect(axisToDirection(NaN)).toBe(0)
    expect(axisToDirection(Infinity)).toBe(0)
  })
})
