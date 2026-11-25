import { ipcMain } from 'electron'
import {
  copyRemoteText,
  fetchPublicIp,
  getRemoteStatus,
  installZeroTier,
  openKloudWebPanel,
  openZeroTier,
  requestRemoteMode,
  setZeroTierOpen
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

  ipcMain.handle('remote:install-zerotier', () => installZeroTier())

  ipcMain.handle('remote:open-zerotier', () => openZeroTier())

  // `unknown` de propósito: a validação (boolean) vive em `setZeroTierOpen`,
  // que devolve erro estruturado para o renderer em vez de lançar.
  ipcMain.handle('remote:set-zerotier-open', (_event, value: unknown) => setZeroTierOpen(value))

  ipcMain.handle('remote:open-kloud-web', () => openKloudWebPanel())

  ipcMain.handle('remote:copy', (_event, text: unknown) => copyRemoteText(text))
}
