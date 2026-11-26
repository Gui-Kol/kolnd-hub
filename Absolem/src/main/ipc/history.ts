import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { HistoryListRequest, HistoryListResult, HistoryTurn, IpcError } from '../../shared/ipc'
import type { ChatTurn } from '../../shared/config'

/**
 * Histórico recente da conversa (task 11, T2).
 *
 * Lê os turnos textuais persistidos em `chat.turns` (os mesmos usados pelo
 * contexto do motor) e devolve no máximo 20 por padrão. Com a memória pausada
 * não há histórico: o renderer explica que o histórico completo depende dela.
 */

export const HISTORY_DEFAULT_LIMIT = 20
export const HISTORY_MAX_LIMIT = 200

export interface HistorySource {
  getTurns: () => ChatTurn[]
  memoryEnabled: () => boolean
}

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isVoid(value: unknown): boolean {
  return value === undefined || value === null
}

function parseRequest(payload: unknown): HistoryListRequest {
  if (isVoid(payload)) return {}
  if (!isRecord(payload)) throw new Error(`Payload inválido para ${IPC.historyList}.`)
  for (const key of Object.keys(payload)) {
    if (key !== 'limit') throw new Error(`Campo desconhecido em ${IPC.historyList}: ${key}`)
  }
  if (payload.limit === undefined) return {}
  if (
    typeof payload.limit !== 'number' ||
    !Number.isInteger(payload.limit) ||
    payload.limit < 1 ||
    payload.limit > HISTORY_MAX_LIMIT
  ) {
    throw new Error(`Limite deve ficar entre 1 e ${HISTORY_MAX_LIMIT}.`)
  }
  return { limit: payload.limit }
}

export function toHistoryTurn(turn: ChatTurn): HistoryTurn {
  return {
    role: turn.role,
    text: turn.text,
    at: turn.at,
    interrupted: turn.interrupted === true
  }
}

/** Handler puro (testável sem Electron). */
export function listHistory(source: HistorySource, payload: unknown): HistoryListResult {
  try {
    const request = parseRequest(payload)
    if (!source.memoryEnabled()) return { ok: true, enabled: false, turns: [] }
    const limit = Math.min(request.limit ?? HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT)
    const turns = source.getTurns().slice(-limit).map(toHistoryTurn)
    return { ok: true, enabled: true, turns }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

export function registerHistoryIpc(source: HistorySource): void {
  ipcMain.handle(IPC.historyList, (_event, payload: unknown) => listHistory(source, payload))
}
