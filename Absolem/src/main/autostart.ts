import { app } from 'electron'
import type { AutostartState } from '../shared/ipc'
import { logger } from './logger'

/**
 * Autostart por usuário no Windows.
 *
 * O SO é a fonte da verdade: o estado exibido vem de
 * `getLoginItemSettings().openAtLogin` e nada é persistido no config.json.
 * `args: ['--hidden']` faz o app subir direto para a bandeja; `path` aponta
 * para o executável instalado. Fora do app empacotado o recurso é recusado:
 * registrar o binário do Electron como item de inicialização não faz sentido.
 */
export function getAutostart(): AutostartState {
  let enabled = false
  try {
    enabled = app.getLoginItemSettings().openAtLogin === true
  } catch (err) {
    logger.error('autostart', 'falha ao ler a inicialização com o Windows:', err)
  }
  return { enabled, supported: app.isPackaged }
}

/**
 * Valida `unknown` -> boolean estrito e aplica no SO. Fora do app instalado
 * recusa sem tocar no registro. Lançamento da API do Electron vira
 * `{ success: false, error }`, nunca uma exceção para o IPC.
 */
export function setAutostart(value: unknown): { success: boolean; error?: string } {
  if (typeof value !== 'boolean') {
    return { success: false, error: 'Valor inválido para o autostart (esperado boolean).' }
  }
  if (!app.isPackaged) {
    return { success: false, error: 'Disponível apenas no app instalado.' }
  }
  try {
    if (value) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
        args: ['--hidden']
      })
    } else {
      app.setLoginItemSettings({ openAtLogin: false })
    }
    logger.info('autostart', value ? 'autostart ligado' : 'autostart desligado')
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('autostart', 'falha ao gravar o item de inicialização:', message)
    return {
      success: false,
      error: `Não foi possível atualizar a inicialização com o Windows: ${message}`
    }
  }
}
