import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ChatCancelRequest, ChatSendRequest, IpcError, SimpleResult } from '../../shared/ipc'
import type { ChatDeltaPush, ChatDonePush, ChatErrorPush } from '../../shared/gemini'
import type { GeminiEngine } from '../gemini/engine'
import { subscribeUsageWarning } from '../gemini/instance'
import type { IpcContext } from './lifecycle'

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

export function registerChatIpc(ctx: IpcContext, engine: GeminiEngine): void {
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

  ipcMain.handle(IPC.chatSend, (_event, payload: unknown): SimpleResult => {
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
    void engine.send(request.requestId, request.text, {
      delta: (text) => {
        const push: ChatDeltaPush = { requestId: request.requestId, text }
        broadcast(IPC.chatDelta, push)
      },
      done: (usage) => {
        const push: ChatDonePush = { requestId: request.requestId, usage }
        broadcast(IPC.chatDone, push)
      },
      error: (error) => {
        const push: ChatErrorPush = {
          requestId: request.requestId,
          kind: error.kind,
          message: error.message
        }
        broadcast(IPC.chatError, push)
      }
    })
    return { ok: true }
  })

  ipcMain.handle(IPC.chatCancel, (_event, payload: unknown): SimpleResult => {
    if (
      !isRecord(payload) ||
      typeof payload.requestId !== 'string' ||
      payload.requestId.length === 0 ||
      payload.requestId.length > MAX_REQUEST_ID
    ) {
      return failure(`Payload inválido para ${IPC.chatCancel}.`)
    }
    const request: ChatCancelRequest = { requestId: payload.requestId }
    engine.cancel(request.requestId)
    return { ok: true }
  })
}
