import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AbsolemApi, type OverlayStatus } from '../shared/ipc'
import type { OverlaySetLayoutRequest } from '../shared/ipc'
import type { AvatarApplyPush, AvatarState } from '../shared/avatar'
import type { StoreKey } from '../shared/config'
import type { ThemeConfig } from '../shared/theme'
import type {
  SettingsSection,
  ChatDeltaPush,
  ChatDonePush,
  ChatErrorPush,
  PermissionsSetRequest,
  MemoryListRequest,
  MemorySearchRequest,
  MemoryCreateRequest,
  MemoryUpdateRequest,
  MemoryRemoveRequest,
  MemoryRemoveAllRequest,
  MemoryExportRequest
} from '../shared/ipc'
import type {
  CaptureAskRequest,
  CaptureCancelRequest,
  CaptureFrameResultRequest,
  CaptureIndicatorPush,
  CaptureRequestPush
} from '../shared/ipc'
import type { RegionSelection } from '../shared/screen'
import type { GeminiUsageWarningPush } from '../shared/gemini'
import type { SearchIndicatorPush } from '../shared/search'
import type {
  VoiceAudioPush,
  VoiceSetDeviceRequest,
  VoiceStatePush,
  VoiceTranscriptPush
} from '../shared/voice'

/**
 * Ponte fina: cada método só repassa o payload para `ipcRenderer.invoke`.
 * Nenhum `event` cruza a fronteira e nenhuma lógica de negócio vive aqui.
 */

