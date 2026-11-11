import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ── Sistema ─────────────────────────────────────
  systemPcName: (): Promise<string> => ipcRenderer.invoke('system:pc-name'),

  systemRunningProcesses: (): Promise<
    Array<{ name: string; id: number; path: string }>
  > => ipcRenderer.invoke('system:running-processes'),

  // ── App management ──────────────────────────────
  launchApp: (appId: string, command: string, cwd: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:launch', appId, command, cwd),

  stopApp: (appId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:stop', appId),

  getAppStatus: (appId: string): Promise<{ status: string; startedAt?: string; logCount: number }> =>
    ipcRenderer.invoke('app:status', appId),

  getAllStatus: (): Promise<Record<string, { status: string; startedAt?: string }>> =>
    ipcRenderer.invoke('app:all-status'),

  getAppLogs: (appId: string): Promise<string> => ipcRenderer.invoke('app:logs', appId),

  // ── Window controls ─────────────────────────────
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),

  // ── Inicialização do PC (startup) ───────────────
  startupList: (): Promise<
    Array<{
      id: string
      name: string
      path: string
      location: 'registro' | 'pasta-inicializacao'
      scope: 'usuario' | 'sistema'
    }>
  > => ipcRenderer.invoke('startup:list'),

  startupRemove: (
    item: { location: string; scope: string; name: string }
  ): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('startup:remove', item),

  // ── Shell ───────────────────────────────────────
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path),

  // ── Events from main process ────────────────────
  onStatusChanged: (callback: (appId: string, status: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, appId: string, status: string): void =>
      callback(appId, status)
    ipcRenderer.on('app:status-changed', handler)
    return () => ipcRenderer.removeListener('app:status-changed', handler)
  },

  onAppOutput: (callback: (appId: string, data: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, appId: string, data: string): void =>
      callback(appId, data)
    ipcRenderer.on('app:output', handler)
    return () => ipcRenderer.removeListener('app:output', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
