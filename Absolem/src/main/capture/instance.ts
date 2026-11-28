import { BrowserWindow, desktopCapturer, dialog, screen } from 'electron'
import { join } from 'path'
import { IPC } from '../../shared/ipc'
import type {
  CaptureAskRequest,
  CaptureCancelRequest,
  CaptureFrameResultRequest,
  CaptureStatusResult
} from '../../shared/ipc'
import type { CaptureIndicatorPush, CaptureKind, CaptureStatus } from '../../shared/screen'
import { isCaptureKind } from '../../shared/screen'
import type { ChatSinks } from '../gemini/engine'
import type { GeminiFunctionCall } from '../gemini/transport'
import type { ToolDefinition } from '../../shared/tools'
import { effectiveScreenPermission } from '../../shared/permissions'
import type { ToolCallResult } from '../gemini/tools/router'
import type { LiveSession } from '../gemini/live'
import { LiveSession as LiveSessionImpl } from '../gemini/live'
import { createLiveTransport, getLiveApiKey } from '../gemini/liveTransportFactory'
import { buildSystemPrompt } from '../gemini/prompts'
import { getUsageMeter } from '../gemini/instance'
import { createDefaultToolRegistry } from '../gemini/tools/internal'
import { createDialogConfirmation } from '../gemini/tools/confirmation'
import { createLoggerAudit, routeToolCall } from '../gemini/tools/router'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import { isAllowedNavigationUrl } from '../navigation'
import { SECURE_WEB_PREFERENCES, blockWebviewAttach } from '../security/webPreferences'
import { getForegroundWindow } from '../overlay/foreground'
import {
  hideOverlayWindowForCapture,
  isOverlayVisible,
  showOverlayWindow
} from '../overlay/overlayWindow'
import { registerShutdownHook } from '../shutdown'
import { getStoreSnapshot } from '../store'
import { getVoiceController } from '../voice/instance'
import { askAboutScreenLive, SCREEN_SYSTEM_RULES } from './ask'
import type { LiveScreenSessionHandlers } from './ask'
import type { CaptureController, CaptureGrabRequest, CapturedImage } from './controller'
import { createCaptureController } from './controller'
import { createFrameGrabService, type FrameGrabService } from './grabService'
import { cropCapturedImage } from './image'
import { createCaptureLimiter, type CaptureLimiter } from './limits'
import { createRegionSelector, type RegionSelector } from './regionWindow'
import { createCaptureRequestTracker } from './requestTracker'
import { createScreenSourceCache, listScreens } from './sources'
import { registerScreenTool } from './tool'
import { getApiKey } from '../secrets'
import { getSearchRuntime } from '../search/instance'
import { getActionsRuntime } from '../actions/instance'
import { deduplicateTools } from '../gemini/tools/compose'
import { WEB_SYSTEM_RULES } from '../search/injection'
import { LIVE_VOICE_NAME } from '../../shared/voice'

/**
 * Composição de produção da visão de tela (task 07).
 *
 * Só este arquivo liga o controlador às implementações reais: Electron
 * (`screen`, `desktopCapturer`, `dialog`, `BrowserWindow`), store, overlay,
 * motor Gemini, medidor de custo e logger. Os testes montam as peças com fakes
 * e nunca chegam aqui.
 */

