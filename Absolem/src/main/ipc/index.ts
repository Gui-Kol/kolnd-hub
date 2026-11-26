import type { IpcContext } from './lifecycle'
import { registerAppIpc } from './app'

export type { IpcContext } from './lifecycle'

/**
 * Ponto único de registro dos módulos IPC.
 *
 * Nesta task só o módulo base (`app`) tem handlers. Os módulos de overlay
 * (task 02), store/tema (tasks 05/11) e configurações (task 11) entram aqui
 * quando existirem.
 */
export function registerIpc(ctx: IpcContext): void {
  registerAppIpc(ctx)
}
