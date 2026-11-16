import { ipcMain } from 'electron'
import { isFirstRun, markFirstRunComplete } from '../firstRun'
import type { IpcContext } from './lifecycle'

export function registerFirstRunIpc(_ctx: IpcContext): void {
  // ── IPC: Primeira execução ──────────────────────
  ipcMain.handle('firstRun:check', () => {
    return isFirstRun()
  })

  ipcMain.handle('firstRun:markComplete', () => {
    markFirstRunComplete()
    return { success: true }
  })
}
