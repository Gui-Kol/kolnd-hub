import { ipcMain } from 'electron'
import { isAnyUninstallInProgress } from '../uninstaller'
import { logger } from '../logger'
import type { IpcContext } from './lifecycle'

// ── IPC: Big Picture — tela cheia ───────────────
// `setFullScreen` (NÃO `maximize`, NÃO `kiosk`): Alt+F4 oculta a janela para a
// bandeja (não encerra — o Sair explícito é quem encerra). Guarda os bounds
// antes de entrar e restaura ao
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

  ipcMain.handle('window:close', () => {
    // Durante uma desinstalação destrutiva, fechar pelo title bar é inerte
    // (nem oculta: o fluxo precisa da janela à vista).
    if (isAnyUninstallInProgress()) return
    const mainWindow = ctx.getMainWindow()
    if (!mainWindow) return
    // X da title bar customizada: vai para a bandeja, sem diálogo. Encerrar
    // de verdade é só pelo Sair explícito (Mais → Encerrar Hub ou bandeja).
    logger.info('window', 'janela ocultada para a bandeja (X)')
    mainWindow.hide()
  })
}
