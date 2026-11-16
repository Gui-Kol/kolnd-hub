import { ipcMain } from 'electron'
import { isAnyUninstallInProgress } from '../uninstaller'
import { logger } from '../logger'
import { confirmAndQuit } from './lifecycle'
import type { IpcContext } from './lifecycle'

// ── IPC: Big Picture — tela cheia ───────────────
// `setFullScreen` (NÃO `maximize`, NÃO `kiosk`): a janela continua fechável
// por Alt+F4 em emergência. Guarda os bounds antes de entrar e restaura ao
// sair — o Electron nem sempre devolve a janela ao tamanho/posição exatos.
// Janelas maximizadas ficam fora dessa restauração (o estado maximized já
// devolve o tamanho correto sozinho).
let boundsBeforeFullscreen: Electron.Rectangle | null = null

export function registerWindowIpc(ctx: IpcContext): void {
  // ── IPC: Window controls ────────────────────────
  ipcMain.handle('window:minimize', () => ctx.getMainWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const mainWindow = ctx.getMainWindow()
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.handle('window:set-fullscreen', (_event, flag: unknown) => {
    if (typeof flag !== 'boolean') {
      logger.warn('window', 'set-fullscreen: flag inválida (esperado boolean)')
      return
    }
    const mainWindow = ctx.getMainWindow()
    if (!mainWindow) return
    if (flag) {
      boundsBeforeFullscreen = mainWindow.isMaximized() ? null : mainWindow.getBounds()
      mainWindow.setFullScreen(true)
      return
    }
    mainWindow.setFullScreen(false)
    const saved = boundsBeforeFullscreen
    boundsBeforeFullscreen = null
    if (saved) {
      mainWindow.once('leave-full-screen', () => {
        ctx.getMainWindow()?.setBounds(saved)
      })
    }
  })

  ipcMain.handle('window:close', async () => {
    // Durante uma desinstalação destrutiva, fechar pelo title bar é inerte.
    if (isAnyUninstallInProgress()) {
      return { success: false, error: 'Desinstalação em andamento — aguarde o término.' }
    }
    await confirmAndQuit(ctx)
    return { success: true }
  })
}
