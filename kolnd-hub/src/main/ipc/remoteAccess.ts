import { ipcMain } from 'electron'
import {
  copyRemoteText,
  fetchPublicIp,
  getRemoteStatus,
  installTailscale,
  openKloudWebPanel,
  openTailscale,
  requestRemoteMode
} from '../remoteAccess'
import { getRemoteMode } from '../store'
import type { IpcContext } from './lifecycle'

/**
 * IPC do "Acesso remoto". Sem argumentos (exceto o texto de copiar, validado)
 * e sem segredos: o renderer só recebe estado e dispara ações explícitas.
 */
export function registerRemoteAccessIpc(_ctx: IpcContext): void {
  ipcMain.handle('remote:status', () => getRemoteStatus())

  ipcMain.handle('remote:get-mode', () => getRemoteMode())

  ipcMain.handle('remote:set-mode', (_event, value: unknown) => requestRemoteMode(value))

  ipcMain.handle('remote:public-ip', () => fetchPublicIp())

  ipcMain.handle('remote:install-tailscale', () => installTailscale())

  ipcMain.handle('remote:open-tailscale', () => openTailscale())

  ipcMain.handle('remote:open-kloud-web', () => openKloudWebPanel())

  ipcMain.handle('remote:copy', (_event, text: unknown) => copyRemoteText(text))
}
