// Perfis de layout por família de controle (índices da Gamepad API, mapping 'standard').
// Índices são posicionais e idênticos entre Xbox/PlayStation/Genérico;
// o Switch troca confirm/back (1/0) para respeitar a convenção Nintendo.

import type { GamepadButtonMapping, GamepadProfile } from './types'

const STANDARD_MAPPING: GamepadButtonMapping = {
  confirm: 0,
  back: 1,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  menu: 9,
  options: 8,
  tab_prev: 4,
  tab_next: 5,
  stick_left: 10,
  stick_right: 11
}

// Convenção Nintendo: o botão físico da direita (A, índice 1) confirma.
const SWITCH_MAPPING: GamepadButtonMapping = {
  ...STANDARD_MAPPING,
  confirm: 1,
  back: 0
}

const XBOX_BUTTONS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Back',
  9: 'Start',
  10: 'LS',
  11: 'RS',
  12: 'D-Pad Cima',
  13: 'D-Pad Baixo',
  14: 'D-Pad Esquerda',
  15: 'D-Pad Direita',
  16: 'Guide'
}

const PLAYSTATION_BUTTONS: Record<number, string> = {
  0: 'Cross',
  1: 'Circle',
  2: 'Square',
  3: 'Triangle',
  4: 'L1',
  5: 'R1',
  6: 'L2',
  7: 'R2',
  8: 'Share',
  9: 'Options',
  10: 'L3',
  11: 'R3',
  12: 'D-Pad Cima',
  13: 'D-Pad Baixo',
  14: 'D-Pad Esquerda',
  15: 'D-Pad Direita',
  16: 'PS'
}

const SWITCH_BUTTONS: Record<number, string> = {
  0: 'B',
  1: 'A',
  2: 'Y',
  3: 'X',
  4: 'L',
  5: 'R',
  6: 'ZL',
  7: 'ZR',
  8: '−',
  9: '+',
  10: 'L3',
  11: 'R3',
  12: 'D-Pad Cima',
  13: 'D-Pad Baixo',
  14: 'D-Pad Esquerda',
  15: 'D-Pad Direita',
  16: 'Home'
}

const GENERIC_BUTTONS: Record<number, string> = Object.fromEntries(
  Array.from({ length: 17 }, (_, i) => [i, `Botão ${i}`])
)

export const GAMEPAD_PROFILES: Record<
  GamepadProfile,
  { label: string; buttons: Record<number, string>; mapping: GamepadButtonMapping }
> = {
  xbox: {
    label: 'Xbox',
    buttons: { ...XBOX_BUTTONS },
    mapping: { ...STANDARD_MAPPING }
  },
  playstation: {
    label: 'PlayStation',
    buttons: { ...PLAYSTATION_BUTTONS },
    mapping: { ...STANDARD_MAPPING }
  },
  switch: {
    label: 'Nintendo Switch Pro',
    buttons: { ...SWITCH_BUTTONS },
    mapping: { ...SWITCH_MAPPING }
  },
  generic: {
    label: 'Genérico',
    buttons: { ...GENERIC_BUTTONS },
    mapping: { ...STANDARD_MAPPING }
  }
}

// Perfil posicional usado quando `mapping !== 'standard'` (ou modelo desconhecido).
export const GENERIC_PROFILE = GAMEPAD_PROFILES.generic
