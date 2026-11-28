import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc'
import type { IpcError, SearchStatusResult, SimpleResult } from '../../shared/ipc'
import { MAX_FETCH_URL_CHARS, parseAllowedExternalUrl } from '../../shared/search'
import { logger } from '../logger'
import type { SearchRuntime } from '../search/instance'

/**
 * Canais IPC mínimos da pesquisa (task 10, T9).
 *
 * A UI completa é da task 11. Aqui ficam só o status (para a task 11 ler os
 * contadores do turno), a abertura de um link citado e a limpeza do cache.
 * `search:open-url` passa pela allowlist compartilhada: apenas http/https; o
 * resto nunca chega ao `shell.openExternal`.
 */

const MAX_URL_CHARS = MAX_FETCH_URL_CHARS

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function registerSearchIpc(runtime: SearchRuntime): void {
  ipcMain.handle(IPC.searchStatus, (): SearchStatusResult => ({
    ok: true,
    status: runtime.status()
  }))

  ipcMain.handle(IPC.searchOpenUrl, async (_event, payload: unknown): Promise<SimpleResult> => {
    if (!isRecord(payload) || typeof payload.url !== 'string') {
      return failure(`Payload inválido para ${IPC.searchOpenUrl}.`)
    }
    const raw = payload.url.trim()
    if (!raw || raw.length > MAX_URL_CHARS) {
      return failure('URL inválida para abrir.')
    }
    const allowed = parseAllowedExternalUrl(raw)
    if (!allowed) return failure('Apenas links http ou https podem ser abertos.')
    try {
      await shell.openExternal(allowed)
      return { ok: true }
    } catch (err) {
      logger.warn('search', 'falha ao abrir link externo', {
        message: err instanceof Error ? err.message.slice(0, 200) : 'desconhecida'
      })
      return failure('Não foi possível abrir o link.')
    }
  })

  ipcMain.handle(IPC.searchClearCache, (): SimpleResult => {
    runtime.clearCache()
    return { ok: true }
  })
}
