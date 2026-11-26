import type {
  AvatarApplyPush,
  AvatarSetLevelRequest,
  AvatarSetStateRequest,
  AvatarState
} from './avatar'
import type { OverlayLayout, OverlayPosition, StoreKey } from './config'
import type { ThemeConfig } from './theme'

/**
 * Contrato IPC do Absolem.
 *
 * Regras:
 * - Um canal por operação, nomeado `<prefixo>:<ação>`.
 * - O preload faz `ipcRenderer.invoke` para consultas/ações e `ipcRenderer.on`
 *   apenas para o push `overlay:status-changed`; o `event` nunca cruza a ponte.
 * - O main recebe `unknown` e valida; falha sempre vira `{ ok: false, error }`.
 */
export const IPC = {
  appGetInfo: 'app:get-info',
  appQuit: 'app:quit',
  appGetAutostart: 'app:get-autostart',
  appSetAutostart: 'app:set-autostart',
  overlayShow: 'overlay:show',
  overlayHide: 'overlay:hide',
  overlayToggle: 'overlay:toggle',
  overlayStatus: 'overlay:status',
  overlaySetLayout: 'overlay:set-layout',
  overlaySetInteractive: 'overlay:set-interactive',
  overlayStatusChanged: 'overlay:status-changed',
  avatarSetState: 'avatar:set-state',
  avatarSetLevel: 'avatar:set-level',
  avatarGetStatus: 'avatar:get-status',
  avatarApply: 'avatar:apply',
  storeGet: 'store:get',
  storeSet: 'store:set',
  settingsOpen: 'settings:open',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  themeExport: 'theme:export',
  themeImport: 'theme:import',
  themeChanged: 'theme:changed'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export const IPC_PREFIXES = ['app', 'overlay', 'avatar', 'store', 'settings', 'theme'] as const

export type IpcPrefix = (typeof IPC_PREFIXES)[number]

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface IpcError {
  ok: false
  error: string
}

export type SimpleResult = { ok: true } | IpcError

export type AppInfoResult = { ok: true; info: AppInfo } | IpcError

/** Estado do autostart por usuário: o SO é a fonte da verdade de `enabled`. */
export interface AutostartState {
  enabled: boolean
  supported: boolean
}

export interface AutostartSetRequest {
  enabled: boolean
}

export type AutostartGetResult = { ok: true; state: AutostartState } | IpcError

/** Estado do atalho global no momento (conflito vira `registered:false`). */
export interface OverlayShortcutStatus {
  registered: boolean
  accelerator: string
}

/** Estado/nível atuais do avatar no main. */
export type AvatarGetStatusResult = { ok: true; state: AvatarState; level: number } | IpcError

/** Status devolvido por todos os canais do overlay. */
export interface OverlayStatus {
  visible: boolean
  interactive: boolean
  /** Oculto automaticamente por tela cheia (não por ação do usuário). */
  autoHidden: boolean
  layout: OverlayLayout
  shortcut: OverlayShortcutStatus
  hideOnFullscreen: boolean
}

export type OverlayStatusResult = { ok: true; status: OverlayStatus } | IpcError

/** Patch de layout: campos ausentes mantêm o valor vigente. */
export interface OverlaySetLayoutRequest {
  position?: OverlayPosition
  offsetX?: number
  offsetY?: number
  width?: number
  height?: number
}

export interface OverlaySetInteractiveRequest {
  interactive: boolean
}

export interface StoreGetRequest {
  key: StoreKey
}

export interface StoreSetRequest {
  key: StoreKey
  value: unknown
}

export type StoreGetResult = { ok: true; key: StoreKey; value: unknown } | IpcError

export const SETTINGS_SECTIONS = ['theme', 'voice', 'permissions', 'memory'] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export interface SettingsOpenRequest {
  section?: SettingsSection
}

export interface ThemeSetRequest {
  theme: Partial<ThemeConfig>
  /**
   * `false` atualiza o overlay sem gravar no disco (debounce da UI); omitido ou
   * `true` persiste (throttle da UI e chamadas diretas).
   */
  persist?: boolean
}

export type ThemeGetResult = { ok: true; theme: ThemeConfig } | IpcError

export type ThemeExportResult = { ok: true; canceled: boolean; filePath?: string } | IpcError

export type ThemeImportResult =
  { ok: true; canceled: boolean; theme?: ThemeConfig; warnings: string[] } | IpcError

/**
 * Mapa canal → request/response. Mantém o preload e os handlers alinhados:
 * uma mudança de payload vira erro de compilação nos dois lados.
 */
export interface IpcContract {
  [IPC.appGetInfo]: { request: undefined; response: AppInfoResult }
  [IPC.appQuit]: { request: undefined; response: SimpleResult }
  [IPC.appGetAutostart]: { request: undefined; response: AutostartGetResult }
  [IPC.appSetAutostart]: { request: AutostartSetRequest; response: SimpleResult }
  [IPC.overlayShow]: { request: undefined; response: OverlayStatusResult }
  [IPC.overlayHide]: { request: undefined; response: OverlayStatusResult }
  [IPC.overlayToggle]: { request: undefined; response: OverlayStatusResult }
  [IPC.overlayStatus]: { request: undefined; response: OverlayStatusResult }
  [IPC.overlaySetLayout]: { request: OverlaySetLayoutRequest; response: OverlayStatusResult }
  [IPC.overlaySetInteractive]: {
    request: OverlaySetInteractiveRequest
    response: OverlayStatusResult
  }
  [IPC.overlayStatusChanged]: { request: undefined; response: OverlayStatus }
  [IPC.avatarSetState]: { request: AvatarSetStateRequest; response: SimpleResult }
  [IPC.avatarSetLevel]: { request: AvatarSetLevelRequest; response: SimpleResult }
  [IPC.avatarGetStatus]: { request: undefined; response: AvatarGetStatusResult }
  [IPC.avatarApply]: { request: undefined; response: AvatarApplyPush }
  [IPC.storeGet]: { request: StoreGetRequest; response: StoreGetResult }
  [IPC.storeSet]: { request: StoreSetRequest; response: SimpleResult }
  [IPC.settingsOpen]: { request: SettingsOpenRequest; response: SimpleResult }
  [IPC.themeGet]: { request: undefined; response: ThemeGetResult }
  [IPC.themeSet]: { request: ThemeSetRequest; response: SimpleResult }
  [IPC.themeExport]: { request: undefined; response: ThemeExportResult }
  [IPC.themeImport]: { request: undefined; response: ThemeImportResult }
  [IPC.themeChanged]: { request: undefined; response: ThemeConfig }
}

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']

export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']

/**
 * Superfície exposta em `window.absolem`. Declarada aqui para o preload e o
 * `index.d.ts` usarem exatamente o mesmo tipo.
 */
export interface AbsolemApi {
  getAppInfo: () => Promise<AppInfoResult>
  quit: () => Promise<SimpleResult>
  getAutostart: () => Promise<AutostartGetResult>
  setAutostart: (enabled: boolean) => Promise<SimpleResult>
  overlayShow: () => Promise<OverlayStatusResult>
  overlayHide: () => Promise<OverlayStatusResult>
  overlayToggle: () => Promise<OverlayStatusResult>
  overlayStatus: () => Promise<OverlayStatusResult>
  overlaySetLayout: (layout: OverlaySetLayoutRequest) => Promise<OverlayStatusResult>
  overlaySetInteractive: (interactive: boolean) => Promise<OverlayStatusResult>
  onOverlayStatusChanged: (listener: (status: OverlayStatus) => void) => () => void
  avatar: {
    setState: (state: AvatarState) => Promise<SimpleResult>
    setLevel: (level: number) => Promise<SimpleResult>
    getStatus: () => Promise<AvatarGetStatusResult>
    onApply: (listener: (payload: AvatarApplyPush) => void) => () => void
  }
  storeGet: (key: StoreKey) => Promise<StoreGetResult>
  storeSet: (key: StoreKey, value: unknown) => Promise<SimpleResult>
  openSettings: (section?: SettingsSection) => Promise<SimpleResult>
  themeGet: () => Promise<ThemeGetResult>
  themeSet: (theme: Partial<ThemeConfig>, options?: { persist?: boolean }) => Promise<SimpleResult>
  themeExport: () => Promise<ThemeExportResult>
  themeImport: () => Promise<ThemeImportResult>
  onThemeChanged: (listener: (theme: ThemeConfig) => void) => () => void
}
