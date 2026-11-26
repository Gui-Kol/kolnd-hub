import type {
  AvatarApplyPush,
  AvatarSetLevelRequest,
  AvatarSetStateRequest,
  AvatarState
} from './avatar'
import type { OverlayLayout, OverlayPosition, StoreKey } from './config'
import type {
  ChatDeltaPush,
  ChatDonePush,
  ChatErrorPush,
  ChatUsagePayload,
  GeminiDiagnostics,
  GeminiStatusInfo,
  GeminiTestKeyOutcome,
  GeminiUsageWarningPush
} from './gemini'
import type { ThemeConfig } from './theme'
import type {
  PermissionCategory,
  PermissionDecision,
  PermissionCategories,
  PermissionsState
} from './permissions'
import type { Routine } from './routines'
import type {
  MemoryArchiveRecord,
  MemoryKind,
  MemoryMaintenanceEntry,
  MemoryRecord,
  MemorySort,
  MemoryStats
} from './memory'
import type {
  CaptureIndicatorPush,
  CaptureKind,
  CaptureRequestPush,
  CaptureSource,
  CaptureStatus,
  RegionSelection
} from './screen'
import type {
  VoiceAudioPush,
  VoiceSetConsentRequest,
  VoiceSetDeviceRequest,
  VoiceStatePush,
  VoiceStatus,
  VoiceTranscriptPush
} from './voice'

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
  themeChanged: 'theme:changed',
  geminiStatus: 'gemini:status',
  geminiSetKey: 'gemini:set-key',
  geminiClearKey: 'gemini:clear-key',
  geminiTestKey: 'gemini:test-key',
  geminiUsageWarning: 'gemini:usage-warning',
  chatSend: 'chat:send',
  chatCancel: 'chat:cancel',
  chatDelta: 'chat:delta',
  chatDone: 'chat:done',
  chatError: 'chat:error',
  voiceStart: 'voice:start',
  voiceStop: 'voice:stop',
  voiceToggle: 'voice:toggle',
  voiceStatus: 'voice:status',
  voiceInterrupt: 'voice:interrupt',
  voiceSetConsent: 'voice:set-consent',
  voiceSetDevice: 'voice:set-device',
  voiceAudioChunk: 'voice:audio-chunk',
  voiceBargeIn: 'voice:barge-in',
  voiceSilence: 'voice:silence',
  voiceState: 'voice:state',
  voiceAudio: 'voice:audio',
  voiceTranscript: 'voice:transcript',
  diagnosticsGemini: 'diagnostics:gemini',
  captureSources: 'capture:sources',
  captureAsk: 'capture:ask',
  captureRegion: 'capture:region',
  captureRegionResult: 'capture:region-result',
  captureCancel: 'capture:cancel',
  captureStatus: 'capture:status',
  captureRequest: 'capture:request',
  captureResult: 'capture:result',
  captureIndicator: 'capture:indicator',
  permissionsGet: 'permissions:get',
  permissionsSet: 'permissions:set',
  actionsPause: 'actions:pause',
  actionsStatus: 'actions:status',
  memoryList: 'memory:list',
  memorySearch: 'memory:search',
  memoryCreate: 'memory:create',
  memoryUpdate: 'memory:update',
  memoryRemove: 'memory:remove',
  memoryRemoveAll: 'memory:remove-all',
  memoryStats: 'memory:stats',
  memoryExport: 'memory:export',
  memoryImport: 'memory:import'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export const IPC_PREFIXES = [
  'app',
  'overlay',
  'avatar',
  'store',
  'settings',
  'theme',
  'gemini',
  'chat',
  'voice',
  'diagnostics',
  'capture',
  'permissions',
  'actions',
  'memory'
] as const

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

/** `gemini:set-key` recebe a chave só nesta direção; nunca volta. */
export interface GeminiSetKeyRequest {
  key: string
}

export type GeminiStatusResult = { ok: true; status: GeminiStatusInfo } | IpcError

export type GeminiTestKeyResult = { ok: true; result: GeminiTestKeyOutcome } | IpcError

export interface ChatSendRequest {
  requestId: string
  text: string
}

export interface ChatCancelRequest {
  requestId: string
}

export type VoiceStatusResult = { ok: true; status: VoiceStatus } | IpcError

export type DiagnosticsGeminiResult = { ok: true; diagnostics: GeminiDiagnostics } | IpcError

