import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // ── Sistema ─────────────────────────────────────
  systemPcName: (): Promise<string> => ipcRenderer.invoke('system:pc-name'),

  systemRunningProcesses: (): Promise<Array<{ name: string; id: number; path: string }>> =>
    ipcRenderer.invoke('system:running-processes'),

  // ── Kloud Games ─────────────────────────────────
  kloudGamesLaunch: (): Promise<{
    success: boolean
    error?: string
    exePath?: string
    cwd?: string
    installedNow?: boolean
  }> => ipcRenderer.invoke('kloud-games:launch'),

  kloudGamesStatus: (): Promise<{
    installed: boolean
    exePath: string | null
    msiPath: string | null
    dir: string
  }> => ipcRenderer.invoke('kloud-games:status'),

  // ── App management ──────────────────────────────
  launchApp: (
    appId: string,
    command: string,
    cwd: string,
    useShell?: boolean
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:launch', appId, command, cwd, useShell),

  stopApp: (appId: string, command?: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:stop', appId, command),

  getAppStatus: (
    appId: string
  ): Promise<{ status: string; startedAt?: string; logCount: number }> =>
    ipcRenderer.invoke('app:status', appId),

  getAllStatus: (): Promise<Record<string, { status: string; startedAt?: string }>> =>
    ipcRenderer.invoke('app:all-status'),

  getAppLogs: (appId: string): Promise<string> => ipcRenderer.invoke('app:logs', appId),

  // ── Window controls ─────────────────────────────
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),

  // ── Encerramento completo do Hub ────────────────
  shutdownHub: (): Promise<{ success: boolean }> => ipcRenderer.invoke('app:shutdown'),

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

  startupRemove: (item: {
    location: string
    scope: string
    name: string
  }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('startup:remove', item),

  startupAdd: (item: {
    name: string
    path: string
  }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('startup:add', item),

  startupRemoveBatch: (
    items: Array<{ location: string; scope: string; name: string }>
  ): Promise<{ success: boolean; errors: string[] }> =>
    ipcRenderer.invoke('startup:removeBatch', items),

  startupAddBatch: (
    items: Array<{ name: string; path: string }>
  ): Promise<{ success: boolean; errors: string[] }> =>
    ipcRenderer.invoke('startup:addBatch', items),

  // ── Winget (Manutenção do PC) ───────────────────
  listUpgradableUpdates: (): Promise<{
    ok: boolean
    items?: Array<{
      name: string
      id: string
      currentVersion: string
      availableVersion: string
    }>
    error?: string
    rawLog?: string
    wingetMissing?: boolean
  }> => ipcRenderer.invoke('winget:list-upgrades'),

  upgradeOneUpdate: (id: string): Promise<{ ok: boolean; exitCode: number | null; log: string }> =>
    ipcRenderer.invoke('winget:upgrade-one', { id }),

  killUpgrade: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('winget:kill-upgrade'),

  // ── Limpeza do PC (Manutenção) ───────────────────
  cleanTempFiles: (): Promise<{
    ok: boolean
    filesRemoved: number
    bytesFreed: number
    skippedLocked: number
    errors: number
    paths?: string[]
    error?: string
  }> => ipcRenderer.invoke('system:clean-temp'),

  // ── Biblioteca de jogos ──────────────────────────
  getGames: (): Promise<
    Array<{
      id: string
      name: string
      exePath: string
      iconPath: string | null
      origin: 'steam' | 'custom'
      steamAppId?: number
      addedAt: string
    }>
  > => ipcRenderer.invoke('games:get'),

  addGame: (game: {
    id: string
    name: string
    exePath: string
    iconPath?: string | null
    origin: 'steam' | 'custom'
    steamAppId?: number
    addedAt?: string
  }): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('games:add', game),

  updateGame: (
    id: string,
    patch: {
      name?: string
      exePath?: string
      iconPath?: string | null
      origin?: 'steam' | 'custom'
      steamAppId?: number | null
    }
  ): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('games:update', id, patch),

  removeGame: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('games:remove', id),

  launchGame: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('games:launch', id),

  getGameIcon: (id: string): Promise<string | null> => ipcRenderer.invoke('games:get-icon', id),

  // ── Steam ─────────────────────────────────────────
  importSteamGames: (): Promise<{
    ok: boolean
    imported: number
    alreadyInLibrary: number
    ignoredTools: number
    noExe: number
    errors: string[]
    error?: string
  }> => ipcRenderer.invoke('steam:import'),

  // ── Diálogos (Configurações) ────────────────────
  pickAppPath: (
    mode: 'file' | 'directory',
    currentValue?: string
  ): Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('dialog:pick-path', mode, currentValue),

  // ── Shell ───────────────────────────────────────
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path),

  // Config persistente (electron-store). Fallback do renderer: localStorage
  // (usado se a IPC falhar ou o store estiver indisponível). Migração única
  // de localStorage→store acontece pela configMigrate.
  configGet: (): Promise<{
    apps: Array<Record<string, unknown>> | null
    startupImportance: Record<string, 'critico' | 'recomendado' | 'opcional' | 'inutil'> | null
  }> => ipcRenderer.invoke('config:get'),

  configSetApps: (
    apps: Array<Record<string, unknown>>
  ): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('config:setApps', apps),

  configSetStartupImportance: (
    importance: Record<string, 'critico' | 'recomendado' | 'opcional' | 'inutil'>
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('config:setStartupImportance', importance),

  configMigrate: (payload: {
    apps?: Array<Record<string, unknown>>
    startupImportance?: Record<string, 'critico' | 'recomendado' | 'opcional' | 'inutil'>
  }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('config:migrate', payload),

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
  },

  // ── Primeira execução ───────────────────────────
  firstRunCheck: (): Promise<boolean> => ipcRenderer.invoke('firstRun:check'),
  firstRunMarkComplete: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('firstRun:markComplete'),
  firstRunStart: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('firstRun:start'),
  firstRunCancel: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('firstRun:cancel'),
  firstRunRetryKloudGames: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('firstRun:retry-kloud-games'),

  // ── Eventos da primeira execução ────────────────
  onFirstRunProgress: (
    callback: (data: {
      stepId: string
      status: 'running' | 'done' | 'error'
      progress: number
      message?: string
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        stepId: string
        status: 'running' | 'done' | 'error'
        progress: number
        message?: string
      }
    ): void => callback(data)
    ipcRenderer.on('firstRun:progress', handler)
    return () => ipcRenderer.removeListener('firstRun:progress', handler)
  },

  onFirstRunLog: (callback: (line: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: string): void => callback(line)
    ipcRenderer.on('firstRun:log', handler)
    return () => ipcRenderer.removeListener('firstRun:log', handler)
  },

  onFirstRunComplete: (
    callback: (result: { success: boolean; error?: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: { success: boolean; error?: string }
    ): void => callback(result)
    ipcRenderer.on('firstRun:complete', handler)
    return () => ipcRenderer.removeListener('firstRun:complete', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