/**
 * Assinatura com remoção idempotente: um segundo unmount não mexe na lista do
 * Electron e o handler original é sempre o mesmo par `on`/`removeListener`.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  let active = true
  return () => {
    if (!active) return
    active = false
    ipcRenderer.removeListener(channel, handler)
  }
}

const absolem: AbsolemApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appGetInfo),
  quit: () => ipcRenderer.invoke(IPC.appQuit),
  relaunch: () => ipcRenderer.invoke(IPC.appRelaunch),

  getAutostart: () => ipcRenderer.invoke(IPC.appGetAutostart),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke(IPC.appSetAutostart, { enabled }),
  openFolder: (target) => ipcRenderer.invoke(IPC.appOpenFolder, { target }),

  overlayShow: () => ipcRenderer.invoke(IPC.overlayShow),
  overlayHide: () => ipcRenderer.invoke(IPC.overlayHide),
  overlayToggle: () => ipcRenderer.invoke(IPC.overlayToggle),
  overlayStatus: () => ipcRenderer.invoke(IPC.overlayStatus),
  overlaySetLayout: (layout: OverlaySetLayoutRequest) =>
    ipcRenderer.invoke(IPC.overlaySetLayout, layout),
  overlaySetInteractive: (interactive: boolean) =>
    ipcRenderer.invoke(IPC.overlaySetInteractive, { interactive }),
  overlaySetInputMode: (active: boolean) => ipcRenderer.invoke(IPC.overlaySetInputMode, { active }),
  overlaySetShortcut: (shortcut: string) =>
    ipcRenderer.invoke(IPC.overlaySetShortcut, { shortcut }),
  onOverlayStatusChanged: (listener: (status: OverlayStatus) => void) =>
    subscribe<OverlayStatus>(IPC.overlayStatusChanged, listener),

  avatar: {
    setState: (state: AvatarState) => ipcRenderer.invoke(IPC.avatarSetState, { state }),
    setLevel: (level: number) => ipcRenderer.invoke(IPC.avatarSetLevel, { level }),
    getStatus: () => ipcRenderer.invoke(IPC.avatarGetStatus),
    onApply: (listener: (payload: AvatarApplyPush) => void) =>
      subscribe<AvatarApplyPush>(IPC.avatarApply, listener)
  },

  storeGet: (key: StoreKey) => ipcRenderer.invoke(IPC.storeGet, { key }),
  storeSet: (key: StoreKey, value: unknown) => ipcRenderer.invoke(IPC.storeSet, { key, value }),

  openSettings: (section?: SettingsSection) =>
    ipcRenderer.invoke(IPC.settingsOpen, section === undefined ? {} : { section }),

  themeGet: () => ipcRenderer.invoke(IPC.themeGet),
  themeSet: (theme: Partial<ThemeConfig>, options?: { persist?: boolean }) =>
    ipcRenderer.invoke(IPC.themeSet, {
      theme,
      ...(options?.persist === undefined ? {} : { persist: options.persist })
    }),
  themeExport: () => ipcRenderer.invoke(IPC.themeExport),
  themeImport: () => ipcRenderer.invoke(IPC.themeImport),
  onThemeChanged: (listener: (theme: ThemeConfig) => void) =>
    subscribe<ThemeConfig>(IPC.themeChanged, listener),

  gemini: {
    status: () => ipcRenderer.invoke(IPC.geminiStatus),
    setKey: (key: string) => ipcRenderer.invoke(IPC.geminiSetKey, { key }),
    clearKey: () => ipcRenderer.invoke(IPC.geminiClearKey),
    testKey: () => ipcRenderer.invoke(IPC.geminiTestKey),
    onUsageWarning: (listener: (warning: GeminiUsageWarningPush) => void) =>
      subscribe<GeminiUsageWarningPush>(IPC.geminiUsageWarning, listener)
  },

  chat: {
    send: (requestId: string, text: string) =>
      ipcRenderer.invoke(IPC.chatSend, { requestId, text }),
    cancel: (requestId: string) => ipcRenderer.invoke(IPC.chatCancel, { requestId }),
    onDelta: (listener: (push: ChatDeltaPush) => void) =>
      subscribe<ChatDeltaPush>(IPC.chatDelta, listener),
    onDone: (listener: (push: ChatDonePush) => void) =>
      subscribe<ChatDonePush>(IPC.chatDone, listener),
    onError: (listener: (push: ChatErrorPush) => void) =>
      subscribe<ChatErrorPush>(IPC.chatError, listener)
  },

  diagnostics: {
    gemini: () => ipcRenderer.invoke(IPC.diagnosticsGemini),
    overlay: () => ipcRenderer.invoke(IPC.diagnosticsOverlay),
    export: () => ipcRenderer.invoke(IPC.diagnosticsExport)
  },

  history: {
    list: (request) => ipcRenderer.invoke(IPC.historyList, request === undefined ? {} : request)
  },

  permissions: {
    get: () => ipcRenderer.invoke(IPC.permissionsGet),
    set: (request: PermissionsSetRequest) => ipcRenderer.invoke(IPC.permissionsSet, request)
  },

  actions: {
    pause: (paused: boolean) => ipcRenderer.invoke(IPC.actionsPause, { paused }),
    status: () => ipcRenderer.invoke(IPC.actionsStatus)
  },

  memory: {
    list: (request?: MemoryListRequest) =>
      ipcRenderer.invoke(IPC.memoryList, request === undefined ? {} : request),
    search: (request: MemorySearchRequest) => ipcRenderer.invoke(IPC.memorySearch, request),
    create: (request: MemoryCreateRequest) => ipcRenderer.invoke(IPC.memoryCreate, request),
    update: (request: MemoryUpdateRequest) => ipcRenderer.invoke(IPC.memoryUpdate, request),
    remove: (request: MemoryRemoveRequest) => ipcRenderer.invoke(IPC.memoryRemove, request),
    removeAll: (request: MemoryRemoveAllRequest) =>
      ipcRenderer.invoke(IPC.memoryRemoveAll, request),
    stats: () => ipcRenderer.invoke(IPC.memoryStats),
    export: (request?: MemoryExportRequest) =>
      ipcRenderer.invoke(IPC.memoryExport, request === undefined ? {} : request),
    import: () => ipcRenderer.invoke(IPC.memoryImport)
  },

  capture: {
    sources: () => ipcRenderer.invoke(IPC.captureSources),
    ask: (request: CaptureAskRequest) => ipcRenderer.invoke(IPC.captureAsk, request),
    region: () => ipcRenderer.invoke(IPC.captureRegion),
    cancel: (request?: CaptureCancelRequest) =>
      ipcRenderer.invoke(IPC.captureCancel, request === undefined ? {} : request),
    status: () => ipcRenderer.invoke(IPC.captureStatus),
    sendFrame: (result: CaptureFrameResultRequest) => ipcRenderer.invoke(IPC.captureResult, result),
    submitRegion: (selection: RegionSelection) => {
      ipcRenderer.send(IPC.captureRegionResult, selection)
    },
    onRequest: (listener: (push: CaptureRequestPush) => void) =>
      subscribe<CaptureRequestPush>(IPC.captureRequest, listener),
    onIndicator: (listener: (push: CaptureIndicatorPush) => void) =>
      subscribe<CaptureIndicatorPush>(IPC.captureIndicator, listener)
  },

  search: {
    status: () => ipcRenderer.invoke(IPC.searchStatus),
    openUrl: (url: string) => ipcRenderer.invoke(IPC.searchOpenUrl, { url }),
    clearCache: () => ipcRenderer.invoke(IPC.searchClearCache),
    onIndicator: (listener: (push: SearchIndicatorPush) => void) =>
      subscribe<SearchIndicatorPush>(IPC.searchIndicator, listener)
  },

  voice: {
    start: () => ipcRenderer.invoke(IPC.voiceStart),
    stop: () => ipcRenderer.invoke(IPC.voiceStop),
    toggle: () => ipcRenderer.invoke(IPC.voiceToggle),
    status: () => ipcRenderer.invoke(IPC.voiceStatus),
    interrupt: () => ipcRenderer.invoke(IPC.voiceInterrupt),
    setConsent: (granted: boolean) => ipcRenderer.invoke(IPC.voiceSetConsent, { granted }),
    setDevice: (request: VoiceSetDeviceRequest) => ipcRenderer.invoke(IPC.voiceSetDevice, request),
    // Caminho de áudio: `send` não cria promise nem espera o main. O bloco
    // chega como Uint8Array (structured clone), sem cópia extra no renderer.
    sendAudioChunk: (data: Uint8Array) => ipcRenderer.send(IPC.voiceAudioChunk, data),
    sendBargeIn: () => ipcRenderer.send(IPC.voiceBargeIn),
    sendSilence: () => ipcRenderer.send(IPC.voiceSilence),
    onState: (listener: (push: VoiceStatePush) => void) =>
      subscribe<VoiceStatePush>(IPC.voiceState, listener),
    onAudio: (listener: (push: VoiceAudioPush) => void) =>
      subscribe<VoiceAudioPush>(IPC.voiceAudio, listener),
    onTranscript: (listener: (push: VoiceTranscriptPush) => void) =>
      subscribe<VoiceTranscriptPush>(IPC.voiceTranscript, listener)
  }
}

contextBridge.exposeInMainWorld('absolem', absolem)
