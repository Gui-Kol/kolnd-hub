// Espelho manual de `src/renderer/src/lib/gamepad/types.ts` (T1).
// Qualquer alteração nos 12 controles/índices deve ser refletida lá e no index.ts.
interface GamepadButtonMapping {
  confirm: number | null
  back: number | null
  up: number | null
  down: number | null
  left: number | null
  right: number | null
  menu: number | null
  options: number | null
  tab_prev: number | null
  tab_next: number | null
  stick_left: number | null
  stick_right: number | null
}

interface GamepadConfig {
  profile: 'xbox' | 'playstation' | 'switch' | 'generic'
  controllerId: string
  controllerName: string
  vendorId?: string
  productId?: string
  mapping: GamepadButtonMapping
  autoMapped: boolean
  configuredAt: string
}

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
        running: boolean
      }>

      // ── Big Picture (modo tela cheia) ────────────────
      getGamepadConfig: () => Promise<{
        ok: boolean
        config: GamepadConfig | null
        error?: string
      }>
      setGamepadConfig: (config: GamepadConfig) => Promise<{ ok: boolean; error?: string }>
      resetGamepadConfig: () => Promise<{ ok: boolean; error?: string }>
      getBigPicturePrefs: () => Promise<{
        ok: boolean
        prefs: { sounds: boolean }
        error?: string
      }>
      setBigPicturePrefs: (prefs: { sounds: boolean }) => Promise<{ ok: boolean; error?: string }>

      // ── Preferências do Hub ───────────────────────────
      getLaunchKloudOnStart: () => Promise<boolean>
      setLaunchKloudOnStart: (value: boolean) => Promise<{ success: boolean; error?: string }>

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

      // ── Validação de comando (Configurações) ───────────────
      validateCommand: (
        command: string,
        useShell?: boolean
      ) => Promise<Array<{ level: 'error' | 'warning'; message: string }>>

      // ── Encerramento completo do Hub ────────────────
      shutdownHub: () => Promise<{ success: boolean; error?: string }>

      // ── Window controls ─────────────────────────────
      minimizeWindow: () => Promise<void>
      maximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      setFullScreen: (flag: boolean) => Promise<void>

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
      // Edição de jogos (T9)
      pickGameIcon: () => Promise<{
        success: boolean
        canceled?: boolean
        dataUrl?: string
        error?: string
      }>
      setGameIcon: (
        id: string,
        dataUrl: string
      ) => Promise<{ success: boolean; iconPath?: string; error?: string }>
      restoreGameIcon: (
        id: string,
        exePath?: string
      ) => Promise<{ success: boolean; iconPath?: string; error?: string }>
      previewGameIcon: (
        exePath: string
      ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>
      checkGameExes: (exePaths: string[]) => Promise<boolean[]>
      launchGame: (id: string) => Promise<{
        ok: boolean
        error?: string
        focused?: boolean
        alreadyRunning?: boolean
      }>
      stopGame: (id: string) => Promise<{ ok: boolean; error?: string; killed?: number }>
      getRunningGames: (ids: string[]) => Promise<{ ok: boolean; running: Record<string, boolean> }>
      getGameIcon: (id: string) => Promise<string | null>
      addCustomGame: (
        exePath: string
      ) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>

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
        currentValue?: string,
        dialogTitle?: string
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

      // ── Diagnóstico ─────────────────────────────────
      exportDiagnostic: () => Promise<{ success: boolean; error?: string }>

      // ── Desinstalação (Kloud Games e Hub) ────────────────────────
      getKloudGamesUninstallStatus: () => Promise<{
        ok: boolean
        detection?: {
          status: 'installed' | 'partial' | 'missing'
          exePath: string | null
          service: 'running' | 'stopped' | 'missing'
          entry: {
            productCode: string | null
            uninstallString: string
            displayName: string
            displayVersion?: string
            installLocation?: string
            publisher?: string
            scope: 'machine' | 'user' | 'both' | 'unknown'
          } | null
        }
        error?: string
      }>
      uninstallKloudGames: () => Promise<{ success: boolean; error?: string }>
      uninstallKloudGamesOrphan: () => Promise<{ success: boolean; error?: string }>
      removeKloudGamesService: () => Promise<{
        success: boolean
        error?: string
        serviceStatus?: string
      }>
      getHubUninstallStatus: () => Promise<{
        available: boolean
        uninstallerPath: string | null
        isPackaged: boolean
      }>
      backupHubData: () => Promise<
        { success: true; path: string } | { success: false; error: string }
      >
      uninstallHub: (args: {
        wipeUserData?: boolean
        skipKloud?: boolean
        backupPath?: string | null
      }) => Promise<{
        success: boolean
        paused?: boolean
        error?: string
        wipeErrors?: string[]
      }>
      openHubLogsFolder: () => Promise<void>
      onUninstallProgress: (
        callback: (data: {
          stepId: string
          status: 'running' | 'done' | 'error'
          progress: number
          message?: string
        }) => void
      ) => () => void
      onUninstallLog: (callback: (line: string) => void) => () => void
      onUninstallComplete: (
        callback: (result: {
          success: boolean
          error?: string
          report?: unknown
          paused?: boolean
          kloudError?: string
          stage?: string
          needsReboot?: boolean
          wipeErrors?: string[]
          cancelled?: boolean
          msiexecKind?: string
          orphanManual?: boolean
        }) => void
      ) => () => void
    }
  }
}

export {}
