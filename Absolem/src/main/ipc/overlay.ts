import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { IpcError, OverlayStatusResult } from '../../shared/ipc'
import {
  getOverlayStatus,
  hideOverlay,
  setOverlayInteractiveFromRequest,
  setOverlayLayoutFromRequest,
  showOverlay,
  toggleOverlay
} from '../overlay/controller'

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

function voidChannel(
  channel: string,
  action: () => OverlayStatusResult
): (event: unknown, payload: unknown) => OverlayStatusResult {
  return (_event, payload) => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${channel}: ${describe(payload)}`)
    }
    try {
      return action()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha em ${channel}: ${message}`)
    }
  }
}

/**
 * Canais do overlay. Todo handler recebe `unknown`, valida e devolve
 * `{ ok, status }`; a mudança também é empurrada em `overlay:status-changed`
 * pelo controlador.
 */
export function registerOverlayIpc(): void {
  ipcMain.handle(
    IPC.overlayShow,
    voidChannel(IPC.overlayShow, () => ({ ok: true, status: showOverlay() }))
  )
  ipcMain.handle(
    IPC.overlayHide,
    voidChannel(IPC.overlayHide, () => ({ ok: true, status: hideOverlay() }))
  )
  ipcMain.handle(
    IPC.overlayToggle,
    voidChannel(IPC.overlayToggle, () => ({ ok: true, status: toggleOverlay() }))
  )
  ipcMain.handle(
    IPC.overlayStatus,
    voidChannel(IPC.overlayStatus, () => ({ ok: true, status: getOverlayStatus() }))
  )

  ipcMain.handle(IPC.overlaySetLayout, (_event, payload: unknown): OverlayStatusResult => {
    try {
      return setOverlayLayoutFromRequest(payload)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha em ${IPC.overlaySetLayout}: ${message}`)
    }
  })

  ipcMain.handle(IPC.overlaySetInteractive, (_event, payload: unknown): OverlayStatusResult => {
    try {
      return setOverlayInteractiveFromRequest(payload)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha em ${IPC.overlaySetInteractive}: ${message}`)
    }
  })
}
