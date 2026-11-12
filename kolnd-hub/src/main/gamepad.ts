import { ipcMain } from 'electron'
import {
  getGamepadConfig,
  setGamepadConfig,
  resetGamepadConfig,
  getBigPicturePrefs,
  setBigPicturePrefs,
  BigPicturePrefs,
  GamepadConfig
} from './store'

/**
 * Canais IPC do modo Big Picture (controle + preferências de sons).
 *
 * Persistência canônica no electron-store (ver store.ts) — nunca
 * localStorage nem JSON solto. A validação pesada mora em
 * `normalizeGamepadConfig()` (store.ts): qualquer inconsistência vira
 * `null`/`success: false` e nada é gravado.
 */

export interface GamepadGetResult {
  ok: boolean
  config: GamepadConfig | null
  error?: string
}

export interface BigPictureGetPrefsResult {
  ok: boolean
  prefs: BigPicturePrefs
  error?: string
}

export interface GamepadMutationResult {
  ok: boolean
  error?: string
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Registra os canais IPC do modo Big Picture. */
export function registerGamepadIpc(): void {
  ipcMain.handle('gamepad:get', (): GamepadGetResult => {
    try {
      return { ok: true, config: getGamepadConfig() }
    } catch (err) {
      console.error('[gamepad] Falha ao ler a configuração de controle:', err)
      return { ok: false, config: null, error: toMessage(err) }
    }
  })

  ipcMain.handle('gamepad:set', (_event, config: unknown): GamepadMutationResult => {
    const result = setGamepadConfig(config)
    return result.success ? { ok: true } : { ok: false, error: result.error }
  })

  ipcMain.handle('gamepad:reset', (): GamepadMutationResult => {
    const result = resetGamepadConfig()
    return result.success ? { ok: true } : { ok: false, error: result.error }
  })

  ipcMain.handle('bigpicture:get-prefs', (): BigPictureGetPrefsResult => {
    try {
      return { ok: true, prefs: getBigPicturePrefs() }
    } catch (err) {
      console.error('[gamepad] Falha ao ler as preferências do Big Picture:', err)
      return { ok: false, prefs: { sounds: true }, error: toMessage(err) }
    }
  })

  ipcMain.handle('bigpicture:set-prefs', (_event, prefs: unknown): GamepadMutationResult => {
    const result = setBigPicturePrefs(prefs)
    return result.success ? { ok: true } : { ok: false, error: result.error }
  })
}
