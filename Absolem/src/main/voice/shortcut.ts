import { app, globalShortcut } from 'electron'
import { normalizeAccelerator } from '../../shared/overlay'
import { VOICE_DEFAULT_SHORTCUT } from '../../shared/voice'
import { logger } from '../logger'

/**
 * Atalho global da voz (default `Control+Alt+Space`).
 *
 * Conflito é tratado como na task 02: não sobrescreve o valor, apenas registra
 * o conflito e segue sem atalho (o clique no avatar continua funcionando).
 * O atalho nunca inicia captura com o overlay oculto: o controlador mostra o
 * overlay e pede o clique.
 */

export interface VoiceShortcutApi {
  register: (accelerator: string, callback: () => void) => boolean
  unregister: (accelerator: string) => void
}

let api: VoiceShortcutApi = globalShortcut as unknown as VoiceShortcutApi
let registered: string | null = null
let quitHookInstalled = false

export function setVoiceShortcutApiForTests(next: VoiceShortcutApi | null): void {
  api = next ?? (globalShortcut as unknown as VoiceShortcutApi)
}

function installQuitHook(): void {
  if (quitHookInstalled) return
  quitHookInstalled = true
  try {
    app.once('will-quit', unregisterVoiceShortcut)
  } catch {
    // Teste isolado sem app pronto.
  }
}

export function getVoiceShortcutStatus(): { registered: boolean; accelerator: string } {
  return { registered: registered !== null, accelerator: registered ?? VOICE_DEFAULT_SHORTCUT }
}

export function registerVoiceShortcut(input: unknown, onTrigger: () => void): boolean {
  installQuitHook()
  const accelerator = normalizeAccelerator(input) ?? VOICE_DEFAULT_SHORTCUT
  if (registered === accelerator) return true
  if (registered) {
    try {
      api.unregister(registered)
    } catch {
      // SO já liberou.
    }
    registered = null
  }
  try {
    if (api.register(accelerator, onTrigger)) {
      registered = accelerator
      logger.info('voice', `atalho de voz registrado: ${accelerator}`)
      return true
    }
  } catch {
    // Registro pode lançar em conflito extremo.
  }
  logger.warn('voice', `conflito ao registrar o atalho de voz: ${accelerator}`)
  return false
}

export function unregisterVoiceShortcut(): void {
  if (!registered) return
  try {
    api.unregister(registered)
  } catch {
    // best-effort
  }
  registered = null
}

export function resetVoiceShortcutForTests(): void {
  registered = null
  quitHookInstalled = false
  api = globalShortcut as unknown as VoiceShortcutApi
}
