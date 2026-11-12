// Tipos e constantes da camada pura de gamepad (Big Picture).
// Nada de Electron/IPC aqui — só lógica testável.

export type GamepadProfile = 'xbox' | 'playstation' | 'switch' | 'generic'

export type GamepadAction =
  | 'confirm'
  | 'back'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'menu'
  | 'options'
  | 'tab_prev'
  | 'tab_next'
  | 'stick_left'
  | 'stick_right'

/**
 * Mapeamento ação → índice de botão (0–15). `null` = ação sem botão —
 * resultado do fluxo de conflito ("Substituir" deixa a ação antiga sem botão).
 * O índice 16 (Guide/Home) permanece proibido.
 */
export type GamepadButtonMapping = Record<GamepadAction, number | null>

export interface GamepadConfig {
  profile: GamepadProfile
  controllerId: string
  controllerName: string
  vendorId?: string
  productId?: string
  mapping: GamepadButtonMapping
  autoMapped: boolean
  configuredAt: string
}

export const GAMEPAD_ACTIONS: GamepadAction[] = [
  'confirm',
  'back',
  'up',
  'down',
  'left',
  'right',
  'menu',
  'options',
  'tab_prev',
  'tab_next',
  'stick_left',
  'stick_right'
]

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
