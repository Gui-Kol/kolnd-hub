import type { IpcContext } from './lifecycle'
import { registerAppIpc } from './app'
import { registerOverlayIpc } from './overlay'

export type { IpcContext } from './lifecycle'

/**
 * Ponto único de registro dos módulos IPC.
 *
 * O módulo base (`app`) e o overlay (task 02) já têm handlers. Os módulos de
 * store/tema (tasks 05/11) e configurações (task 11) entram aqui quando
 * existirem.
 */
export function registerIpc(ctx: IpcContext): void {
  registerAppIpc(ctx)
  registerOverlayIpc()
}