export interface CaptureRuntime {
  controller: CaptureController
  limiter: CaptureLimiter
  selector: RegionSelector
  grab: FrameGrabService
  ask: (request: CaptureAskRequest) => void
  status: () => CaptureStatus
  statusResult: () => CaptureStatusResult
  handleFrameResult: (payload: unknown) => { ok: boolean; error?: string }
  submitRegion: (contentsId: number, payload: unknown) => boolean
  isRegionContents: (contentsId: number) => boolean
  cancel: (request: CaptureCancelRequest) => void
  shutdown: () => void
  listTools: () => readonly ToolDefinition[]
  routeToolCall: (call: GeminiFunctionCall) => Promise<ToolCallResult>
  setLiveSession: (session: LiveSession | null) => void
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return copy.buffer
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

function displayLabel(kind: CaptureKind): string {
  if (kind === 'active-window') return 'a janela ativa'
  if (kind === 'region') return 'a região selecionada'
  return 'a tela inteira'
}

async function confirmCapture(
  ctx: IpcContext,
  request: { kind: CaptureKind; title: string; processName?: string; reason: string }
): Promise<boolean> {
  const overlay = ctx.getOverlayWindow()
  const options = {
    type: 'question' as const,
    buttons: ['Cancelar', 'Capturar e enviar'],
    defaultId: 0,
    cancelId: 0,
    title: 'Absolem - visão da tela',
    message: `Permitir que o Absolem capture ${displayLabel(request.kind)}?`,
    detail: [
      request.title ? `Alvo: ${request.title}` : '',
      request.processName ? `Processo: ${request.processName}` : '',
      request.reason
    ]
      .filter(Boolean)
      .join('\n')
  }
  try {
    const result =
      overlay && !overlay.isDestroyed()
        ? await dialog.showMessageBox(overlay, options)
        : await dialog.showMessageBox(options)
    return result.response === 1
  } catch (err) {
    logger.warn('capture', 'falha ao mostrar a confirmação de captura', err)
    return false
  }
}

export function createCaptureRuntime(ctx: IpcContext): CaptureRuntime {
  let activeKind: CaptureKind | null = null
  const regionContents = new Set<number>()
  let liveSession: LiveSession | null = null
  const screenSessions = new Map<string, LiveSessionImpl>()
  /** Pedidos em andamento e cancelados (`capture:ask`). */
  const requestTracker = createCaptureRequestTracker()
  /** Depois do hook de encerramento nenhum push/pedido novo sai daqui. */
  let shuttingDown = false

  const screenSources = createScreenSourceCache({
    getScreens: () => listScreens(),
    getDisplayKey: () =>
      screen
        .getAllDisplays()
        .map((display) => String(display.id))
        .sort()
        .join(',')
  })

  const pushIndicator = (push: CaptureIndicatorPush): void => {
    activeKind = push.active ? (push.kind ?? null) : null
    broadcast(ctx, IPC.captureIndicator, push)
  }

  const thumbnailFallback = async (request: CaptureGrabRequest): Promise<CapturedImage | null> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.max(1, Math.round(request.pixelWidth)),
          height: Math.max(1, Math.round(request.pixelHeight))
        },
        fetchWindowIcons: false
      })
      const source = sources.find((entry) => entry.id === request.sourceId)
      if (!source) return null
      const size = source.thumbnail.getSize()
      if (size.width <= 0 || size.height <= 0) return null
      const buffer = request.lossless ? source.thumbnail.toPNG() : source.thumbnail.toJPEG(75)
      if (buffer.byteLength === 0) return null
      return {
        mime: request.lossless ? 'image/png' : 'image/jpeg',
        data: toArrayBuffer(buffer),
        width: size.width,
        height: size.height
      }
    } catch (err) {
      logger.warn('capture', 'fallback de thumbnail falhou', err)
      return null
    }
  }

  const grab = createFrameGrabService({
    sendRequest: (push) => {
      const overlay = ctx.getOverlayWindow()
      if (!overlay || overlay.isDestroyed()) return false
      try {
        overlay.webContents.send(IPC.captureRequest, push)
        return true
      } catch {
        return false
      }
    },
    fallback: thumbnailFallback
  })

  const selector: RegionSelector = createRegionSelector({
    getDisplays: () =>
      screen.getAllDisplays().map((display) => ({
        id: String(display.id),
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height
        }
      })),
    createWindow: (display) => {
      const window = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: Math.max(1, display.bounds.width),
        height: Math.max(1, display.bounds.height),
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        title: 'Absolem - selecionar região',
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          ...SECURE_WEB_PREFERENCES
        }
      })
      const contentsId = window.webContents.id
      regionContents.add(contentsId)
      blockWebviewAttach(window.webContents)
      window.setAlwaysOnTop(true, 'screen-saver')
      window.setSkipTaskbar(true)
      window.webContents.setWindowOpenHandler(({ url }) => {
        logger.warn('capture', `window.open bloqueado na seleção de região: ${url}`)
        return { action: 'deny' }
      })
      window.webContents.on('will-navigate', (event, url) => {
        if (isAllowedNavigationUrl(url, process.env['ELECTRON_RENDERER_URL'])) return
        event.preventDefault()
        logger.warn('capture', `will-navigate bloqueado na seleção de região: ${url}`)
      })
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      const hash = `region?displayId=${encodeURIComponent(display.id)}`
      const load = devUrl
        ? window.loadURL(`${devUrl}#${hash}`)
        : window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
      load.catch((err: unknown) => {
        logger.warn(
          'capture',
          `falha ao carregar a seleção de região: ${err instanceof Error ? err.message : String(err)}`
        )
        selector.cancel()
      })
      window.on('closed', () => {
        regionContents.delete(contentsId)
        selector.cancel()
      })
      window.show()
      window.focus()
      return {
        destroy: () => {
          if (!window.isDestroyed()) window.destroy()
        },
        isDestroyed: () => window.isDestroyed()
      }
    }
  })

  const limiter = createCaptureLimiter({
    checkBudget: () => getUsageMeter().checkBudget()
  })

  const controller = createCaptureController({
    getPrivacy: () => getStoreSnapshot().privacy.screen,
    getVoiceState: () => getVoiceController()?.getState() ?? null,
    isOverlayVisible,
    hideOverlay: hideOverlayWindowForCapture,
    showOverlay: showOverlayWindow,
    listScreens: () => screenSources.list(),
    getDisplays: () =>
      screen.getAllDisplays().map((display) => ({
        id: String(display.id),
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height
        },
        scaleFactor: display.scaleFactor
      })),
    getForeground: () => getForegroundWindow(),
    selectRegion: () => selector.select(),
    grab: (request) => grab.request(request),
    crop: cropCapturedImage,
    confirm: (request) =>
      confirmCapture(ctx, {
        kind: request.kind,
        title: request.title,
        ...(request.processName ? { processName: request.processName } : {}),
        reason: request.reason
      }),
    isCancelled: (requestId) => requestTracker.isCancelled(requestId),
    audit: (event) => logger.info('audit', event),
    pushIndicator,
    limits: limiter
  })

  const buildScreenRegistry = () => {
    const privacy = getStoreSnapshot().privacy.screen
    const { registry, handlers } = createDefaultToolRegistry()
    registerScreenTool(registry, handlers, {
      mode: privacy.mode,
      handler: async (args) => {
        const result = await controller.capture({
          kind: args.kind ?? 'screen',
          question: args.question,
          ...(args.displayId ? { displayId: args.displayId } : {})
        })
        if (!result.ok) return { error: result.error.message }
        const session = liveSession
        if (!session || session.isClosed()) {
          return { error: 'Sessão Live indisponível para receber a captura.' }
        }
        session.sendImage({
          mime: result.image.mime,
          data: result.image.data
        })
        return {
          kind: result.kind,
          width: result.image.width,
          height: result.image.height,
          bytes: result.image.data.byteLength
        }
      }
    })
    return { registry, handlers }
  }

  const routeCall = async (call: GeminiFunctionCall): Promise<ToolCallResult> => {
    const { registry, handlers } = buildScreenRegistry()
    return routeToolCall(
      {
        registry,
        getHandler: (name) => handlers.get(name) ?? null,
        // `on` é o modo autônomo aprovado; `ask` e a pausa continuam sendo
        // barreiras explícitas antes da captura.
        getPermission: () =>
          effectiveScreenPermission(
            getStoreSnapshot().permissions,
            getStoreSnapshot().privacy.screen.mode
          ),
        confirm: createDialogConfirmation(
          {
            showMessageBox: (window, options) =>
              window
                ? dialog.showMessageBox(window as BrowserWindow, options)
                : dialog.showMessageBox(options)
          },
          () => ctx.getOverlayWindow()
        ),
        audit: createLoggerAudit(logger)
      },
      call
    )
  }
  const listTools = (): readonly ToolDefinition[] => buildScreenRegistry().registry.listTools()

  const ask = (request: CaptureAskRequest): void => {
    if (shuttingDown) {
      logger.warn('capture', 'capture:ask ignorado durante o encerramento')
      return
    }
    // Duplicado concorrente com o mesmo requestId (duplo clique/IPC repetido):
    // um único frame e uma única sessão Live. O stream já sai pelo mesmo
    // `requestId`, então quem repetiu recebe a mesma resposta sem custo extra.
    if (!requestTracker.begin(request.requestId)) {
      logger.warn('capture', 'capture:ask duplicado ignorado', { requestId: request.requestId })
      return
    }
    let finished = false
    // Cancelamento/encerramento fecha a porta antes do push: nada de delta,
    // tool, done ou erro tardio depois de `capture:cancel`/close.
    const push = (channel: string, payload: unknown): void => {
      if (finished || shuttingDown || requestTracker.isCancelled(request.requestId)) return
      broadcast(ctx, channel, payload)
    }
    const sinks: ChatSinks = {
      delta: (text) => push(IPC.chatDelta, { requestId: request.requestId, text }),
      done: (usage) => push(IPC.chatDone, { requestId: request.requestId, usage }),
      error: (error) =>
        push(IPC.chatError, {
          requestId: request.requestId,
          kind: error.kind,
          message: error.message
        })
    }
    const search = getSearchRuntime()
    const actions = getActionsRuntime()
    const tools = deduplicateTools([
      ...(actions?.registry.listTools() ?? []),
      ...(search?.listTools() ?? []),
      ...listTools()
    ])
    const routeLiveToolCall = async (call: GeminiFunctionCall): Promise<ToolCallResult> => {
      if (actions?.registry.getTool(call.name)) return actions.route(call)
      if (search?.hasTool(call.name)) return search.route(call)
      if (listTools().some((tool) => tool.name === call.name)) return routeCall(call)
      return {
        ok: false,
        error: { kind: 'not-found', message: 'Ferramentas de ação não inicializadas.' }
      }
    }
    let screenHandlers: LiveScreenSessionHandlers | null = null
    const live = new LiveSessionImpl({
      transport: createLiveTransport(),
      keys: { getApiKey: () => getLiveApiKey(getApiKey) },
      usage: getUsageMeter(),
      model: getStoreSnapshot().gemini.liveModel,
      voiceName: LIVE_VOICE_NAME,
      temperature: getStoreSnapshot().gemini.temperature,
      systemInstruction: [
        buildSystemPrompt({
          defaultLanguage: getStoreSnapshot().ui.language,
          ...(tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  name: tool.name,
                  category: tool.category
                }))
              }
            : {})
        }),
        SCREEN_SYSTEM_RULES,
        tools.some((tool) => tool.category === 'web.search') ? WEB_SYSTEM_RULES : ''
      ]
        .filter(Boolean)
        .join('\n\n'),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      })),
      googleSearch: getStoreSnapshot().web.enabled,
      handlers: {
        onTranscript: (event) => screenHandlers?.onTranscript(event),
        onToolCall: (calls) => screenHandlers?.onToolCall(calls),
        onTurnComplete: () => screenHandlers?.onTurnComplete(),
        onError: (error) => screenHandlers?.onError({ kind: error.kind, message: error.message }),
        onClose: (reason) => screenHandlers?.onClose?.(reason),
        onAudio: () => undefined
      },
      logger
    })
    screenSessions.set(request.requestId, live)
    liveSession = live
    void askAboutScreenLive(
      {
        capture: async (captureRequest) => {
          const result = await controller.capture(captureRequest)
          // Cancelamento entre o fim do recorte e o envio: descarta a imagem.
          if (
            result.ok &&
            captureRequest.requestId &&
            requestTracker.isCancelled(captureRequest.requestId)
          ) {
            return { ok: false, error: { code: 'cancelled', message: 'Captura cancelada.' } }
          }
          return result
        },
        createSession: (handlers) => {
          screenHandlers = handlers
          return {
            connect: () => live.connect(),
            sendImage: (image) => live.sendImage(image),
            sendImageAndText: (image, text) => live.sendImageAndText(image, text),
            sendText: (text) => live.sendText(text),
            sendToolResponse: (responses) => live.sendToolResponse(responses),
            close: (reason) => {
              screenSessions.delete(request.requestId)
              live.close(reason)
            }
          }
        },
        routeCall: routeLiveToolCall,
        logger
      },
      request,
      sinks
    )
      .catch((err: unknown) => {
        logger.warn(
          'capture',
          'falha no pedido de visão da tela',
          err instanceof Error ? { type: err.name } : { type: typeof err }
        )
      })
      .finally(() => {
        // Fecha a porta de push ANTES de liberar o tracker: eventos que ainda
        // estejam na fila não chegam ao renderer depois do close/cancel.
        finished = true
        requestTracker.end(request.requestId)
        screenSessions.delete(request.requestId)
        if (liveSession === live) liveSession = null
        if (!live.isClosed()) live.close('finished')
      })
  }

  const status = (): CaptureStatus => {
    const privacy = getStoreSnapshot().privacy.screen
    const snapshot = limiter.snapshot()
    return {
      mode: privacy.mode,
      proactive: privacy.proactive,
      active: activeKind !== null,
      ...(activeKind ? { kind: activeKind } : {}),
      capturesLastHour: snapshot.capturesLastHour,
      capturesPerHourLimit: snapshot.maxPerHour
    }
  }

  const handleFrameResult = (payload: unknown): { ok: boolean; error?: string } => {
    const raw = asRecord(payload)
    if (
      typeof raw.requestId !== 'string' ||
      typeof raw.ok !== 'boolean' ||
      (raw.mime !== undefined && raw.mime !== 'image/jpeg' && raw.mime !== 'image/png')
    ) {
      return { ok: false, error: 'Payload inválido para capture:result.' }
    }
    const result = grab.handleResult(raw as unknown as CaptureFrameResultRequest)
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'captura falhou' }
  }

  const submitRegion = (contentsId: number, payload: unknown): boolean => {
    if (!regionContents.has(contentsId)) return false
    return selector.resolveSelection(payload)
  }

  const cancel = (request: CaptureCancelRequest): void => {
    if (request.kind === 'region') selector.cancel()
    if (request.requestId) {
      requestTracker.cancel(request.requestId)
      grab.cancel(request.requestId)
      const session = screenSessions.get(request.requestId)
      screenSessions.delete(request.requestId)
      session?.close('cancelled')
    } else if (request.kind === 'ask') {
      for (const requestId of requestTracker.inflightIds()) requestTracker.cancel(requestId)
      for (const [requestId, session] of [...screenSessions]) {
        screenSessions.delete(requestId)
        session.close('cancelled')
      }
    }
    if (request.kind === undefined && request.requestId === undefined) {
      selector.cancel()
      for (const requestId of requestTracker.inflightIds()) requestTracker.cancel(requestId)
      for (const [requestId, session] of [...screenSessions]) {
        screenSessions.delete(requestId)
        session.close('cancelled')
      }
    }
  }

  const shutdown = (): void => {
    shuttingDown = true
    selector.cancel()
    grab.cancelAll()
    requestTracker.clear()
    // Sessões Live abertas por `capture:ask` não podem sobreviver ao
    // encerramento nem emitir eventos para janelas já destruídas.
    for (const [requestId, session] of [...screenSessions]) {
      screenSessions.delete(requestId)
      try {
        session.close('shutdown')
      } catch {
        // Sessão já encerrada.
      }
    }
    liveSession = null
    activeKind = null
  }
  registerShutdownHook('capture', shutdown)

  return {
    controller,
    limiter,
    selector,
    grab,
    ask,
    status,
    statusResult: () => ({ ok: true, status: status() }),
    handleFrameResult,
    submitRegion,
    isRegionContents: (contentsId) => regionContents.has(contentsId),
    cancel,
    shutdown,
    listTools,
    routeToolCall: routeCall,
    setLiveSession: (session) => {
      liveSession = session
    }
  }
}

let runtime: CaptureRuntime | null = null

export function ensureCaptureRuntime(ctx: IpcContext): CaptureRuntime {
  if (!runtime) runtime = createCaptureRuntime(ctx)
  return runtime
}

export function getCaptureRuntime(): CaptureRuntime | null {
  return runtime
}

/** Hook de teste/smoke: substitui a instância compartilhada. */
export function setCaptureRuntimeForTests(next: CaptureRuntime | null): void {
  runtime = next
}

/** Reexport para o IPC validar `kind` sem duplicar a lista. */
export { isCaptureKind }
