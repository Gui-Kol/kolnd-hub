declare global {
  interface Window {
    api: {
      launchApp: (appId: string, command: string, cwd: string) => Promise<{ success: boolean; error?: string }>
      stopApp: (appId: string) => Promise<{ success: boolean; error?: string }>
      getAppStatus: (appId: string) => Promise<{ status: string; startedAt?: string; logCount: number }>
      getAllStatus: () => Promise<Record<string, { status: string; startedAt?: string }>>
      getAppLogs: (appId: string) => Promise<string>
      minimizeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<void>
      onStatusChanged: (callback: (appId: string, status: string) => void) => () => void
      onAppOutput: (callback: (appId: string, data: string) => void) => () => void
      // ── Sistema ─────────────────────────────────────
      systemPcName: () => Promise<string>
      systemRunningProcesses: () => Promise<
        Array<{ name: string; id: number; path: string }>
      >
      // ── Inicialização do PC (startup) ───────────────
      startupList: () => Promise<
        Array<{
          id: string
          name: string
          path: string
          location: 'registro' | 'pasta-inicializacao'
          scope: 'usuario' | 'sistema'
        }>
      >
      startupRemove: (
        item: { location: string; scope: string; name: string }
      ) => Promise<{ success: boolean; error?: string }>
    }
  }
}

export {}