/** Estado de permissões por categoria (task 08). */
export type PermissionsGetResult = { ok: true; permissions: PermissionsState } | IpcError

export interface PermissionsSetRequest {
  category: PermissionCategory
  decision: PermissionDecision
}

export type ActionsPauseResult = { ok: true; paused: boolean } | IpcError

/** Limites de taxa expostos à UI/diagnóstico (task 08, T10). */
export interface ActionsLimits {
  appLaunchesPerMinute: number
  fileOpsPerRequest: number
  uiaActionsPerTwoSeconds: number
}

/** `actions:status`: pausa, permissões, rotinas e limites vigentes. */
export interface ActionsStatus {
  paused: boolean
  permissions: PermissionsState
  routines: Routine[]
  limits: ActionsLimits
}

export type ActionsStatusResult = { ok: true; status: ActionsStatus } | IpcError

/** Lista/busca de memórias (task 09). */
export interface MemoryListRequest {
  query?: string
  kind?: MemoryKind
  sort?: MemorySort
  offset?: number
  limit?: number
}

export type MemoryListResult =
  | {
      ok: true
      memories: MemoryRecord[]
      total: number
      hasMore: boolean
      /** MEMÓRIAS arquivadas, somente leitura na tela. */
      archived: MemoryArchiveRecord[]
      /** Últimas linhas do relatório de manutenção. */
      maintenance: MemoryMaintenanceEntry[]
    }
  | IpcError

export interface MemorySearchRequest {
  query: string
  limit?: number
}

export type MemorySearchResult = { ok: true; memories: MemoryRecord[] } | IpcError

export interface MemoryCreateRequest {
  kind: MemoryKind
  content: string
  tags?: string[]
  confidence?: number
  expiresAt?: number | null
  pinned?: boolean
}

export type MemoryCreateResult = { ok: true; memory: MemoryRecord } | IpcError

/** Patch aceito por `memory:update`; `id`/`createdAt` nunca são editáveis. */
export interface MemoryUpdatePatchRequest {
  kind?: MemoryKind
  content?: string
  tags?: string[]
  confidence?: number
  expiresAt?: number | null
  pinned?: boolean
}

export interface MemoryUpdateRequest {
  id: string
  patch: MemoryUpdatePatchRequest
}

export type MemoryUpdateResult = { ok: true; memory: MemoryRecord } | IpcError

export interface MemoryRemoveRequest {
  id: string
}

export type MemoryRemoveResult = { ok: true; removed: boolean } | IpcError

export interface MemoryRemoveAllRequest {
  confirm: string
  includeTurns?: boolean
}

export type MemoryRemoveAllResult =
  { ok: true; removed: number; turns: number; sessions: number } | IpcError

export type MemoryStatsResult = { ok: true; stats: MemoryStats } | IpcError

export interface MemoryExportRequest {
  includeTranscripts?: boolean
}

export type MemoryExportResult =
  | {
      ok: true
      canceled: boolean
      filePath?: string
      count?: number
      bytes?: number
      sessions?: number
    }
  | IpcError

export type MemoryImportResult =
  | {
      ok: true
      canceled: boolean
      imported?: number
      duplicates?: number
      invalid?: number
    }
  | IpcError

export type { MemoryKind, MemoryRecord, MemoryStats }
export type { PermissionCategory, PermissionDecision, PermissionCategories, PermissionsState }

/** `capture:ask`: captura + envio multimodal, com streaming em `chat:*`. */
export interface CaptureAskRequest {
  requestId: string
  kind: CaptureKind
  question: string
  displayId?: string
  region?: RegionSelection
  proactive?: boolean
}

/** `capture:cancel`: Cancela a seleção de região e/ou a resposta em curso. */
export interface CaptureCancelRequest {
  requestId?: string
  kind?: 'region' | 'ask'
}

/**
 * `capture:result` (renderer -> main): frame capturado. `data` é o ArrayBuffer
 * codificado; nunca é persistido.
 */
export interface CaptureFrameResultRequest {
  requestId: string
  ok: boolean
  mime?: 'image/jpeg' | 'image/png'
  data?: ArrayBuffer
  width?: number
  height?: number
  error?: string
}

export type CaptureSourcesResult =
  { ok: true; screens: CaptureSource[]; windows: CaptureSource[] } | IpcError

