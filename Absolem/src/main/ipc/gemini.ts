import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  GeminiStatusResult,
  GeminiTestKeyResult,
  IpcError,
  SimpleResult
} from '../../shared/ipc'
import type { GeminiEngine } from '../gemini/engine'

/**
 * Canais de estado/chave do motor Gemini.
 *
 * - `gemini:status` nunca toca na rede nem devolve a chave;
 * - `gemini:set-key` valida tipo e tamanho (8..4096) e grava via safeStorage;
 * - `gemini:clear-key` apaga o blob;
 * - `gemini:test-key` faz uma chamada mínima e contabiliza tokens.
 */

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isVoidPayload(value: unknown): boolean {
  return value === undefined || value === null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function registerGeminiIpc(engine: GeminiEngine): void {
  ipcMain.handle(IPC.geminiStatus, (_event, payload: unknown): GeminiStatusResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.geminiStatus}.`)
    }
    try {
      return { ok: true, status: engine.status() }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao ler o estado do Gemini: ${message}`)
    }
  })

  ipcMain.handle(IPC.geminiSetKey, (_event, payload: unknown): SimpleResult => {
    if (!isRecord(payload) || typeof payload.key !== 'string') {
      return failure(`Payload inválido para ${IPC.geminiSetKey}.`)
    }
    try {
      const result = engine.setKey(payload.key)
      return result.ok ? { ok: true } : failure(result.error ?? 'Falha ao gravar a chave.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao gravar a chave: ${message}`)
    }
  })

  ipcMain.handle(IPC.geminiClearKey, (_event, payload: unknown): SimpleResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.geminiClearKey}.`)
    }
    try {
      const result = engine.clearKey()
      return result.ok ? { ok: true } : failure(result.error ?? 'Falha ao apagar a chave.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao apagar a chave: ${message}`)
    }
  })

  ipcMain.handle(
    IPC.geminiTestKey,
    async (_event, payload: unknown): Promise<GeminiTestKeyResult> => {
      if (!isVoidPayload(payload)) {
        return failure(`Payload inválido para ${IPC.geminiTestKey}.`)
      }
      try {
        return { ok: true, result: await engine.testKey() }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return failure(`Falha ao testar a chave: ${message}`)
      }
    }
  )
}
