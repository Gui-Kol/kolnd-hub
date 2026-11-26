import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { IpcError, SimpleResult, StoreGetResult } from '../../shared/ipc'
import { getMemoryRuntime } from '../memory/instance'
import { getStoreSnapshot, isStoreKey, setStoreValue } from '../store'

/**
 * Acesso genérico ao store (`store:get`/`store:set`).
 *
 * O contrato e o preload já existiam; a casca do main entra aqui porque a tela
 * de memória precisa ler e alternar `memory.enabled`/`autoExtract`. A escrita
 * passa pelo normalizador de cada chave. Alterar `memory` também registra
 * pausa/retomada na auditoria (sem conteúdo).
 */

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function registerStoreIpc(): void {
  ipcMain.handle(IPC.storeGet, (_event, payload: unknown): StoreGetResult => {
    if (!isRecord(payload) || !isStoreKey(payload.key)) {
      return failure(`Payload inválido para ${IPC.storeGet}.`)
    }
    try {
      return { ok: true, key: payload.key, value: getStoreSnapshot()[payload.key] }
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error))
    }
  })

  ipcMain.handle(IPC.storeSet, (_event, payload: unknown): SimpleResult => {
    if (!isRecord(payload) || !isStoreKey(payload.key)) {
      return failure(`Payload inválido para ${IPC.storeSet}.`)
    }
    const key = payload.key
    const before = key === 'memory' ? getStoreSnapshot().memory : null
    const result = setStoreValue(key, payload.value)
    if (!result.success) return failure(result.error ?? 'Falha ao salvar a configuração.')
    if (key === 'memory' && before) {
      try {
        getMemoryRuntime()?.auditConfigChange(before, getStoreSnapshot().memory)
      } catch {
        // auditoria best-effort
      }
    }
    return { ok: true }
  })
}
