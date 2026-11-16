import { ipcMain } from 'electron'
import { getPcName, listRunningProcesses } from '../startupManager'
import type { IpcContext } from './lifecycle'

export function registerSystemIpc(_ctx: IpcContext): void {
  // ── Sistema ─────────────────────────────────────
  ipcMain.handle('system:pc-name', () => {
    return getPcName()
  })

  ipcMain.handle('system:running-processes', () => {
    return listRunningProcesses()
  })
}
