import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ChatCancelRequest, ChatSendRequest, IpcError, SimpleResult } from '../../shared/ipc'
import type { ChatDonePush, ChatErrorPush } from '../../shared/gemini'
import { subscribeUsageWarning } from '../gemini/instance'
import { getUsageMeter } from '../gemini/instance'
import { LiveSession } from '../gemini/live'
import { SdkLiveTransport } from '../gemini/sdk'
import { getApiKey } from '../secrets'
import { getStoreSnapshot } from '../store'
import { buildSystemPrompt } from '../gemini/prompts'
import { WEB_SYSTEM_RULES } from '../search/injection'
import { getActionsRuntime } from '../actions/instance'
import { getSearchRuntime } from '../search/instance'
import { getCaptureRuntime } from '../capture/instance'
import { LIVE_VOICE_NAME } from '../../shared/voice'
import { buildSourcesBlock } from '../search/answer'
import type { GeminiFunctionCall, GeminiFunctionResponse } from '../gemini/transport'
import type { ToolCallResult } from '../gemini/tools/router'
import { recordDiagnosticError } from './diagnostics'
import type { IpcContext } from './lifecycle'
import { checkPayloadLimits, isTrustedSender } from '../security/ipcGuard'

/**
 * Streaming de texto por IPC.
 *
 * `chat:send` responde na hora e a geração continua em background: nada que o
 * renderer aguarda bloqueia o socket. O engine garante uma conversa por vez e
 * que nenhum delta saia depois do cancelamento.
 */

const MAX_REQUEST_ID = 128
const MAX_TEXT_CHARS = 32_000

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function send(window: BrowserWindow | null, channel: string, payload: unknown): void {
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send(channel, payload)
  } catch {
    // Janela fechando entre a checagem e o envio: o próximo push tenta de novo.
  }
}

const emptyUsage: ChatDonePush['usage'] = {
  input: 0,
  output: 0,
  total: 0,
  estimated: false
}
const chatSessions = new Map<string, LiveSession>()

