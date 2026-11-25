// Tipos de gamepad vêm de `src/shared/gamepad.ts` (05-5.4) — NÃO duplicar
// aqui nem no `index.ts`. Qualquer mudança nos 12 controles/índices acontece
// no shared; drift vira erro de compilação nos três processos.
import type { GamepadConfig } from '../shared/gamepad'
import type { DriverStatusInfo, HwSnapshot, InstallDriverResult } from '../shared/hwmon'
import type {
  DisplayConfirmResult,
  DisplayInfo,
  DisplayRevertedEvent,
  DisplaySetResult
} from '../shared/display'
import type {
  FpsAutoActionResult,
  FpsAutoStatus,
  FpsStartResult,
  FpsStatusInfo,
  FpsStopResult,
  FpsUpdate
} from '../shared/fps'
import type { HudSize, HudStatus, HudUpdate } from '../shared/hud'
import type { UpdateCheckResult, UpdateInstallResult, UpdateProgress } from '../shared/updates'
import type { GameImportReport } from '../shared/gameImport'
import type {
  PublicIpResult,
  RemoteActionResult,
  RemoteModeResult,
  RemoteStatus,
  ZeroTierPowerResult
} from '../shared/remote'

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

      // ── Acesso remoto (ZeroTier) ────────────────────
      remoteStatus: () => Promise<RemoteStatus>
      remoteGetMode: () => Promise<boolean>
      remoteSetMode: (value: boolean) => Promise<RemoteModeResult>
      remotePublicIp: () => Promise<PublicIpResult>
      remoteInstallZeroTier: () => Promise<RemoteActionResult>
      remoteOpenZeroTier: () => Promise<RemoteActionResult>
      remoteSetZeroTierOpen: (value: boolean) => Promise<ZeroTierPowerResult>
      remoteOpenKloudWeb: () => Promise<RemoteActionResult>
      remoteCopy: (text: string) => Promise<{ success: boolean; error?: string }>

      // ── Atualizações do app (GitHub Releases) ────────
      checkForUpdates: () => Promise<UpdateCheckResult>
      installUpdate: (releaseId: number) => Promise<UpdateInstallResult>
      cancelUpdate: () => Promise<{ ok: boolean; cancelled: boolean }>
      onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void

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
      getNotifyOnCrash: () => Promise<boolean>
      setNotifyOnCrash: (value: boolean) => Promise<{ success: boolean; error?: string }>
      // ── Autostart do Hub no Windows (07-7.3) ─────
      getHubAutostart: () => Promise<{ enabled: boolean; supported: boolean }>
      setHubAutostart: (value: boolean) => Promise<{ success: boolean; error?: string }>

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

      // ── Benchmark de CPU (Meu PC) ────────────────────
      runBenchmark: () => Promise<
        | {
            ok: true
            cancelled?: boolean
            single: number
            multi: number
            ratio: number
            cores: number
            model: string
            threads: number
            durationMs: number
            tests: Array<{ id: string; label: string; single: number; multi: number }>
            /** Alguma carga continuou com spread > 25 % mesmo após a repetição. */
            unstable: boolean
          }
        | { ok: false; cancelled?: boolean; error: string }
      >
      cancelBenchmark: () => Promise<{ ok: boolean; cancelled: boolean }>
      benchmarkInfo: () => Promise<{ cores: number; model: string }>
      benchmarkHistory: () => Promise<
        Array<{
          id: string
          at: string
          single: number
          multi: number
          ratio: number
          cores: number
          model: string
          tests: Array<{ id: string; label: string; single: number; multi: number }>
        }>
      >
      clearBenchmarkHistory: () => Promise<{ success: boolean }>
      onBenchmarkProgress: (
        callback: (progress: {
          phase: 'single' | 'multi'
          testId: string
          testLabel: string
          testIndex: number
          testCount: number
          percent: number
        }) => void
      ) => () => void
      startBenchmarkStress: () => Promise<{ ok: boolean; threads?: number; error?: string }>
      stopBenchmarkStress: () => Promise<{
        ok: boolean
        elapsedMs?: number
        checksumOk?: boolean
        error?: string
      }>
      /** Sinal de vida para o watchdog do estresse (a interface chama a cada 2 s). */
      ackBenchmarkStress: () => Promise<void>
      onBenchmarkStressProgress: (
        callback: (progress: { elapsedMs: number; threads: number; checksumOk: boolean }) => void
      ) => () => void

      // ── Monitor de hardware (Meu PC) ─────────────────
      // Tipos canônicos em `src/shared/hwmon.ts`.
      hwmonSnapshot: () => Promise<HwSnapshot>
      hwmonStart: () => Promise<{ ok: boolean }>
      hwmonStop: () => Promise<{ ok: boolean }>
      hwmonDriverStatus: () => Promise<DriverStatusInfo>
      hwmonInstallDriver: () => Promise<InstallDriverResult>
      hwmonGetInterval: () => Promise<{ intervalMs: number }>
      hwmonSetInterval: (ms: number) => Promise<{ success: boolean; intervalMs: number }>
      onHwMonitorUpdate: (callback: (snapshot: HwSnapshot) => void) => () => void

      // ── Tela (Meu PC) ───────────────────────────────
      // Tipos canônicos em `src/shared/display.ts`.
      getDisplayInfo: () => Promise<DisplayInfo>
      setDisplayResolution: (
        displayId: string,
        width: number,
        height: number,
        refreshHz: number
      ) => Promise<DisplaySetResult>
      setDisplayScale: (displayId: string, percent: number) => Promise<DisplaySetResult>
      confirmDisplayChange: () => Promise<DisplayConfirmResult>
      revertDisplayChange: () => Promise<{ ok: boolean; error?: string }>
      onDisplayReverted: (callback: (event: DisplayRevertedEvent) => void) => () => void

      // ── Desempenho: FPS/frametime por ETW (Meu PC) ───
      // Tipos canônicos em `src/shared/fps.ts`; `fpsStart` pede UAC.
      fpsStatus: () => Promise<FpsStatusInfo>
      fpsStart: () => Promise<FpsStartResult>
      fpsStop: () => Promise<FpsStopResult>
      onFpsUpdate: (callback: (update: FpsUpdate) => void) => () => void

      // ── FPS automático (tarefa agendada no logon) ────
      fpsAutoStatus: () => Promise<FpsAutoStatus>
      fpsAutoInstall: () => Promise<FpsAutoActionResult>
      fpsAutoRemove: () => Promise<FpsAutoActionResult>
      onFpsAutoUpdate: (callback: (status: FpsAutoStatus) => void) => () => void

      // ── Sobreposição (HUD) ───────────────────────────
      // Tipos canônicos em `src/shared/hud.ts`.
      hudGet: () => Promise<HudStatus>
      hudSetShortcut: (
        shortcut: string
      ) => Promise<{ success: boolean; status: HudStatus; error?: string }>
      hudSetVisible: (visible: boolean) => Promise<HudStatus>
      hudSetSize: (
        size: Partial<HudSize>
      ) => Promise<{ success: boolean; status: HudStatus; error?: string }>
      hudReportSize: (height: number) => Promise<{ height: number }>
      onHudStatus: (callback: (status: HudStatus) => void) => () => void
      hudToggle: () => Promise<HudStatus>
      onHudUpdate: (callback: (update: HudUpdate) => void) => () => void

      // ── Biblioteca de jogos ───────────────────────
      getGames: () => Promise<
        Array<{
          id: string
          name: string
          exePath: string
          iconPath: string | null
          origin: 'steam' | 'epic' | 'minecraft' | 'custom'
          steamAppId?: number
          addedAt: string
          favorite?: boolean
          collections?: string[]
          playtimeSeconds?: number
          playtimeDays?: Record<string, number>
          lastPlayedAt?: string
          coverPath?: string | null
        }>
      >
      addGame: (game: {
        id: string
        name: string
        exePath: string
        iconPath?: string | null
        origin: 'steam' | 'epic' | 'minecraft' | 'custom'
        steamAppId?: number
        addedAt?: string
      }) => Promise<{ success: boolean; error?: string }>
      updateGame: (
        id: string,
        patch: {
          name?: string
          exePath?: string
          iconPath?: string | null
          origin?: 'steam' | 'epic' | 'minecraft' | 'custom'
          steamAppId?: number | null
          favorite?: boolean
          collections?: string[]
          coverPath?: string | null
        }
      ) => Promise<{ success: boolean; error?: string }>
      getGameCollections: () => Promise<string[]>
      createGameCollection: (
        name: string
      ) => Promise<{ success: boolean; error?: string; collections?: string[] }>
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
      reloadGameIcons: () => Promise<{ checked: number; reloaded: number; failed: number }>
      refreshGameIcons: () => Promise<{ checked: number; refreshed: number; failed: number }>
      launchGame: (id: string) => Promise<{
        ok: boolean
        error?: string
        focused?: boolean
        alreadyRunning?: boolean
      }>
      stopGame: (id: string) => Promise<{ ok: boolean; error?: string; killed?: number }>
      getRunningGames: (ids: string[]) => Promise<{ ok: boolean; running: Record<string, boolean> }>
      getGameIcon: (id: string) => Promise<string | null>
      pickGameCover: () => Promise<{
        success: boolean
        canceled?: boolean
        dataUrl?: string
        error?: string
      }>
      setGameCover: (
        id: string,
        dataUrl: string
      ) => Promise<{ success: boolean; coverPath?: string | null; error?: string }>
      getGameCover: (id: string) => Promise<string | null>
      addCustomGame: (
        exePath: string
      ) => Promise<{ success: boolean; id?: string; name?: string; error?: string }>

      // ── Busca de jogos (Steam + Epic Games + Minecraft Launcher) ──
      importGames: () => Promise<GameImportReport>

      // ── Diálogos (Configurações) ────────────────────
      pickAppPath: (
        mode: 'file' | 'directory',
        currentValue?: string,
        dialogTitle?: string
      ) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>

      // ── Shell ───────────────────────────────────────
      openExternal: (url: string) => Promise<void>
      openPath: (path: string) => Promise<void>
      // Abre `%APPDATA%/kolnd-hub/logs` no Explorer (05-5.7) — sem argumentos.
      openLogsFolder: () => Promise<{ success: boolean; error?: string }>

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

      // ── Backup e restauração (07-7.6) ──────────────
      exportConfig: () => Promise<{
        success: boolean
        path?: string
        canceled?: boolean
        error?: string
      }>
      importConfigPreview: () => Promise<
        | {
            ok: true
            summary: { apps: number; games: number; sections: string[] }
            rejected: Array<{ section: string; error: string }>
          }
        | { ok: false; canceled: true }
        | { ok: false; errors: string[] }
      >
      importConfigApply: () => Promise<
        | {
            success: true
            applied: string[]
            failed: Array<{ section: string; error: string }>
            backupPath: string
          }
        | { success: false; error: string }
      >

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
