import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { ProcessManager } from '../processManager'
import { markQuitting } from '../quitState'

/**
 * Contexto compartilhado dos módulos IPC (`ipc/*.ts`): acesso à janela
 * principal (via getter — `mainWindow` é reassinado em `createWindow`) e ao
 * ProcessManager, dono de todos os processos lançados pelo Hub.
 */
export interface IpcContext {
  getMainWindow: () => BrowserWindow | null
  processManager: ProcessManager
}

/**
 * Encerra completamente o Kolnd Hub: mata todos os processos lançados pelo
 * Hub (incluindo servidores e processos em segundo plano) e fecha a janela
 * e o próprio Electron (app.quit). Garante que nada do Hub fique aberto.
 *
 * Único caminho de encerramento pela UI: Mais → Encerrar Hub (modal) e o
 * Sair da bandeja (que usa killAll + app.quit direto). O X/Alt+F4 apenas
 * oculta a janela — por isso o flag de saída é marcado antes de destruir.
 */
export async function shutdownHub(ctx: IpcContext): Promise<void> {
  markQuitting()
  try {
    ctx.processManager.killAll()
  } catch {
    // Ignora erros ao matar processos; ainda assim queremos sair.
  }
  const mainWindow = ctx.getMainWindow()
  if (mainWindow) {
    mainWindow.destroy()
  }
  app.quit()
}
