// Tipos e constantes canônicas do gamepad (modo Big Picture).
//
// FRONTEIRA: este arquivo NÃO pode importar nada de `main/`, `preload/` ou
// `renderer/` — ele é a única fonte de verdade compartilhada pelos três
// processos. Qualquer mudança aqui quebra os três juntos (é o objetivo:
// drift vira erro de compilação). Tipos puros + consts; nada de runtime de
// plataforma (sem Electron, sem DOM, sem Node).
//
// Formato persistido em `config.json` (chave `gamepad`) NÃO muda por causa
// daqui — `normalizeGamepadConfig()` (main) continua tolerante e sem schema
// migration.

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
 *
 * Forma única (decisão 05-5.4): `Record<GamepadAction, number | null>` —
 * main e renderer já iteravam com `GAMEPAD_ACTIONS`; a interface de 12
 * campos nomeada (antigo espelho do preload) era estruturalmente idêntica e
 * não agregava segurança. Itere sempre por `GAMEPAD_ACTIONS`.
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

/** Nomes válidos de perfil — usado pelo main para validar `profile`. */
export const GAMEPAD_PROFILES = [
  'xbox',
  'playstation',
  'switch',
  'generic'
] as const satisfies readonly GamepadProfile[]

/**
 * Índice do botão Guide/Home (PS no DualShock/DualSense, Xbox Guide no
 * XInputGetStateEx) na Gamepad API. Usado APENAS para detecção (atalho de
 * entrada no Big Picture) — o mapeamento das 12 ações continua proibindo 16.
 */
export const GAMEPAD_GUIDE_BUTTON_INDEX = 16

/** As 12 ações, na ordem canônica — iteração/validação/serialização. */
export const GAMEPAD_ACTIONS = [
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
] as const satisfies readonly GamepadAction[]

// Exaustividade em tempo de compilação: se a union ganhar um membro sem
// ele entrar na const correspondente, o tipo abaixo resolve para `never` e
// a atribuição falha — o erro estoura no shared (ou seja, no main e no
// renderer juntos). Não exportado; não há custo em runtime.
type _MissingGamepadAction = Exclude<GamepadAction, (typeof GAMEPAD_ACTIONS)[number]>
type _MissingGamepadProfile = Exclude<GamepadProfile, (typeof GAMEPAD_PROFILES)[number]>
const _allGamepadActionsListed: _MissingGamepadAction extends never ? true : never = true
const _allGamepadProfilesListed: _MissingGamepadProfile extends never ? true : never = true
