import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  ACTION_LIMITS,
  isPermissionCategory,
  isPermissionDecision,
  setPermissionCategory
} from '../../shared/permissions'
import type {
  ActionsPauseResult,
  ActionsStatusResult,
  IpcError,
  PermissionsGetResult,
  SimpleResult
} from '../../shared/ipc'
import type { PermissionsState } from '../../shared/permissions'
import type { IpcContext } from './lifecycle'
import { setStoreValue } from '../store'

/**
 * Canais mínimos de permissões/pausa (task 08, T1).
 *
 * A UI completa é da task 11: aqui só existe o contrato que permite ler/alterar
 * uma categoria, pausar todas as ações e consultar o estado. Nenhuma ação é
 * executada por estes canais.
 */

export type StoreWriter = (value: unknown) => { success: boolean; error?: string }

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readPermissions(ctx: IpcContext): PermissionsState {
  return ctx.getStoreSnapshot().permissions
}

export function writePermissions(
  ctx: IpcContext,
  next: PermissionsState,
  writeStore: StoreWriter
): SimpleResult {
  const result = writeStore(next)
  if (!result.success) return failure(result.error ?? 'Falha ao salvar as permissões.')
  return { ok: true }
}

export function setPermissionFromPayload(
  ctx: IpcContext,
  payload: unknown,
  writeStore: StoreWriter
): SimpleResult {
  if (!isRecord(payload)) return failure(`Payload inválido para ${IPC.permissionsSet}.`)
  const { category, decision } = payload
  if (!isPermissionCategory(category)) return failure('Categoria de permissão desconhecida.')
  if (!isPermissionDecision(decision)) return failure('Decisão de permissão inválida.')
  const current = readPermissions(ctx)
  return writePermissions(ctx, setPermissionCategory(current, category, decision), writeStore)
}

export function setPausedFromPayload(
  ctx: IpcContext,
  payload: unknown,
  writeStore: StoreWriter
): ActionsPauseResult {
  if (!isRecord(payload) || typeof payload.paused !== 'boolean') {
    return failure(`Payload inválido para ${IPC.actionsPause}.`)
  }
  const current = readPermissions(ctx)
  const next = { ...current, paused: payload.paused }
  const result = writeStore(next)
  if (!result.success) return failure(result.error ?? 'Falha ao salvar a pausa.')
  return { ok: true, paused: next.paused }
}

export function actionStatus(ctx: IpcContext): ActionsStatusResult {
  const permissions = readPermissions(ctx)
  return {
    ok: true,
    status: {
      paused: permissions.paused,
      permissions,
      routines: ctx.getStoreSnapshot().routines,
      limits: { ...ACTION_LIMITS }
    }
  }
}

export function registerActionsIpc(ctx: IpcContext): void {
  const writeStore: StoreWriter = (value) => setStoreValue('permissions', value)

  ipcMain.handle(IPC.permissionsGet, (): PermissionsGetResult => {
    try {
      return { ok: true, permissions: readPermissions(ctx) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao ler as permissões: ${message}`)
    }
  })

  ipcMain.handle(IPC.permissionsSet, (_event, payload: unknown): SimpleResult =>
    setPermissionFromPayload(ctx, payload, writeStore)
  )

  ipcMain.handle(IPC.actionsPause, (_event, payload: unknown): ActionsPauseResult =>
    setPausedFromPayload(ctx, payload, writeStore)
  )

  ipcMain.handle(IPC.actionsStatus, (): ActionsStatusResult => actionStatus(ctx))
}
