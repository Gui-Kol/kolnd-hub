import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { AbsolemConfig } from '../../shared/config'
import { markQuitting } from '../quitState'

/**
 * Contexto compartilhado dos módulos IPC (`src/main/ipc/*.ts`).
 *
 * Os getters existem porque a janela principal (e a futura janela de overlay)
 * são reatribuídas durante o ciclo de vida; o snapshot do store é sempre
 * normalizado na leitura; e a flag de saída é consultada pelo `close`.
 */
export interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  getOverlayWindow: () => BrowserWindow | null
  getStoreSnapshot: () => AbsolemConfig
  isQuitting: () => boolean
}

/**
 * Encerramento explícito do app: marca a saída antes de destruir as janelas e
 * chamar `app.quit()`, para que os handlers de `close` não segurem o processo.
 * Nenhum segredo é lido nem gravado aqui.
 */
export function shutdownApp(ctx: IpcContext): void {
  markQuitting()
  const overlay = ctx.getOverlayWindow()
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  const main = ctx.getMainWindow()
  if (main && !main.isDestroyed()) main.destroy()
  app.quit()
}
