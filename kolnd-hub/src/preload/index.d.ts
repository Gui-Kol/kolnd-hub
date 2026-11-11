declare global {
  interface Window {
    api: {
      // ── Sistema ─────────────────────────────────────
      systemPcName: () => Promise<string>
      systemRunningProcesses: () => Promise<
        Array<{ name: string; id: number; path: string }>
      >

      // ── App management ──────────────────────────────
      launchApp: (appId: string, command: string, cwd: string) => Promise<{ success: boolean; error?: string }>
      stopApp: (appId: string) => Promise<{ success: boolean; error?: string }>
      getAppStatus: (appId: string) => Promise<{ status: string; startedAt?: string; logCount: number }>
      getAllStatus: () => Promise<Record<string, { status: string; startedAt?: string }>>
      getAppLogs: (appId: string) => Promise<string>

      // ── Window controls ─────────────────────────────
      minimizeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>

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
      startupAdd: (
        item: { name: string; path: string }
      ) => Promise<{ success: boolean; error?: string }>
      startupRemoveBatch: (
        items: Array<{ location: string; scope: string; name: string }>
      ) => Promise<{ success: boolean; errors: string[] }>
      startupAddBatch: (
        items: Array<{ name: string; path: string }>
      ) => Promise<{ success: boolean; errors: string[] }>

      // ── Shell ───────────────────────────────────────
      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<void>

      // ── Events from main process ────────────────────
      onStatusChanged: (callback: (appId: string, status: string) => void) => () => void
      onAppOutput: (callback: (appId: string, data: string) => void) => () => void

      // ── Primeira execução ───────────────────────────
      firstRunCheck: () => Promise<boolean>
      firstRunMarkComplete: () => Promise<{ success: boolean; error?: string }>
      firstRunStart: () => Promise<{ success: boolean; error?: string }>
      firstRunCancel: () => Promise<{ success: boolean; error?: string }>

      // ── Eventos da primeira execução ────────────────
      onFirstRunProgress: (
        callback: (data: { stepId: string; status: 'running' | 'done' | 'error'; progress: number; message?: string }) => void
      ) => () => void
      onFirstRunLog: (callback: (line: string) => void) => () => void
      onFirstRunComplete: (
        callback: (result: { success: boolean; error?: string }) => void
      ) => () => void
    }
  }
}

export {}
