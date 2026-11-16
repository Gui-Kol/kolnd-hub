import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import type { ProcessManager } from '../processManager'
import { isAnyUninstallInProgress } from '../uninstaller'

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
 */
export async function shutdownHub(ctx: IpcContext): Promise<void> {
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

/**
 * Exibe o popup de confirmação "Você quer encerrar o Hub?". Se o usuário
 * confirmar, encerra todos os processos e sai do aplicativo. Se cancelar,
 * nada acontece e a janela permanece aberta.
 */
export async function confirmAndQuit(ctx: IpcContext): Promise<void> {
  const mainWindow = ctx.getMainWindow()
  if (!mainWindow) return
  // Defesa extra: nunca abrir o fluxo de encerramento durante uma
  // desinstalação destrutiva (os chamadores já travam, mas a função é exportada no IPC).
  if (isAnyUninstallInProgress()) return
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Encerrar Kolnd Hub',
    message: 'Você quer encerrar o Hub?',
    detail:
      'Todos os programas e servidores iniciados pelo Kolnd Hub serão fechados, ' +
      'incluindo o que estiver rodando em segundo plano.',
    buttons: ['Sim', 'Não'],
    defaultId: 1,
    cancelId: 1
  })
  if (response === 0) {
    await shutdownHub(ctx)
  }
}
