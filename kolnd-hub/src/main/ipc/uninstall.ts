import { ipcMain } from 'electron'
import {
  runHubUninstallSteps,
  isHubUninstallInProgress,
  lockMainWindowForUninstall,
  unlockMainWindowForUninstall,
  uninstaller
} from '../uninstaller'
import { shutdownHub } from './lifecycle'
import type { IpcContext } from './lifecycle'

export function registerUninstallHubIpc(ctx: IpcContext): void {
  // ── IPC: Desinstalar o Kolnd Hub (T5) ────────────
  // Orquestra: Kloud Games (fluxo T2) → backup (log) → spawn desanexado do
  // desinstalador NSIS → wipe opcional de %APPDATA%\kolnd-hub → encerramento
  // do Hub. Os eventos (progress/log/complete) fluem para o renderer pelo
  // registerUninstallIpc; aqui só validamos, executamos e decidimos o fechamento.
  ipcMain.handle('uninstall:hub', async (_event, rawArgs: unknown) => {
    if (uninstaller.isBusy() || isHubUninstallInProgress()) {
      return {
        success: false,
        error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
      }
    }

    // Janela travada durante TODA a sequência destrutiva (kloud → spawn → wipe).
    // Só destrava na saída: spawn concluído (o app fecha em seguida), erro
    // amigável, ou paused/choice (o usuário decide o próximo passo).
    lockMainWindowForUninstall()
    let result: Awaited<ReturnType<typeof runHubUninstallSteps>>
    try {
      result = await runHubUninstallSteps(rawArgs, (evt) => {
        ctx.getMainWindow()?.webContents.send('uninstall:progress', evt)
      })

      if (result.ok && result.spawned) {
        // O desinstalador NSIS já está desanexado rodando — agora encerramos o
        // Hub exatamente como app:shutdown (killAll + destroy + app.quit).
        await shutdownHub(ctx)
        return { success: true }
      }

      // Erro amigável (desinstalador não encontrado, spawn falhou) ou pausa
      // pedindo decisão ("desinstalar só o Hub?"): o app NÃO fecha e a UI
      // continua mostrando a(s) fase(s) do modal. Nada do wipe é desfeito.
      return {
        success: false,
        paused: result.paused ?? false,
        error: result.error,
        wipeErrors: result.wipeErrors
      }
    } finally {
      unlockMainWindowForUninstall()
    }
  })
}
