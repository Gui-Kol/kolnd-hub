import type { IpcContext } from './lifecycle'

/**
 * Reencaminha os eventos do ProcessManager para o renderer:
 * `status-change` → `app:status-changed`, `output` → `app:output`.
 */
export function registerProcessEvents(ctx: IpcContext): void {
  ctx.processManager.on('status-change', (appId: string, status: string) => {
    ctx.getMainWindow()?.webContents.send('app:status-changed', appId, status)
  })

  ctx.processManager.on('output', (appId: string, data: string) => {
    ctx.getMainWindow()?.webContents.send('app:output', appId, data)
  })
}
