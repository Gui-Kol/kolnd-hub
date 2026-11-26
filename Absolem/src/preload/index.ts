import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AbsolemApi } from '../shared/ipc'
import type { StoreKey, ThemeConfig } from '../shared/config'
import type { SettingsSection } from '../shared/ipc'

/**
 * Ponte fina: cada método só repassa o payload para `ipcRenderer.invoke`.
 * Nenhum `event` cruza a fronteira e nenhuma lógica de negócio vive aqui.
 */
const absolem: AbsolemApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  quit: () => ipcRenderer.invoke(IPC.appQuit),

  overlayShow: () => ipcRenderer.invoke(IPC.overlayShow),
  overlayHide: () => ipcRenderer.invoke(IPC.overlayHide),
  overlayToggle: () => ipcRenderer.invoke(IPC.overlayToggle),

  storeGet: (key: StoreKey) => ipcRenderer.invoke(IPC.storeGet, { key }),
  storeSet: (key: StoreKey, value: unknown) => ipcRenderer.invoke(IPC.storeSet, { key, value }),

  openSettings: (section?: SettingsSection) =>
    ipcRenderer.invoke(IPC.settingsOpen, section === undefined ? {} : { section }),

  themeGet: () => ipcRenderer.invoke(IPC.themeGet),
  themeSet: (theme: Partial<ThemeConfig>) => ipcRenderer.invoke(IPC.themeSet, { theme })
}

contextBridge.exposeInMainWorld('absolem', absolem)
