import { ipcMain } from 'electron'
import { cancelUpdate, checkForUpdate, installUpdate } from '../appUpdates'
import type { IpcContext } from './lifecycle'

/**
 * IPC das atualizações do app (GitHub Releases).
 *
 * `updates:check` não recebe argumentos; `updates:install` aceita apenas o ID
 * numérico da release — a URL do instalador é reconsultada/validada no main.
 * `updates:cancel` interrompe o download em andamento. O progresso chega ao
 * renderer pelo evento `update:progress`.
 */
export function registerUpdatesIpc(ctx: IpcContext): void {
  ipcMain.handle('updates:check', () => checkForUpdate())

  ipcMain.handle('updates:install', (_event, releaseId: unknown) => installUpdate(ctx, releaseId))

  ipcMain.handle('updates:cancel', () => cancelUpdate())
}
