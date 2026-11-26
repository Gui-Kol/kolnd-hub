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
import { getGeminiEngine, getUsageMeter } from '../gemini/instance'
import { createDefaultToolRegistry } from '../gemini/tools/internal'
import { createDialogConfirmation } from '../gemini/tools/confirmation'
import { createLoggerAudit, routeToolCall } from '../gemini/tools/router'
import type { IpcContext } from '../ipc/lifecycle'
import { logger } from '../logger'
import { isAllowedNavigationUrl } from '../navigation'
import { SECURE_WEB_PREFERENCES, blockWebviewAttach } from '../security/webPreferences'
import { getForegroundWindow } from '../overlay/foreground'
import { hideOverlayWindow, isOverlayVisible, showOverlayWindow } from '../overlay/overlayWindow'
import { registerShutdownHook } from '../shutdown'
import { getStoreSnapshot } from '../store'
import { getVoiceController } from '../voice/instance'
import { askAboutScreen } from './ask'
import type { CaptureController, CaptureGrabRequest, CapturedImage } from './controller'
import { createCaptureController } from './controller'
import { createFrameGrabService, type FrameGrabService } from './grabService'
import { cropCapturedImage } from './image'
import { createCaptureLimiter, type CaptureLimiter } from './limits'
import { createRegionSelector, type RegionSelector } from './regionWindow'
import { listScreens } from './sources'
import { registerScreenTool } from './tool'

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
    hideOverlay: hideOverlayWindow,
    showOverlay: showOverlayWindow,
    listScreens,
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
    audit: (event) => logger.info('audit', event),
    pushIndicator,
    limits: limiter
  })

  const routeCall = async (call: { name: string; args: Record<string, unknown> }) => {
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
        return {
          kind: result.kind,
          width: result.image.width,
          height: result.image.height,
          bytes: result.image.data.byteLength
        }
      }
    })
    return routeToolCall(
      {
        registry,
        getHandler: (name) => handlers.get(name) ?? null,
        // Pausa global da task 08 bloqueia também a visão de tela (task 07).
        getPermission: () => (getStoreSnapshot().permissions.paused ? 'deny' : 'ask'),
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

  const ask = (request: CaptureAskRequest): void => {
    const sinks: ChatSinks = {
      delta: (text) => broadcast(ctx, IPC.chatDelta, { requestId: request.requestId, text }),
      done: (usage) => broadcast(ctx, IPC.chatDone, { requestId: request.requestId, usage }),
      error: (error) =>
        broadcast(ctx, IPC.chatError, {
          requestId: request.requestId,
          kind: error.kind,
          message: error.message
        })
    }
    const engine = getGeminiEngine()
    void askAboutScreen(
      {
        capture: (captureRequest) => controller.capture(captureRequest),
        send: (requestId, text, chatSinks, options) =>
          engine.send(requestId, text, chatSinks, options),
        routeCall,
        logger
      },
      request,
      sinks
    )
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
      grab.cancel(request.requestId)
      getGeminiEngine().cancel(request.requestId)
    } else if (request.kind === 'ask') {
      getGeminiEngine().cancel()
    }
    if (request.kind === undefined && request.requestId === undefined) {
      selector.cancel()
      getGeminiEngine().cancel()
    }
  }

  const shutdown = (): void => {
    selector.cancel()
    grab.cancelAll()
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
    shutdown
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
