// Comparação de mapeamentos do controle — extraída de `components/GamepadSetup.tsx`
// para ser testável em vitest (mesma assinatura e semântica de antes).

import { GAMEPAD_ACTIONS } from './types'
import type { GamepadButtonMapping } from './types'

/** Dois mapeamentos são iguais quando toda ação aponta para o mesmo botão. */
export function mappingsEqual(a: GamepadButtonMapping, b: GamepadButtonMapping): boolean {
  return GAMEPAD_ACTIONS.every((action) => a[action] === b[action])
}
