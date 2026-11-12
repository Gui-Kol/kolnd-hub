declare global {
  interface Window {
    api: {
      // ── Sistema ─────────────────────────────────────
      systemPcName: () => Promise<string>
      systemRunningProcesses: () => Promise<Array<{ name: string; id: number; path: string }>>

      // ── Kloud Games ─────────────────────────────────
      kloudGamesLaunch: () => Promise<{
        success: boolean
        error?: string
        exePath?: string
        cwd?: string
        installedNow?: boolean
      }>
      kloudGamesStatus: () => Promise<{
        installed: boolean
        exePath: string | null
        msiPath: string | null
        dir: string
      }>

      // ── App management ──────────────────────────────
      launchApp: (
        appId: string,
        command: string,
        cwd: string,
        useShell?: boolean
      ) => Promise<{ success: boolean; error?: string }>
      stopApp: (appId: string, command?: string) => Promise<{ success: boolean; error?: string }>
      getAppStatus: (
        appId: string
      ) => Promise<{ status: string; startedAt?: string; logCount: number }>
      getAllStatus: () => Promise<Record<string, { status: string; startedAt?: string }>>
      getAppLogs: (appId: string) => Promise<string>

      // ── Encerramento completo do Hub ────────────────
      shutdownHub: () => Promise<{ success: boolean }>

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
      startupRemove: (item: {
        location: string
        scope: string
        name: string
      }) => Promise<{ success: boolean; error?: string }>
      startupAdd: (item: {
        name: string
        path: string
      }) => Promise<{ success: boolean; error?: string }>
      startupRemoveBatch: (
        items: Array<{ location: string; scope: string; name: string }>
      ) => Promise<{ success: boolean; errors: string[] }>
      startupAddBatch: (
        items: Array<{ name: string; path: string }>
      ) => Promise<{ success: boolean; errors: string[] }>

      // ── Winget (Manutenção do PC) ───────────────────
      listUpgradableUpdates: () => Promise<{
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
      }>
      upgradeOneUpdate: (
        id: string
      ) => Promise<{ ok: boolean; exitCode: number | null; log: string }>
      killUpgrade: () => Promise<{ ok: boolean; error?: string }>

      // ── Limpeza do PC (Manutenção) ───────────────────
      cleanTempFiles: () => Promise<{
        ok: boolean
        filesRemoved: number
        bytesFreed: number
        skippedLocked: number
        errors: number
        paths?: string[]
        error?: string
      }>

      // ── Biblioteca de jogos ───────────────────────
      getGames: () => Promise<
        Array<{
          id: string
          name: string
          exePath: string
          iconPath: string | null
          origin: 'steam' | 'custom'
          steamAppId?: number
          addedAt: string
        }>
      >
      addGame: (game: {
        id: string
        name: string
        exePath: string
        iconPath?: string | null
        origin: 'steam' | 'custom'
        steamAppId?: number
        addedAt?: string
      }) => Promise<{ success: boolean; error?: string }>
      updateGame: (
        id: string,
        patch: {
          name?: string
          exePath?: string
          iconPath?: string | null
          origin?: 'steam' | 'custom'
          steamAppId?: number | null
        }
      ) => Promise<{ success: boolean; error?: string }>
      removeGame: (id: string) => Promise<{ success: boolean; error?: string }>
      launchGame: (id: string) => Promise<{ ok: boolean; error?: string }>
      getGameIcon: (id: string) => Promise<string | null>

      // ── Steam ───────────────────────────────────
      importSteamGames: () => Promise<{
        ok: boolean
        imported: number
        alreadyInLibrary: number
        ignoredTools: number
        noExe: number
        errors: string[]
        error?: string
      }>

      // ── Diálogos (Configurações) ────────────────────
      pickAppPath: (
        mode: 'file' | 'directory',
        currentValue?: string
      ) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>

      // ── Shell ───────────────────────────────────────
      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<void>

      // Config persistente (electron-store)
      configGet: () => Promise<{
        apps: Array<Record<string, unknown>> | null
        startupImportance: Record<string, 'critico' | 'recomendado' | 'opcional' | 'inutil'> | null
      }>
      configSetApps: (
        apps: Array<Record<string, unknown>>
      ) => Promise<{ success: boolean; error?: string }>
      configSetStartupImportance: (
        importance: Record<string, 'critico' | 'recomendado' | 'opcional' | 'inutil'>
      ) => Promise<{ success: boolean; error?: string }>
      configMigrate: (payload: {
        apps?: Array<Record<string, unknown>>
        startupImportance?: Record<string, 'critico' | 'recomendado' | 'opcional' | 'inutil'>
      }) => Promise<{ success: boolean; error?: string }>

      // ── Events from main process ────────────────────
      onStatusChanged: (callback: (appId: string, status: string) => void) => () => void
      onAppOutput: (callback: (appId: string, data: string) => void) => () => void

      // ── Primeira execução ───────────────────────────
      firstRunCheck: () => Promise<boolean>
      firstRunMarkComplete: () => Promise<{ success: boolean; error?: string }>
      firstRunStart: () => Promise<{ success: boolean; error?: string }>
      firstRunCancel: () => Promise<{ success: boolean; error?: string }>
      firstRunRetryKloudGames: () => Promise<{ success: boolean; error?: string }>

      // ── Eventos da primeira execução ────────────────
      onFirstRunProgress: (
        callback: (data: {
          stepId: string
          status: 'running' | 'done' | 'error'
          progress: number
          message?: string
        }) => void
      ) => () => void
      onFirstRunLog: (callback: (line: string) => void) => () => void
      onFirstRunComplete: (
        callback: (result: { success: boolean; error?: string }) => void
      ) => () => void
    }
  }
}

export {}
