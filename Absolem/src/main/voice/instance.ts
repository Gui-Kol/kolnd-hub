import { dialog, session } from 'electron'
import type { BrowserWindow } from 'electron'
import { buildSystemPrompt } from '../gemini/prompts'
import { createChatHistory } from '../gemini/history'
import { SdkLiveTransport } from '../gemini/sdk'
import { LiveSession } from '../gemini/live'
import { getUsageMeter } from '../gemini/instance'
import { applyAvatarState } from '../ipc/avatar'
import type { IpcContext } from '../ipc/lifecycle'
import { registerVoiceIpc } from '../ipc/voice'
import { logger } from '../logger'
import { registerMediaPermissions } from '../permissions'
import { getApiKey } from '../secrets'
import { getPersistentStore, getStoreSnapshot, setStoreValue } from '../store'
import { getMemoryBlock, getMemoryRuntime } from '../memory/instance'
import { registerShutdownHook } from '../shutdown'
import { showOverlay as showOverlayWindow } from '../overlay/controller'
import { getActionsRuntime } from '../actions/instance'
import { getSearchRuntime } from '../search/instance'
import { WEB_SYSTEM_RULES } from '../search/injection'
import { IPC } from '../../shared/ipc'
import type { VoiceAudioPush, VoiceStateChange, VoiceTranscriptPush } from '../../shared/voice'
import { VOICE_DEFAULT_SHORTCUT, LIVE_VOICE_NAME } from '../../shared/voice'
import { isMicrophoneGranted, setMicrophoneConsent } from './consent'
import { VoiceController } from './controller'
import {
  createGreetingController,
  GREETING_SYSTEM_INSTRUCTION,
  shouldSkipGreeting
} from './greeting'
import { onOverlayHidden, onOverlayShown } from './overlayEvents'
import { registerVoiceShortcut } from './shortcut'

/**
 * Composição de produção da voz.
 *
 * Só este arquivo liga o controlador ao Electron (session/dialog), ao SDK Live,
 * ao store, ao medidor de custo e aos pushes IPC. Os testes montam o
 * controlador com fakes e nunca chegam aqui.
 */

const consentStore = {
  read: () => getStoreSnapshot().permissions,
  write: (next: ReturnType<typeof getStoreSnapshot>['permissions']) =>
    setStoreValue('permissions', next)
}

function broadcast(ctx: IpcContext, channel: string, payload: unknown): void {
  const targets = [ctx.getOverlayWindow(), ctx.getMainWindow()]
  for (let index = 0; index < targets.length; index += 1) {
    const window = targets[index]
    if (!window || window.isDestroyed()) continue
    if (index === 1 && targets[0] === window) continue
    try {
      window.webContents.send(channel, payload)
    } catch {
      // Janela fechando entre a checagem e o envio.
    }
  }
}

async function askMicrophoneConsent(ctx: IpcContext): Promise<boolean> {
  const overlay = ctx.getOverlayWindow()
  const options = {
    type: 'question' as const,
    buttons: ['Permitir microfone', 'Agora não'],
    defaultId: 1,
    cancelId: 1,
    title: 'Microfone do Absolem',
    message: 'Permitir que o Absolem use o microfone?',
    detail:
      'O áudio é enviado ao Gemini em tempo real para a conversa por voz. ' +
      'Nada é gravado em disco. Você pode desligar o microfone no avatar ou nas ' +
      'configurações a qualquer momento. Negar mantém o uso por texto.'
  }
  let response: number
  try {
    const result =
      overlay && !overlay.isDestroyed()
        ? await dialog.showMessageBox(overlay, options)
        : await dialog.showMessageBox(options)
    response = result.response
  } catch (err) {
    logger.warn('voice', 'falha ao mostrar o diálogo de consentimento', err)
    return false
  }
  const granted = response === 0
  const persisted = setMicrophoneConsent(consentStore, granted)
  if (!persisted.ok) {
    logger.warn('voice', `falha ao persistir o consentimento: ${persisted.error ?? 'desconhecida'}`)
    return false
  }
  return granted && isMicrophoneGranted(consentStore)
}

function overlayContentsMatches(overlay: BrowserWindow | null, contents: unknown): boolean {
  if (!overlay || overlay.isDestroyed()) return false
  try {
    return overlay.webContents === contents
  } catch {
    return false
  }
}

export interface VoiceRuntime {
  controller: VoiceController
}

let runtime: VoiceRuntime | null = null

