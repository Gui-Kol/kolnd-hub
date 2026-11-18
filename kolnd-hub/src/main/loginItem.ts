import { app, ipcMain } from 'electron'
import { logger } from './logger'

/**
 * Autostart do próprio Kolnd Hub no Windows (task 07-7.3): registra/desregistra
 * `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` via
 * `app.setLoginItemSettings` — sem admin, por usuário. Windows-only (o Hub não
 * abstrai macOS/Linux hoje).
 *
 * O SO é a fonte da verdade: o estado exibido na UI é lido de volta do Windows
 * (`app.getLoginItemSettings().openAtLogin`) e NADA é persistido no
 * `config.json` — evita divergência entre store e registro.
 *
 * `args: ['--hidden']`: o Windows lança o executável com essa flag, e o main
 * a reconhece em `app.whenReady()` — a janela é criada oculta e o Hub sobe
 * direto para a bandeja. A primeira execução ignora a flag (wizard sempre
 * aparece). `path: process.execPath` aponta para `Kolnd Hub.exe` no app
 * empacotado (em dev aponta para o binário do Electron — por isso o recurso
 * é recusado fora do build instalado).
 */

/** Lê do SO se o Hub está agendado para iniciar com o Windows. Erro → `false`. */
export function getHubOpenAtLogin(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin === true
  } catch (err) {
    logger.error('loginItem', 'Falha ao ler configuração de inicialização:', err)
    return false
  }
}

/**
 * Liga/desliga o autostart no SO. Lança se a gravação no registro falhar — o
 * chamador (`setHubAutostart`) traduz para `{ success: false, error }`.
 */
export function setHubOpenAtLogin(enabled: boolean): void {
  if (enabled) {
    // path: no app instalado é o `Kolnd Hub.exe`; args: ['--hidden'] faz o Hub
    // subir para a bandeja sem exibir a janela (ver wiring em index.ts).
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ['--hidden'] })
    return
  }
  app.setLoginItemSettings({ openAtLogin: false })
}

/** Estado para a UI: `enabled` lido do SO + `supported` (false fora do app instalado). */
export function getHubAutostart(): { enabled: boolean; supported: boolean } {
  // Em dev (!app.isPackaged) o item de Run apontaria para o binário do
  // Electron — o recurso só existe no app instalado.
  return { enabled: getHubOpenAtLogin(), supported: app.isPackaged }
}

/**
 * Valida `unknown` → boolean estrito e aplica no SO. Usado pelo IPC
 * `hub:setAutostart` (e testável sem IPC). Fora do build instalado recusa sem
 * tocar no registro.
 */
export function setHubAutostart(value: unknown): { success: boolean; error?: string } {
  if (typeof value !== 'boolean') {
    return { success: false, error: 'Valor inválido para o autostart (esperado boolean).' }
  }
  if (!app.isPackaged) {
    // Defesa em profundidade: o toggle já nasce desabilitado em dev — nunca
    // registrar o binário do Electron como item de inicialização.
    return { success: false, error: 'Disponível apenas no app instalado.' }
  }
  try {
    setHubOpenAtLogin(value)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('loginItem', 'Falha ao gravar item de inicialização:', message)
    return {
      success: false,
      error: `Não foi possível atualizar a inicialização com o Windows: ${message}`
    }
  }
}

/** Registra os canais IPC do autostart do Hub (Windows-only, app instalado). */
export function registerLoginItemIpc(): void {
  ipcMain.handle('hub:getAutostart', () => getHubAutostart())

  ipcMain.handle('hub:setAutostart', (_event, value: unknown) => setHubAutostart(value))
}
