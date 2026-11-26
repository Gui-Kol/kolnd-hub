import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  clampAvatarLevel,
  isAvatarState,
  type AvatarApplyPush,
  type AvatarState,
  type AvatarStatus
} from '../../shared/avatar'
import { IPC } from '../../shared/ipc'
import type { AvatarGetStatusResult, IpcError, SimpleResult } from '../../shared/ipc'
import { onOverlayWindowCreated } from '../overlay/overlayWindow'
import type { IpcContext } from './lifecycle'

/**
 * Estado do avatar no main.
 *
 * O main guarda o último `state`/`level` (a task 06 vai alimentá-los com a
 * sessão de voz real) e empurra cada mudança ao overlay em `avatar:apply`. O
 * renderer hidrata com `avatar:get-status` no mount, mas o estado também é
 * reenviado no `did-finish-load` da janela do overlay: uma janela recriada
 * (ou recarregada) não fica dessincronizada.
 */
let context: IpcContext | null = null
let state: AvatarState = 'idle'
let level = 0

let boundWindow: BrowserWindow | null = null
let boundHandler: (() => void) | null = null
let unsubscribeCreated: (() => void) | null = null
let registered = false

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function overlayWindow(): BrowserWindow | null {
  const window = context?.getOverlayWindow() ?? null
  return window && !window.isDestroyed() ? window : null
}

function send(payload: AvatarApplyPush): void {
  const window = overlayWindow()
  if (!window) return
  try {
    window.webContents.send(IPC.avatarApply, payload)
  } catch {
    // Janela fechando entre a checagem e o envio: o próximo estado reenvia.
  }
}

function unbind(): void {
  if (boundWindow && boundHandler && !boundWindow.isDestroyed()) {
    try {
      boundWindow.webContents.removeListener('did-finish-load', boundHandler)
    } catch {
      // Janela já em processo de fechamento.
    }
  }
  boundWindow = null
  boundHandler = null
}

function bindWindow(window: BrowserWindow): void {
  if (window === boundWindow) return
  unbind()
  boundWindow = window
  boundHandler = () => {
    send({ state, level })
  }
  window.webContents.on('did-finish-load', boundHandler)
}

function ensureBound(): void {
  const window = overlayWindow()
  if (window) bindWindow(window)
}

/** Estado vigente (também usado por testes/smoke). */
export function getAvatarStatus(): AvatarStatus {
  return { state, level }
}

/**
 * Atualiza o avatar a partir do main (task 06), sem passar por IPC.
 * O push `avatar:apply` mantém o overlay sincronizado; se a janela ainda não
 * existe, o `did-finish-load` reenvia o estado vigente.
 */
export function applyAvatarState(next: AvatarState): void {
  state = next
  send({ state })
}

/** Hook exclusivo de teste: solta a janela e volta ao estado inicial. */
export function resetAvatarIpcForTests(): void {
  unbind()
  unsubscribeCreated?.()
  unsubscribeCreated = null
  context = null
  state = 'idle'
  level = 0
  registered = false
}

export function registerAvatarIpc(ctx: IpcContext): void {
  if (registered) return
  registered = true
  context = ctx

  // A janela do overlay nasce sob demanda; o observador garante o bind mesmo
  // quando o registro do IPC acontece antes da primeira exibição.
  unsubscribeCreated = onOverlayWindowCreated((window) => bindWindow(window))
  ensureBound()

  ipcMain.handle(IPC.avatarSetState, (_event, payload: unknown): SimpleResult => {
    if (!isRecord(payload) || !isAvatarState(payload.state)) {
      return failure(`Payload inválido para ${IPC.avatarSetState}: ${describe(payload)}`)
    }
    state = payload.state
    send({ state })
    return { ok: true }
  })

  ipcMain.handle(IPC.avatarSetLevel, (_event, payload: unknown): SimpleResult => {
    if (
      !isRecord(payload) ||
      typeof payload.level !== 'number' ||
      !Number.isFinite(payload.level)
    ) {
      return failure(`Payload inválido para ${IPC.avatarSetLevel}: ${describe(payload)}`)
    }
    level = clampAvatarLevel(payload.level)
    send({ level })
    return { ok: true }
  })

  ipcMain.handle(IPC.avatarGetStatus, (_event, payload: unknown): AvatarGetStatusResult => {
    if (payload !== undefined && payload !== null) {
      return failure(`Payload inválido para ${IPC.avatarGetStatus}: ${describe(payload)}`)
    }
    ensureBound()
    return { ok: true, state, level }
  })
}