export function createVoiceRuntime(ctx: IpcContext): VoiceRuntime {
  const chatHistory = createChatHistory({ store: getPersistentStore() })
  const hasApiKey = (): boolean => {
    try {
      return getApiKey() !== null
    } catch {
      return false
    }
  }
  const pushAudio = (push: VoiceAudioPush): void => broadcast(ctx, IPC.voiceAudio, push)

  // Saudação curta por horário: mesma voz/modelo Live, sem microfone. O áudio
  // sai pelo mesmo `voice:audio` que o overlay já reproduz.
  const greeting = createGreetingController({
    createSession: (handlers) => {
      const snapshot = getStoreSnapshot()
      return new LiveSession({
        transport: new SdkLiveTransport(),
        keys: { getApiKey },
        usage: getUsageMeter(),
        model: snapshot.gemini.liveModel,
        voiceName: LIVE_VOICE_NAME,
        temperature: snapshot.gemini.temperature,
        systemInstruction: GREETING_SYSTEM_INSTRUCTION,
        handlers: {
          onAudio: handlers.onAudio,
          onError: handlers.onError,
          onClose: handlers.onClose,
          onTurnComplete: handlers.onTurnComplete
        },
        logger,
        // Saudação é descartável: uma tentativa, sem reconexão em rede ruim.
        maxAttempts: 1
      })
    },
    hasApiKey,
    checkBudget: () => getUsageMeter().checkBudget(),
    pushAudio,
    logger,
    isEnabled: () => {
      if (shouldSkipGreeting()) return false
      const overlay = ctx.getOverlayWindow()
      return Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible())
    }
  })

  const controller = new VoiceController({
    getConfig: () => getStoreSnapshot().voice,
    updateConfig: (patch) => setStoreValue('voice', { ...getStoreSnapshot().voice, ...patch }),
    hasConsent: () => isMicrophoneGranted(consentStore),
    persistConsent: (granted) => setMicrophoneConsent(consentStore, granted),
    requestConsent: () => askMicrophoneConsent(ctx),
    hasApiKey,
    checkBudget: () => getUsageMeter().checkBudget(),
    createSession: (handlers) => {
      const snapshot = getStoreSnapshot()
      const search = getSearchRuntime()
      const tools = [
        ...(getActionsRuntime()?.registry.listTools() ?? []),
        ...(search?.listTools() ?? [])
      ]
      // Sessão de voz é o "turno" para os contadores de pesquisa.
      search?.beginTurn(`voice:${Date.now()}`)
      const basePrompt = buildSystemPrompt({
        defaultLanguage: snapshot.ui.language,
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                category: tool.category
              }))
            }
          : {})
      })
      // Memória recuperada no início da sessão (pinned/perfil). Pausada = ''.
      const memoryBlock = getMemoryBlock('')
      const hasWebTools = tools.some((tool) => tool.category === 'web.search')
      const systemInstruction = [basePrompt, hasWebTools ? WEB_SYSTEM_RULES : '', memoryBlock]
        .filter((part) => part.length > 0)
        .join('\n\n')
      const live = new LiveSession({
        transport: new SdkLiveTransport(),
        keys: { getApiKey },
        usage: getUsageMeter(),
        model: snapshot.gemini.liveModel,
        voiceName: LIVE_VOICE_NAME,
        temperature: snapshot.gemini.temperature,
        systemInstruction,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        })),
        handlers,
        logger
      })
      return live
    },
    setAvatarState: (state) => applyAvatarState(state),
    pushState: (change: VoiceStateChange) => broadcast(ctx, IPC.voiceState, change),
    pushAudio,
    pushTranscript: (push: VoiceTranscriptPush) => broadcast(ctx, IPC.voiceTranscript, push),
    routeToolCall: async (call) => {
      const search = getSearchRuntime()
      if (search?.hasTool(call.name)) return search.route(call)
      const runtime = getActionsRuntime()
      if (!runtime) {
        return {
          ok: false,
          error: { kind: 'not-found', message: 'Ferramentas de ação não inicializadas.' }
        }
      }
      return runtime.route(call)
    },
    isOverlayVisible: () => {
      const overlay = ctx.getOverlayWindow()
      return Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible())
    },
    showOverlay: () => {
      showOverlayWindow()
    },
    notify: (message) => logger.info('voice', message),
    cancelGreeting: () => greeting.cancel(),
    memoryEnabled: () => getStoreSnapshot().memory.enabled,
    history: {
      append: (role, text, interrupted = false) => {
        chatHistory.append(role, text, undefined, interrupted)
      },
      beginSession: (sessionId, at) => getMemoryRuntime()?.beginSession(sessionId, at),
      endSession: (sessionId, at) => getMemoryRuntime()?.endSession(sessionId, at),
      appendTurn: (turn) => getMemoryRuntime()?.recordTurn(turn)
    },
    logger
  })

  registerVoiceIpc(controller)

  registerMediaPermissions({
    session: session.defaultSession,
    isOverlayContents: (contents) => overlayContentsMatches(ctx.getOverlayWindow(), contents),
    hasConsent: () => isMicrophoneGranted(consentStore)
  })

  registerVoiceShortcut(getStoreSnapshot().voice.shortcut ?? VOICE_DEFAULT_SHORTCUT, () => {
    controller.toggle('shortcut')
  })

  onOverlayShown(() => greeting.speak())
  onOverlayHidden(() => {
    greeting.cancel()
    controller.notifyOverlayHidden()
  })
  registerShutdownHook('voice', () => {
    greeting.cancel()
    controller.shutdown()
  })

  return { controller }
}

/** Cria (uma vez) o runtime de voz; chamado por `registerIpc`. */
export function ensureVoiceRuntime(ctx: IpcContext): VoiceRuntime {
  if (!runtime) runtime = createVoiceRuntime(ctx)
  return runtime
}

export function getVoiceController(): VoiceController | null {
  return runtime?.controller ?? null
}

/** Hook de teste/smoke: substitui o runtime compartilhado. */
export function setVoiceRuntimeForTests(next: VoiceRuntime | null): void {
  runtime = next
}
