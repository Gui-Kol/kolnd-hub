// Tipos e constantes da camada pura de gamepad (Big Picture).
// Nada de Electron/IPC aqui — só lógica testável.
//
// Fonte única: `src/shared/gamepad.ts` (05-5.4). Re-exportado aqui para
// preservar os imports existentes (`lib/gamepad/types`); não declarar nada
// novo que duplique o shared.
//
// Nota: o shared também exporta `GAMEPAD_PROFILES` (array de nomes válidos,
// usado pelo main na validação). Ele NÃO é re-exportado aqui de propósito:
// o renderer expõe `GAMEPAD_PROFILES` como Record de UI (label/buttons/
// mapping) em `./profiles.ts` — mesmo nome, formas diferentes. Re-exportar
// os dois colidiria no `export *` de `./index.ts` (TS2308).

import type { GamepadAction } from '../../../../shared/gamepad'

export type {
  GamepadProfile,
  GamepadAction,
  GamepadButtonMapping,
  GamepadConfig
} from '../../../../shared/gamepad'
export { GAMEPAD_ACTIONS } from '../../../../shared/gamepad'

export const GAMEPAD_ACTION_LABELS: Record<GamepadAction, string> = {
  confirm: 'Confirmar',
  back: 'Voltar',
  up: 'Cima',
  down: 'Baixo',
  left: 'Esquerda',
  right: 'Direita',
  menu: 'Menu',
  options: 'Opções',
  tab_prev: 'Aba anterior',
  tab_next: 'Aba seguinte',
  stick_left: 'Analógico esquerdo',
  stick_right: 'Analógico direito'
}
