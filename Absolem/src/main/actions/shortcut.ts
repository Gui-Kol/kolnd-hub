import { app, globalShortcut } from 'electron'
import { ACTIONS_PAUSE_SHORTCUT } from '../../shared/permissions'
import { logger } from '../logger'

/**
 * Atalho global da pausa de ações (task 08, T10): `Control+Alt+P`.
 *
 * Conflito é tratado como nas tasks 02/06: registra o conflito e segue sem
 * atalho; a pausa continua disponível por `actions:pause`. O estado é sempre
 * persistido no store pelo callback.
 */

export { ACTIONS_PAUSE_SHORTCUT }

export interface PauseShortcutApi {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
}

let api: PauseShortcutApi = globalShortcut as unknown as PauseShortcutApi
let registered: string | null = null
let quitHookInstalled = false

export function setPauseShortcutApiForTests(next: PauseShortcutApi | null): void {
  api = next ?? (globalShortcut as unknown as PauseShortcutApi)
}

function installQuitHook(): void {
  if (quitHookInstalled) return
  quitHookInstalled = true
  try {
    app.once('will-quit', unregisterPauseShortcut)
  } catch {
    // Teste isolado sem app pronto.
  }
}

export function getPauseShortcutStatus(): { registered: boolean; accelerator: string } {
  return { registered: registered !== null, accelerator: registered ?? ACTIONS_PAUSE_SHORTCUT }
}

export function registerPauseShortcut(onTrigger: () => void): boolean {
  installQuitHook()
  if (registered) return true
  try {
    if (api.register(ACTIONS_PAUSE_SHORTCUT, onTrigger)) {
      registered = ACTIONS_PAUSE_SHORTCUT
      logger.info('actions', `atalho de pausa registrado: ${ACTIONS_PAUSE_SHORTCUT}`)
      return true
    }
  } catch {
    // conflito extremo
  }
  logger.warn('actions', `conflito ao registrar o atalho de pausa: ${ACTIONS_PAUSE_SHORTCUT}`)
  return false
}

export function unregisterPauseShortcut(): void {
  if (!registered) return
  try {
    api.unregister(registered)
  } catch {
    // best-effort
  }
  registered = null
}

export function resetPauseShortcutForTests(): void {
  registered = null
  quitHookInstalled = false
  api = globalShortcut as unknown as PauseShortcutApi
}