export function registerChatIpc(ctx: IpcContext, _legacyEngine?: unknown): void {
  const broadcast = (channel: string, payload: unknown): void => {
    const overlay = ctx.getOverlayWindow()
    send(overlay, channel, payload)
    const main = ctx.getMainWindow()
    if (main !== overlay) send(main, channel, payload)
  }

  subscribeUsageWarning((warning) => {
    // Payload do contrato: sem o mês interno do medidor.
    broadcast(IPC.geminiUsageWarning, {
      percent: warning.percent,
      cap: warning.cap,
      used: warning.used
    })
  })

  ipcMain.handle(IPC.chatSend, (event, payload: unknown): SimpleResult => {
    if (!isTrustedSender(event)) return failure('Remetente não autorizado.')
    const limits = checkPayloadLimits(payload)
    if (!limits.ok) return failure(limits.message)
    if (
      !isRecord(payload) ||
      typeof payload.requestId !== 'string' ||
      payload.requestId.length === 0 ||
      payload.requestId.length > MAX_REQUEST_ID ||
      typeof payload.text !== 'string' ||
      payload.text.trim().length === 0 ||
      payload.text.length > MAX_TEXT_CHARS
    ) {
      return failure(`Payload inválido para ${IPC.chatSend}.`)
    }
    const request: ChatSendRequest = { requestId: payload.requestId, text: payload.text }
    // Cada turno tem contadores próprios de busca/abertura (task 10, T7).
    getSearchRuntime()?.beginTurn(request.requestId)
    const snapshot = getStoreSnapshot()
    const actions = getActionsRuntime()
    const search = getSearchRuntime()
    const capture = getCaptureRuntime()
    const tools = [
      ...(actions?.registry.listTools() ?? []),
      ...(search?.listTools() ?? []),
      ...(capture?.listTools() ?? [])
    ]
    let session: LiveSession | null = null
    let lastModelTranscript = ''
    let liveSources: Array<{ title: string; url: string }> = []
    const sendError = (error: { kind: ChatErrorPush['kind']; message: string }): void => {
      recordDiagnosticError(error)
      broadcast(IPC.chatError, { requestId: request.requestId, ...error } satisfies ChatErrorPush)
      chatSessions.delete(request.requestId)
      capture?.setLiveSession(null)
    }
    const route = async (call: GeminiFunctionCall): Promise<ToolCallResult> => {
      if (capture?.listTools().some((tool) => tool.name === call.name)) {
        return capture.routeToolCall(call)
      }
      if (search?.hasTool(call.name)) return search.route(call)
      if (actions) return actions.route(call)
      return { ok: false, error: { kind: 'not-found', message: 'Ferramenta indisponível.' } }
    }
    session = new LiveSession({
      transport: new SdkLiveTransport(),
      keys: { getApiKey },
      usage: getUsageMeter(),
      model: snapshot.gemini.liveModel,
      voiceName: LIVE_VOICE_NAME,
      temperature: snapshot.gemini.temperature,
      systemInstruction: [
        buildSystemPrompt({
          defaultLanguage: snapshot.ui.language,
          ...(tools.length > 0
            ? { tools: tools.map((tool) => ({ name: tool.name, category: tool.category })) }
            : {})
        }),
        tools.some((tool) => tool.category === 'web.search') ? WEB_SYSTEM_RULES : ''
      ]
        .filter(Boolean)
        .join('\n\n'),
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      })),
      googleSearch: snapshot.web.enabled,
      handlers: {
        onAudio: () => undefined,
        onTranscript: (event) => {
          if (event.role !== 'model' || !event.text) return
          const delta = event.text.startsWith(lastModelTranscript)
            ? event.text.slice(lastModelTranscript.length)
            : event.text
          lastModelTranscript = event.text
          if (delta) broadcast(IPC.chatDelta, { requestId: request.requestId, text: delta })
        },
        onToolCall: (calls) => {
          void (async () => {
            const responses: GeminiFunctionResponse[] = []
            for (const call of calls) {
              let result: ToolCallResult
              try {
                result = await route(call)
              } catch (err) {
                result = {
                  ok: false,
                  error: {
                    kind: 'failed',
                    message:
                      err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)
                  }
                }
              }
              responses.push({
                name: call.name,
                ...(typeof call.id === 'string' && call.id.length > 0 ? { id: call.id } : {}),
                response: result.ok
                  ? { ok: true, result: result.result ?? null }
                  : { ok: false, error: result.error }
              })
            }
            if (responses.length > 0) session?.sendToolResponse(responses)
          })()
        },
        onTurnComplete: () => {
          if (liveSources.length > 0) {
            broadcast(IPC.chatDelta, {
              requestId: request.requestId,
              text: `\n\n${buildSourcesBlock(liveSources)}`
            })
          }
          broadcast(IPC.chatDone, { requestId: request.requestId, usage: emptyUsage })
          chatSessions.delete(request.requestId)
          capture?.setLiveSession(null)
          session?.close('turn-complete')
        },
        onGrounding: (sources) => {
          liveSources = sources
        },
        onError: (error) => sendError(error)
      }
    })
    chatSessions.set(request.requestId, session)
    capture?.setLiveSession(session)
    void session
      .connect()
      .then(() => session?.sendText(request.text))
      .catch((error: unknown) => {
        sendError({
          kind: 'unknown',
          message: error instanceof Error ? error.message : 'Falha ao conectar ao Gemini Live.'
        })
        session?.close('error')
      })
    return { ok: true }
  })

  ipcMain.handle(IPC.chatCancel, (event, payload: unknown): SimpleResult => {
    if (!isTrustedSender(event)) return failure('Remetente não autorizado.')
    if (
      !isRecord(payload) ||
      typeof payload.requestId !== 'string' ||
      payload.requestId.length === 0 ||
      payload.requestId.length > MAX_REQUEST_ID
    ) {
      return failure(`Payload inválido para ${IPC.chatCancel}.`)
    }
    const request: ChatCancelRequest = { requestId: payload.requestId }
    const session = chatSessions.get(request.requestId)
    chatSessions.delete(request.requestId)
    session?.close('cancelled')
    return { ok: true }
  })
}