export type CaptureStatusResult = { ok: true; status: CaptureStatus } | IpcError

export type CaptureRegionResult =
  { ok: true; canceled: boolean; selection: RegionSelection | null } | IpcError

export type { ChatDeltaPush, ChatDonePush, ChatErrorPush, ChatUsagePayload, GeminiUsageWarningPush }
export type {
  CaptureIndicatorPush,
  CaptureRequestPush,
  CaptureStatus,
  CaptureSource,
  CaptureKind
} from './screen'
export type {
  VoiceAudioPush,
  VoiceSetConsentRequest,
  VoiceSetDeviceRequest,
  VoiceStatePush,
  VoiceStatus,
  VoiceTranscriptPush
}

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
  [IPC.geminiStatus]: { request: undefined; response: GeminiStatusResult }
  [IPC.geminiSetKey]: { request: GeminiSetKeyRequest; response: SimpleResult }
  [IPC.geminiClearKey]: { request: undefined; response: SimpleResult }
  [IPC.geminiTestKey]: { request: undefined; response: GeminiTestKeyResult }
  [IPC.geminiUsageWarning]: { request: undefined; response: GeminiUsageWarningPush }
  [IPC.chatSend]: { request: ChatSendRequest; response: SimpleResult }
  [IPC.chatCancel]: { request: ChatCancelRequest; response: SimpleResult }
  [IPC.chatDelta]: { request: undefined; response: ChatDeltaPush }
  [IPC.chatDone]: { request: undefined; response: ChatDonePush }
  [IPC.chatError]: { request: undefined; response: ChatErrorPush }
  [IPC.voiceStart]: { request: undefined; response: VoiceStatusResult }
  [IPC.voiceStop]: { request: undefined; response: VoiceStatusResult }
  [IPC.voiceToggle]: { request: undefined; response: VoiceStatusResult }
  [IPC.voiceStatus]: { request: undefined; response: VoiceStatusResult }
  [IPC.voiceInterrupt]: { request: undefined; response: VoiceStatusResult }
  [IPC.voiceSetConsent]: { request: VoiceSetConsentRequest; response: VoiceStatusResult }
  [IPC.voiceSetDevice]: { request: VoiceSetDeviceRequest; response: VoiceStatusResult }
  [IPC.voiceAudioChunk]: { request: Uint8Array; response: never }
  [IPC.voiceBargeIn]: { request: undefined; response: never }
  [IPC.voiceSilence]: { request: undefined; response: never }
  [IPC.voiceState]: { request: undefined; response: VoiceStatePush }
  [IPC.voiceAudio]: { request: undefined; response: VoiceAudioPush }
  [IPC.voiceTranscript]: { request: undefined; response: VoiceTranscriptPush }
  [IPC.diagnosticsGemini]: { request: undefined; response: DiagnosticsGeminiResult }
  [IPC.captureSources]: { request: undefined; response: CaptureSourcesResult }
  [IPC.captureAsk]: { request: CaptureAskRequest; response: SimpleResult }
  [IPC.captureRegion]: { request: undefined; response: CaptureRegionResult }
  [IPC.captureRegionResult]: { request: RegionSelection; response: never }
  [IPC.captureCancel]: { request: CaptureCancelRequest; response: SimpleResult }
  [IPC.captureStatus]: { request: undefined; response: CaptureStatusResult }
  [IPC.captureRequest]: { request: undefined; response: CaptureRequestPush }
  [IPC.captureResult]: { request: CaptureFrameResultRequest; response: SimpleResult }
  [IPC.captureIndicator]: { request: undefined; response: CaptureIndicatorPush }
  [IPC.permissionsGet]: { request: undefined; response: PermissionsGetResult }
  [IPC.permissionsSet]: { request: PermissionsSetRequest; response: SimpleResult }
  [IPC.actionsPause]: { request: { paused: boolean }; response: ActionsPauseResult }
  [IPC.actionsStatus]: { request: undefined; response: ActionsStatusResult }
  [IPC.memoryList]: { request: MemoryListRequest | undefined; response: MemoryListResult }
  [IPC.memorySearch]: { request: MemorySearchRequest; response: MemorySearchResult }
  [IPC.memoryCreate]: { request: MemoryCreateRequest; response: MemoryCreateResult }
  [IPC.memoryUpdate]: { request: MemoryUpdateRequest; response: MemoryUpdateResult }
  [IPC.memoryRemove]: { request: MemoryRemoveRequest; response: MemoryRemoveResult }
  [IPC.memoryRemoveAll]: { request: MemoryRemoveAllRequest; response: MemoryRemoveAllResult }
  [IPC.memoryStats]: { request: undefined; response: MemoryStatsResult }
  [IPC.memoryExport]: { request: MemoryExportRequest | undefined; response: MemoryExportResult }
  [IPC.memoryImport]: { request: undefined; response: MemoryImportResult }
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
  gemini: {
    status: () => Promise<GeminiStatusResult>
    setKey: (key: string) => Promise<SimpleResult>
    clearKey: () => Promise<SimpleResult>
    testKey: () => Promise<GeminiTestKeyResult>
    onUsageWarning: (listener: (warning: GeminiUsageWarningPush) => void) => () => void
  }
  chat: {
    send: (requestId: string, text: string) => Promise<SimpleResult>
    cancel: (requestId: string) => Promise<SimpleResult>
    onDelta: (listener: (push: ChatDeltaPush) => void) => () => void
    onDone: (listener: (push: ChatDonePush) => void) => () => void
    onError: (listener: (push: ChatErrorPush) => void) => () => void
  }
  voice: {
    start: () => Promise<VoiceStatusResult>
    stop: () => Promise<VoiceStatusResult>
    toggle: () => Promise<VoiceStatusResult>
    status: () => Promise<VoiceStatusResult>
    interrupt: () => Promise<VoiceStatusResult>
    setConsent: (granted: boolean) => Promise<VoiceStatusResult>
    setDevice: (request: VoiceSetDeviceRequest) => Promise<VoiceStatusResult>
    /** Envia PCM16 16 kHz sem esperar resposta (nunca `invoke`). */
    sendAudioChunk: (data: Uint8Array) => void
    sendBargeIn: () => void
    sendSilence: () => void
    onState: (listener: (push: VoiceStatePush) => void) => () => void
    onAudio: (listener: (push: VoiceAudioPush) => void) => () => void
    onTranscript: (listener: (push: VoiceTranscriptPush) => void) => () => void
  }
  diagnostics: {
    gemini: () => Promise<DiagnosticsGeminiResult>
  }
  permissions: {
    get: () => Promise<PermissionsGetResult>
    set: (request: PermissionsSetRequest) => Promise<SimpleResult>
  }
  actions: {
    pause: (paused: boolean) => Promise<ActionsPauseResult>
    status: () => Promise<ActionsStatusResult>
  }
  memory: {
    list: (request?: MemoryListRequest) => Promise<MemoryListResult>
    search: (request: MemorySearchRequest) => Promise<MemorySearchResult>
    create: (request: MemoryCreateRequest) => Promise<MemoryCreateResult>
    update: (request: MemoryUpdateRequest) => Promise<MemoryUpdateResult>
    remove: (request: MemoryRemoveRequest) => Promise<MemoryRemoveResult>
    removeAll: (request: MemoryRemoveAllRequest) => Promise<MemoryRemoveAllResult>
    stats: () => Promise<MemoryStatsResult>
    export: (request?: MemoryExportRequest) => Promise<MemoryExportResult>
    import: () => Promise<MemoryImportResult>
  }
  capture: {
    /** Lista telas/janelas com thumbnails 320x180 para escolha. */
    sources: () => Promise<CaptureSourcesResult>
    /** Captura + pergunta; a resposta chega pelos pushes de `chat:*`. */
    ask: (request: CaptureAskRequest) => Promise<SimpleResult>
    /** Abre a seleção de região; `canceled` quando Esc/fechamento. */
    region: () => Promise<CaptureRegionResult>
    cancel: (request?: CaptureCancelRequest) => Promise<SimpleResult>
    status: () => Promise<CaptureStatusResult>
    /** Resposta do overlay para `capture:request` (nunca grava em disco). */
    sendFrame: (result: CaptureFrameResultRequest) => Promise<SimpleResult>
    /** Resultado da janela de região (canal interno, sem resposta). */
    submitRegion: (selection: RegionSelection) => void
    onRequest: (listener: (push: CaptureRequestPush) => void) => () => void
    onIndicator: (listener: (push: CaptureIndicatorPush) => void) => () => void
  }
}
