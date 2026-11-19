import { ipcMain } from 'electron'
import { getPcName, listRunningProcesses } from '../startupManager'
import type { IpcContext } from './lifecycle'

export function registerSystemIpc(_ctx: IpcContext): void {
  // ── Sistema ─────────────────────────────────────
  ipcMain.handle('system:pc-name', () => {
    return getPcName()
  })

  ipcMain.handle('system:running-processes', () => {
    // Assíncrono: a consulta roda no helper PowerShell persistente do main e
    // nunca bloqueia o event loop (o polling antigo travava o app por ~5 s).
    return listRunningProcesses()
  })
}
