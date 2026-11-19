import { contextBridge, ipcRenderer } from 'electron'

// Tipos de gamepad vêm de `src/shared/gamepad.ts` (05-5.4) — NÃO duplicar
// aqui nem no `index.d.ts`. Qualquer mudança nos 12 controles/índices
// acontece no shared; drift vira erro de compilação nos três processos.
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
import type {
  OfficeArchiveAllResult,
  OfficeArchivedListResult,
  OfficeAvatarLook,
  OfficeAvatarResult,
  OfficeDepartmentApplyResult,
  OfficeDepartmentDeleteResult,
  OfficeDepartmentResult,
  OfficeHealth,
  OfficeHireInput,
  OfficeManageResult,
  OfficePromptSendInput,
  OfficeRosterResult,
  OfficeSessionsListResult,
  OfficeSetRoleInput,
  OfficeSnapshot,
  OfficeTranscriptResult
} from '../shared/office'
import type {
  PluginInstallResult,
  PluginRemoveResult,
  PluginSnippetResult,
  PluginStatus
} from '../main/office/pluginInstaller'
import type {
  OfficeActionEnqueueResult,
  OfficeActionModeInput,
  OfficeActionOutcome,
  OfficeApprovePermissionInput,
  OfficeDenyPermissionInput,
  OfficeSendMessageInput
} from '../main/office/actions'
import type { UpdateCheckResult, UpdateInstallResult, UpdateProgress } from '../shared/updates'
import type {
  PublicIpResult,
  RemoteActionResult,
  RemoteModeResult,
  RemoteStatus
} from '../shared/remote'

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
    running: boolean
  }> => ipcRenderer.invoke('kloud-games:status'),

  // ── Acesso remoto (Tailscale) ───────────────────
  remoteStatus: (): Promise<RemoteStatus> => ipcRenderer.invoke('remote:status'),

  remoteGetMode: (): Promise<boolean> => ipcRenderer.invoke('remote:get-mode'),

  remoteSetMode: (value: boolean): Promise<RemoteModeResult> =>
    ipcRenderer.invoke('remote:set-mode', value),

  remotePublicIp: (): Promise<PublicIpResult> => ipcRenderer.invoke('remote:public-ip'),

  remoteInstallTailscale: (): Promise<RemoteActionResult> =>
    ipcRenderer.invoke('remote:install-tailscale'),

  remoteOpenTailscale: (): Promise<RemoteActionResult> =>
    ipcRenderer.invoke('remote:open-tailscale'),

  remoteOpenKloudWeb: (): Promise<RemoteActionResult> =>
    ipcRenderer.invoke('remote:open-kloud-web'),

  remoteCopy: (text: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('remote:copy', text),

  // ── Atualizações do app (GitHub Releases) ────────
  // O renderer só recebe o que o main validou e devolve o ID da release.
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),

  installUpdate: (releaseId: number): Promise<UpdateInstallResult> =>
    ipcRenderer.invoke('updates:install', releaseId),

  cancelUpdate: (): Promise<{ ok: boolean; cancelled: boolean }> =>
    ipcRenderer.invoke('updates:cancel'),

  onUpdateProgress: (callback: (progress: UpdateProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: UpdateProgress): void =>
      callback(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },

  // ── Preferências do Hub ───────────────────────────
  getLaunchKloudOnStart: (): Promise<boolean> => ipcRenderer.invoke('prefs:get'),

  setLaunchKloudOnStart: (value: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('prefs:set', value),

  getNotifyOnCrash: (): Promise<boolean> => ipcRenderer.invoke('prefs:get-notify'),

  setNotifyOnCrash: (value: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('prefs:set-notify', value),

  // ── Autostart do Hub no Windows (07-7.3) ─────────
  getHubAutostart: (): Promise<{ enabled: boolean; supported: boolean }> =>
    ipcRenderer.invoke('hub:getAutostart'),

  setHubAutostart: (value: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('hub:setAutostart', value),

  // ── Big Picture (modo tela cheia) ────────────────
  getGamepadConfig: (): Promise<{
    ok: boolean
    config: GamepadConfig | null
    error?: string
  }> => ipcRenderer.invoke('gamepad:get'),

  setGamepadConfig: (config: GamepadConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('gamepad:set', config),

  resetGamepadConfig: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('gamepad:reset'),

  getBigPicturePrefs: (): Promise<{
    ok: boolean
    prefs: { sounds: boolean }
    error?: string
  }> => ipcRenderer.invoke('bigpicture:get-prefs'),

  setBigPicturePrefs: (prefs: { sounds: boolean }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('bigpicture:set-prefs', prefs),

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

  // ── Validação de comando (Configurações) ───────────────
  validateCommand: (
    command: string,
    useShell?: boolean
  ): Promise<Array<{ level: 'error' | 'warning'; message: string }>> =>
    ipcRenderer.invoke('command:validate', command, useShell),

  // ── Window controls ─────────────────────────────
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  setFullScreen: (flag: boolean): Promise<void> =>
    ipcRenderer.invoke('window:set-fullscreen', flag),

  // ── Encerramento completo do Hub ────────────────
  shutdownHub: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:shutdown'),

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

  // ── Benchmark de CPU (Meu PC) ────────────────────
  // Tipos duplicados de propósito (main/preload/renderer não se importam).
  runBenchmark: (): Promise<
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
  > => ipcRenderer.invoke('benchmark:run'),

  cancelBenchmark: (): Promise<{ ok: boolean; cancelled: boolean }> =>
    ipcRenderer.invoke('benchmark:cancel'),

  benchmarkInfo: (): Promise<{ cores: number; model: string }> =>
    ipcRenderer.invoke('benchmark:info'),

  benchmarkHistory: (): Promise<
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
  > => ipcRenderer.invoke('benchmark:history'),

  clearBenchmarkHistory: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('benchmark:history-clear'),

  onBenchmarkProgress: (
    callback: (progress: {
      phase: 'single' | 'multi'
      testId: string
      testLabel: string
      testIndex: number
      testCount: number
      percent: number
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: {
        phase: 'single' | 'multi'
        testId: string
        testLabel: string
        testIndex: number
        testCount: number
        percent: number
      }
    ): void => callback(progress)
    ipcRenderer.on('benchmark:progress', handler)
    return () => ipcRenderer.removeListener('benchmark:progress', handler)
  },

  startBenchmarkStress: (): Promise<{ ok: boolean; threads?: number; error?: string }> =>
    ipcRenderer.invoke('benchmark:stress-start'),

  stopBenchmarkStress: (): Promise<{
    ok: boolean
    elapsedMs?: number
    checksumOk?: boolean
    error?: string
  }> => ipcRenderer.invoke('benchmark:stress-stop'),

  // Sinal de vida para o watchdog do estresse (a interface chama a cada 2 s).
  ackBenchmarkStress: (): Promise<void> => ipcRenderer.invoke('benchmark:stress-ack'),

  onBenchmarkStressProgress: (
    callback: (progress: { elapsedMs: number; threads: number; checksumOk: boolean }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: { elapsedMs: number; threads: number; checksumOk: boolean }
    ): void => callback(progress)
    ipcRenderer.on('benchmark:stress-progress', handler)
    return () => ipcRenderer.removeListener('benchmark:stress-progress', handler)
  },

  // ── Monitor de hardware (Meu PC) ─────────────────
  // Tipos vêm de `src/shared/hwmon.ts` — sem duplicação entre processos.
  hwmonSnapshot: (): Promise<HwSnapshot> => ipcRenderer.invoke('hwmon:snapshot'),

  hwmonStart: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('hwmon:start'),

  hwmonStop: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('hwmon:stop'),

  hwmonDriverStatus: (): Promise<DriverStatusInfo> => ipcRenderer.invoke('hwmon:driver-status'),

  hwmonInstallDriver: (): Promise<InstallDriverResult> =>
    ipcRenderer.invoke('hwmon:install-driver'),

  hwmonGetInterval: (): Promise<{ intervalMs: number }> => ipcRenderer.invoke('hwmon:get-interval'),

  hwmonSetInterval: (ms: number): Promise<{ success: boolean; intervalMs: number }> =>
    ipcRenderer.invoke('hwmon:set-interval', ms),

  onHwMonitorUpdate: (callback: (snapshot: HwSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: HwSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('hwmon:update', handler)
    return () => ipcRenderer.removeListener('hwmon:update', handler)
  },

  // ── Tela (Meu PC) ───────────────────────────────
  // Tipos vêm de `src/shared/display.ts` — sem duplicação entre processos.
  getDisplayInfo: (): Promise<DisplayInfo> => ipcRenderer.invoke('display:get'),

  setDisplayResolution: (
    displayId: string,
    width: number,
    height: number,
    refreshHz: number
  ): Promise<DisplaySetResult> =>
    ipcRenderer.invoke('display:set-resolution', displayId, width, height, refreshHz),

  setDisplayScale: (displayId: string, percent: number): Promise<DisplaySetResult> =>
    ipcRenderer.invoke('display:set-scale', displayId, percent),

  confirmDisplayChange: (): Promise<DisplayConfirmResult> =>
    ipcRenderer.invoke('display:confirm-change'),

  revertDisplayChange: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('display:revert-change'),

  onDisplayReverted: (callback: (event: DisplayRevertedEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: DisplayRevertedEvent): void =>
      callback(payload)
    ipcRenderer.on('display:change-reverted', handler)
    return () => ipcRenderer.removeListener('display:change-reverted', handler)
  },

  // ── Desempenho: FPS/frametime por ETW (Meu PC) ───
  // Opt-in explícito: `fpsStart` pede permissão de administrador (UAC).
  fpsStatus: (): Promise<FpsStatusInfo> => ipcRenderer.invoke('fps:status'),

  fpsStart: (): Promise<FpsStartResult> => ipcRenderer.invoke('fps:start'),

  fpsStop: (): Promise<FpsStopResult> => ipcRenderer.invoke('fps:stop'),

  onFpsUpdate: (callback: (update: FpsUpdate) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, update: FpsUpdate): void => callback(update)
    ipcRenderer.on('fps:update', handler)
    return () => ipcRenderer.removeListener('fps:update', handler)
  },

  // ── FPS automático (tarefa no logon) ──────────────
  // Instalar/remover pede UAC explícito; a leitura de `latest.json` é passiva.
  fpsAutoStatus: (): Promise<FpsAutoStatus> => ipcRenderer.invoke('fps:auto-status'),

  fpsAutoInstall: (): Promise<FpsAutoActionResult> => ipcRenderer.invoke('fps:auto-install'),

  fpsAutoRemove: (): Promise<FpsAutoActionResult> => ipcRenderer.invoke('fps:auto-remove'),

  onFpsAutoUpdate: (callback: (status: FpsAutoStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: FpsAutoStatus): void =>
      callback(status)
    ipcRenderer.on('fps:auto-update', handler)
    return () => ipcRenderer.removeListener('fps:auto-update', handler)
  },

  // ── Sobreposição (HUD) ────────────────────────────
  // Tipos canônicos em `src/shared/hud.ts`.
  hudGet: (): Promise<HudStatus> => ipcRenderer.invoke('hud:get'),

  hudSetShortcut: (
    shortcut: string
  ): Promise<{ success: boolean; status: HudStatus; error?: string }> =>
    ipcRenderer.invoke('hud:set-shortcut', shortcut),

  hudSetVisible: (visible: boolean): Promise<HudStatus> =>
    ipcRenderer.invoke('hud:set-visible', visible),

  hudSetSize: (
    size: Partial<HudSize>
  ): Promise<{ success: boolean; status: HudStatus; error?: string }> =>
    ipcRenderer.invoke('hud:set-size', size),

  hudReportSize: (height: number): Promise<{ height: number }> =>
    ipcRenderer.invoke('hud:report-size', { height }),

  onHudStatus: (callback: (status: HudStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: HudStatus): void => callback(status)
    ipcRenderer.on('hud:status', handler)
    return () => ipcRenderer.removeListener('hud:status', handler)
  },

  hudToggle: (): Promise<HudStatus> => ipcRenderer.invoke('hud:toggle'),

  onHudUpdate: (callback: (update: HudUpdate) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, update: HudUpdate): void => callback(update)
    ipcRenderer.on('hud:update', handler)
    return () => ipcRenderer.removeListener('hud:update', handler)
  },

  // ── OpenOffice (sessões do OpenCode) ─────────────
  // O refcount do coletor vive no main: assinar liga o poller, desassinar para.
  officeSubscribe: (): Promise<OfficeSnapshot | null> => ipcRenderer.invoke('office:subscribe'),

  officeUnsubscribe: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('office:unsubscribe'),

  officeSnapshot: (): Promise<OfficeSnapshot | null> => ipcRenderer.invoke('office:snapshot'),

  officeStatus: (): Promise<OfficeHealth> => ipcRenderer.invoke('office:status'),

  onOfficeSnapshot: (callback: (snapshot: OfficeSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: OfficeSnapshot): void =>
      callback(snapshot)
    ipcRenderer.on('office:snapshot', handler)
    return () => ipcRenderer.removeListener('office:snapshot', handler)
  },

  // Ações (Fase 3). O main valida tudo e o modo é por execução; o texto da
  // mensagem só trafega aqui, nunca é logado.
  officeApprovePermission: (
    input: OfficeApprovePermissionInput
  ): Promise<OfficeActionEnqueueResult> => ipcRenderer.invoke('office:approve-permission', input),

  officeDenyPermission: (input: OfficeDenyPermissionInput): Promise<OfficeActionEnqueueResult> =>
    ipcRenderer.invoke('office:deny-permission', input),

  officeSendMessage: (input: OfficeSendMessageInput): Promise<OfficeActionEnqueueResult> =>
    ipcRenderer.invoke('office:send-message', input),

  officeSetActionMode: (input: OfficeActionModeInput): Promise<{ ok: boolean; enabled: boolean }> =>
    ipcRenderer.invoke('office:action-mode', input),

  onOfficeActionResult: (callback: (result: OfficeActionOutcome) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: OfficeActionOutcome): void =>
      callback(result)
    ipcRenderer.on('office:action-result', handler)
    return () => ipcRenderer.removeListener('office:action-result', handler)
  },

  // Instalador do plugin do OpenCode (T12). Qualquer escrita no config global
  // exige confirmação na UI; aqui só há transporte.
  officePluginStatus: (): Promise<PluginStatus> => ipcRenderer.invoke('office:plugin-status'),

  officePluginInstall: (): Promise<PluginInstallResult> =>
    ipcRenderer.invoke('office:plugin-install'),

  officePluginRemove: (): Promise<PluginRemoveResult> => ipcRenderer.invoke('office:plugin-remove'),

  officePluginSnippet: (): Promise<PluginSnippetResult> =>
    ipcRenderer.invoke('office:plugin-snippet'),

  // Funcionários (Fase 4): contratar, dar função e arquivar/restaurar. O main
  // valida tudo de novo; aqui é só transporte tipado.
  officeRosterOptions: (input: { directory: string }): Promise<OfficeRosterResult> =>
    ipcRenderer.invoke('office:roster-options', input),

  officeHire: (input: OfficeHireInput): Promise<OfficeManageResult> =>
    ipcRenderer.invoke('office:hire', input),

  officeSetRole: (input: OfficeSetRoleInput): Promise<OfficeManageResult> =>
    ipcRenderer.invoke('office:set-role', input),

  // Operação direta pelo CLI (não depende do plugin): prompt, parar e conversa.
  // O texto do prompt nunca é logado pelo main.
  officePrompt: (input: OfficePromptSendInput): Promise<OfficeManageResult> =>
    ipcRenderer.invoke('office:prompt', input),

  officeInterrupt: (input: { sessionID: string }): Promise<OfficeManageResult> =>
    ipcRenderer.invoke('office:interrupt', input),

  officeTranscript: (input: {
    sessionID: string
    limit?: number
  }): Promise<OfficeTranscriptResult> => ipcRenderer.invoke('office:transcript', input),

  officeSessionsList: (input: Record<string, never>): Promise<OfficeSessionsListResult> =>
    ipcRenderer.invoke('office:sessions-list', input),

  officeArchiveAll: (input: Record<string, never>): Promise<OfficeArchiveAllResult> =>
    ipcRenderer.invoke('office:archive-all', input),

  officeArchivedList: (input: Record<string, never>): Promise<OfficeArchivedListResult> =>
    ipcRenderer.invoke('office:archived-list', input),

  officeRestore: (input: { sessionID: string }): Promise<OfficeManageResult> =>
    ipcRenderer.invoke('office:restore', input),

  // Aparência e salas-departamento (OpenOffice isométrico). O main valida
  // sessão, ids `dep_…`, nome e índices de paleta; aqui é só transporte.
  officeAvatarGet: (input: { sessionID: string }): Promise<OfficeAvatarResult> =>
    ipcRenderer.invoke('office:avatar-get', input),

  officeAvatarSave: (input: {
    sessionID: string
    look: OfficeAvatarLook
  }): Promise<OfficeManageResult> => ipcRenderer.invoke('office:avatar-save', input),

  officeDepartmentCreate: (input: {
    name: string
    agentID: string
  }): Promise<OfficeDepartmentResult> => ipcRenderer.invoke('office:department-create', input),

  officeDepartmentUpdate: (input: {
    id: string
    name?: string
    agentID?: string
  }): Promise<OfficeDepartmentResult> => ipcRenderer.invoke('office:department-update', input),

  officeDepartmentDelete: (input: { id: string }): Promise<OfficeDepartmentDeleteResult> =>
    ipcRenderer.invoke('office:department-delete', input),

  officeDepartmentAssign: (input: {
    sessionID: string
    departmentID: string
    applyRole: boolean
  }): Promise<OfficeDepartmentApplyResult> => ipcRenderer.invoke('office:department-assign', input),

  officeDepartmentUnassign: (input: { sessionID: string }): Promise<OfficeManageResult> =>
    ipcRenderer.invoke('office:department-unassign', input),

  officeDepartmentApplyRole: (input: { id: string }): Promise<OfficeDepartmentApplyResult> =>
    ipcRenderer.invoke('office:department-apply-role', input),

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

  // Edição de jogos (T9)
  pickGameIcon: (): Promise<{
    success: boolean
    canceled?: boolean
    dataUrl?: string
    error?: string
  }> => ipcRenderer.invoke('games:pick-icon'),

  setGameIcon: (
    id: string,
    dataUrl: string
  ): Promise<{ success: boolean; iconPath?: string; error?: string }> =>
    ipcRenderer.invoke('games:set-icon', id, dataUrl),

  restoreGameIcon: (
    id: string,
    exePath?: string
  ): Promise<{ success: boolean; iconPath?: string; error?: string }> =>
    ipcRenderer.invoke('games:restore-exe-icon', id, exePath),

  previewGameIcon: (
    exePath: string
  ): Promise<{ success: boolean; dataUrl?: string; error?: string }> =>
    ipcRenderer.invoke('games:preview-exe-icon', exePath),

  checkGameExes: (exePaths: string[]): Promise<boolean[]> =>
    ipcRenderer.invoke('games:check-exes', exePaths),

  reloadGameIcons: (): Promise<{ checked: number; reloaded: number; failed: number }> =>
    ipcRenderer.invoke('games:reload-icons'),

  launchGame: (
    id: string
  ): Promise<{
    ok: boolean
    error?: string
    focused?: boolean
    alreadyRunning?: boolean
  }> => ipcRenderer.invoke('games:launch', id),

  stopGame: (id: string): Promise<{ ok: boolean; error?: string; killed?: number }> =>
    ipcRenderer.invoke('games:stop', id),

  getRunningGames: (ids: string[]): Promise<{ ok: boolean; running: Record<string, boolean> }> =>
    ipcRenderer.invoke('games:running-map', ids),

  getGameIcon: (id: string): Promise<string | null> => ipcRenderer.invoke('games:get-icon', id),

  addCustomGame: (
    exePath: string
  ): Promise<{
    success: boolean
    id?: string
    name?: string
    error?: string
  }> => ipcRenderer.invoke('games:add-custom', exePath),

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
    currentValue?: string,
    dialogTitle?: string
  ): Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('dialog:pick-path', mode, currentValue, dialogTitle),

  // ── Shell ───────────────────────────────────────
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:openPath', path),
  // Abre `%APPDATA%/kolnd-hub/logs` no Explorer (05-5.7) — sem argumentos.
  openLogsFolder: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:open-logs-folder'),

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
  },

  // ── Diagnóstico ─────────────────────────────────
  exportDiagnostic: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('diagnostic:export'),

  // ── Backup e restauração (07-7.6) ──────────────
  exportConfig: (): Promise<{
    success: boolean
    path?: string
    canceled?: boolean
    error?: string
  }> => ipcRenderer.invoke('config:export'),

  importConfigPreview: (): Promise<
    | {
        ok: true
        summary: { apps: number; games: number; sections: string[] }
        rejected: Array<{ section: string; error: string }>
      }
    | { ok: false; canceled: true }
    | { ok: false; errors: string[] }
  > => ipcRenderer.invoke('config:import', { mode: 'preview' }),

  importConfigApply: (): Promise<
    | {
        success: true
        applied: string[]
        failed: Array<{ section: string; error: string }>
        backupPath: string
      }
    | { success: false; error: string }
  > => ipcRenderer.invoke('config:import', { mode: 'apply' }),

  // ── Desinstalação (Kloud Games e Hub) ────────────────────────
  getKloudGamesUninstallStatus: (): Promise<{
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
  }> => ipcRenderer.invoke('uninstall:kloud-status'),

  uninstallKloudGames: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('uninstall:kloud-games'),

  uninstallKloudGamesOrphan: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('uninstall:kloud-orphan'),

  removeKloudGamesService: (): Promise<{
    success: boolean
    error?: string
    serviceStatus?: string
  }> => ipcRenderer.invoke('uninstall:remove-kloud-service'),

  getHubUninstallStatus: (): Promise<{
    available: boolean
    uninstallerPath: string | null
    isPackaged: boolean
  }> => ipcRenderer.invoke('uninstall:hub-status'),

  backupHubData: (): Promise<{ success: true; path: string } | { success: false; error: string }> =>
    ipcRenderer.invoke('uninstall:backup-data'),

  uninstallHub: (args: {
    wipeUserData?: boolean
    skipKloud?: boolean
    backupPath?: string | null
  }): Promise<{
    success: boolean
    paused?: boolean
    error?: string
    wipeErrors?: string[]
  }> => ipcRenderer.invoke('uninstall:hub', args),

  openHubLogsFolder: (): Promise<void> => ipcRenderer.invoke('uninstall:open-logs'),

  onUninstallProgress: (
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
    ipcRenderer.on('uninstall:progress', handler)
    return () => ipcRenderer.removeListener('uninstall:progress', handler)
  },

  onUninstallLog: (callback: (line: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: string): void => callback(line)
    ipcRenderer.on('uninstall:log', handler)
    return () => ipcRenderer.removeListener('uninstall:log', handler)
  },

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
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: {
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
      }
    ): void => callback(result)
    ipcRenderer.on('uninstall:complete', handler)
    return () => ipcRenderer.removeListener('uninstall:complete', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
