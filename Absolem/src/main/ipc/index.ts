import type { IpcContext } from './lifecycle'
import { registerAppIpc } from './app'
import { registerAvatarIpc } from './avatar'
import { registerOverlayIpc } from './overlay'
import { registerThemeIpc } from './theme'

export type { IpcContext } from './lifecycle'

/**
 * Ponto único de registro dos módulos IPC.
 *
 * O módulo base (`app`), o overlay (task 02), o avatar (task 03) e o tema
 * (task 04) têm handlers. Os módulos de configurações/voz/memória entram na
 * task 11.
 */
export function registerIpc(ctx: IpcContext): void {
  registerAppIpc(ctx)
  registerOverlayIpc()
  registerAvatarIpc(ctx)
  registerThemeIpc(ctx)
}
