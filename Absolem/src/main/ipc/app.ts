import { app, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { AppInfoResult, AutostartGetResult, IpcError, SimpleResult } from '../../shared/ipc'
import { getAutostart, setAutostart } from '../autostart'
import { shutdownApp } from './lifecycle'
import type { IpcContext } from './lifecycle'

/** Payload de canal sem argumentos: só `undefined`/`null` são aceitos. */
function isVoidPayload(value: unknown): boolean {
  return value === undefined || value === null
}

function failure(error: string): IpcError {
  return { ok: false, error }
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Canais base do app. Todo handler recebe `unknown` e valida antes de usar:
 * payload inválido vira `{ ok: false, error }` sem lançar.
 */
export function registerAppIpc(ctx: IpcContext): void {
  ipcMain.handle(IPC.appGetInfo, (_event, payload: unknown): AppInfoResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.appGetInfo}: ${describe(payload)}`)
    }
    try {
      return {
        ok: true,
        info: {
          name: app.getName(),
          version: app.getVersion(),
          platform: process.platform
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao ler informações do app: ${message}`)
    }
  })

  ipcMain.handle(IPC.appQuit, (_event, payload: unknown): SimpleResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.appQuit}: ${describe(payload)}`)
    }
    try {
      shutdownApp(ctx)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao encerrar o app: ${message}`)
    }
  })

  ipcMain.handle(IPC.appGetAutostart, (_event, payload: unknown): AutostartGetResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.appGetAutostart}: ${describe(payload)}`)
    }
    return { ok: true, state: getAutostart() }
  })

  ipcMain.handle(IPC.appSetAutostart, (_event, payload: unknown): SimpleResult => {
    const enabled =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)['enabled']
        : undefined
    const result = setAutostart(enabled)
    return result.success
      ? { ok: true }
      : failure(result.error ?? 'Falha ao atualizar a inicialização com o Windows.')
  })
}
