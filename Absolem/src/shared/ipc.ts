import type { StoreKey, ThemeConfig } from './config'

/**
 * Contrato IPC do Absolem.
 *
 * Regras:
 * - Um canal por operação, nomeado `<prefixo>:<ação>`.
 * - O preload só faz `ipcRenderer.invoke`; o `event` nunca cruza a ponte.
 * - O main recebe `unknown` e valida; falha sempre vira `{ ok: false, error }`.
 *
 * Nesta task (00) apenas os canais de `app` têm handler. Os demais estão
 * declarados para as tasks 01, 02, 05 e 11 e não executam nada ainda.
 */
export const IPC = {
  appGetInfo: 'app:get-info',
  appQuit: 'app:quit',
  appGetAutostart: 'app:get-autostart',
  appSetAutostart: 'app:set-autostart',
  overlayShow: 'overlay:show',
  overlayHide: 'overlay:hide',
  overlayToggle: 'overlay:toggle',
  storeGet: 'store:get',
  storeSet: 'store:set',
  settingsOpen: 'settings:open',
  themeGet: 'theme:get',
  themeSet: 'theme:set'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export const IPC_PREFIXES = ['app', 'overlay', 'store', 'settings', 'theme'] as const

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
}

export type ThemeGetResult = { ok: true; theme: ThemeConfig } | IpcError

/**
 * Mapa canal → request/response. Mantém o preload e os handlers alinhados:
 * uma mudança de payload vira erro de compilação nos dois lados.
 */
export interface IpcContract {
  [IPC.appGetInfo]: { request: undefined; response: AppInfoResult }
  [IPC.appQuit]: { request: undefined; response: SimpleResult }
  [IPC.appGetAutostart]: { request: undefined; response: AutostartGetResult }
  [IPC.appSetAutostart]: { request: AutostartSetRequest; response: SimpleResult }
  [IPC.overlayShow]: { request: undefined; response: SimpleResult }
  [IPC.overlayHide]: { request: undefined; response: SimpleResult }
  [IPC.overlayToggle]: { request: undefined; response: SimpleResult }
  [IPC.storeGet]: { request: StoreGetRequest; response: StoreGetResult }
  [IPC.storeSet]: { request: StoreSetRequest; response: SimpleResult }
  [IPC.settingsOpen]: { request: SettingsOpenRequest; response: SimpleResult }
  [IPC.themeGet]: { request: undefined; response: ThemeGetResult }
  [IPC.themeSet]: { request: ThemeSetRequest; response: SimpleResult }
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
  overlayShow: () => Promise<SimpleResult>
  overlayHide: () => Promise<SimpleResult>
  overlayToggle: () => Promise<SimpleResult>
  storeGet: (key: StoreKey) => Promise<StoreGetResult>
  storeSet: (key: StoreKey, value: unknown) => Promise<SimpleResult>
  openSettings: (section?: SettingsSection) => Promise<SimpleResult>
  themeGet: () => Promise<ThemeGetResult>
  themeSet: (theme: Partial<ThemeConfig>) => Promise<SimpleResult>
}
