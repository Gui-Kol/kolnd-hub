import { ipcMain } from 'electron'
import {
  listStartupItems,
  removeStartupItem,
  addStartupItem,
  removeStartupItemsBatch,
  addStartupItemsBatch
} from '../startupManager'
import type { IpcContext } from './lifecycle'

export function registerStartupIpc(_ctx: IpcContext): void {
  // ── Inicialização do PC (startup) ───────────────
  ipcMain.handle('startup:list', () => {
    return listStartupItems()
  })

  ipcMain.handle(
    'startup:remove',
    (_event, item: { location: string; scope: string; name: string }) => {
      return removeStartupItem(item as Parameters<typeof removeStartupItem>[0])
    }
  )

  ipcMain.handle('startup:add', (_event, item: { name: string; path: string }) => {
    return addStartupItem(item as Parameters<typeof addStartupItem>[0])
  })

  ipcMain.handle(
    'startup:removeBatch',
    (_event, items: Array<{ location: string; scope: string; name: string }>) => {
      return removeStartupItemsBatch(items as Parameters<typeof removeStartupItemsBatch>[0])
    }
  )

  ipcMain.handle('startup:addBatch', (_event, items: Array<{ name: string; path: string }>) => {
    return addStartupItemsBatch(items as Parameters<typeof addStartupItemsBatch>[0])
  })
}
