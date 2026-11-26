import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AbsolemApi, type OverlayStatus } from '../shared/ipc'
import type { OverlaySetLayoutRequest } from '../shared/ipc'
import type { AvatarApplyPush, AvatarState } from '../shared/avatar'
import type { StoreKey, ThemeConfig } from '../shared/config'
import type { SettingsSection } from '../shared/ipc'

/**
 * Ponte fina: cada método só repassa o payload para `ipcRenderer.invoke`.
 * Nenhum `event` cruza a fronteira e nenhuma lógica de negócio vive aqui.
 */
const absolem: AbsolemApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  quit: () => ipcRenderer.invoke(IPC.appQuit),

  getAutostart: () => ipcRenderer.invoke(IPC.appGetAutostart),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke(IPC.appSetAutostart, { enabled }),

  overlayShow: () => ipcRenderer.invoke(IPC.overlayShow),
  overlayHide: () => ipcRenderer.invoke(IPC.overlayHide),
  overlayToggle: () => ipcRenderer.invoke(IPC.overlayToggle),
  overlayStatus: () => ipcRenderer.invoke(IPC.overlayStatus),
  overlaySetLayout: (layout: OverlaySetLayoutRequest) =>
    ipcRenderer.invoke(IPC.overlaySetLayout, layout),
  overlaySetInteractive: (interactive: boolean) =>
    ipcRenderer.invoke(IPC.overlaySetInteractive, { interactive }),
  onOverlayStatusChanged: (listener: (status: OverlayStatus) => void) => {
    const handler = (_event: unknown, status: OverlayStatus) => listener(status)
    ipcRenderer.on(IPC.overlayStatusChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.overlayStatusChanged, handler)
    }
  },

  avatar: {
    setState: (state: AvatarState) => ipcRenderer.invoke(IPC.avatarSetState, { state }),
    setLevel: (level: number) => ipcRenderer.invoke(IPC.avatarSetLevel, { level }),
    getStatus: () => ipcRenderer.invoke(IPC.avatarGetStatus),
    onApply: (listener: (payload: AvatarApplyPush) => void) => {
      const handler = (_event: unknown, payload: AvatarApplyPush) => listener(payload)
      ipcRenderer.on(IPC.avatarApply, handler)
      return () => {
        ipcRenderer.removeListener(IPC.avatarApply, handler)
      }
    }
  },

  storeGet: (key: StoreKey) => ipcRenderer.invoke(IPC.storeGet, { key }),
  storeSet: (key: StoreKey, value: unknown) => ipcRenderer.invoke(IPC.storeSet, { key, value }),

  openSettings: (section?: SettingsSection) =>
    ipcRenderer.invoke(IPC.settingsOpen, section === undefined ? {} : { section }),

  themeGet: () => ipcRenderer.invoke(IPC.themeGet),
  themeSet: (theme: Partial<ThemeConfig>) => ipcRenderer.invoke(IPC.themeSet, { theme })
}

contextBridge.exposeInMainWorld('absolem', absolem)
