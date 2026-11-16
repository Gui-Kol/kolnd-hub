import { ipcMain } from 'electron'
import { killProcessesForCommand } from '../processKiller'
import { invalidateKloudGamesRunningCache } from '../kloudGames'
import { getMarkLviDataDir } from '../programsDeployer'
import { isAnyUninstallInProgress } from '../uninstaller'
import { shutdownHub } from './lifecycle'
import type { IpcContext } from './lifecycle'

export function registerAppIpc(ctx: IpcContext): void {
  // ── IPC: App management ─────────────────────────
  const processManager = ctx.processManager

  ipcMain.handle(
    'app:launch',
    async (_event, appId: unknown, command: unknown, cwd: unknown, useShell?: unknown) => {
      // O renderer pode estar comprometido (XSS) — valide tudo que chega por IPC.
      if (typeof appId !== 'string' || typeof command !== 'string' || typeof cwd !== 'string') {
        return { success: false, error: 'Parâmetros inválidos para app:launch' }
      }
      const trimmedId = appId.trim()
      const trimmedCommand = command.trim()
      const trimmedCwd = cwd.trim()
      if (!trimmedId || trimmedId.length > 100) {
        return { success: false, error: 'appId inválido' }
      }
      if (!trimmedCommand || trimmedCommand.length > 4096) {
        return { success: false, error: 'Comando vazio ou longo demais' }
      }
      if (trimmedCwd.length > 1024) {
        return { success: false, error: 'Diretório de trabalho longo demais' }
      }

      // Mark LVI: dados do usuário (chave de API, memória) ficam em
      // %APPDATA%/kolnd-hub/mark-lvi, não ao lado do .exe empacotado.
      const env = trimmedId === 'mark-lvi' ? { MARK_LVI_HOME: getMarkLviDataDir() } : undefined

      return processManager.launch(trimmedId, trimmedCommand, trimmedCwd, {
        shell: useShell !== false,
        env
      })
    }
  )

  ipcMain.handle('app:stop', async (_event, appId: unknown, command?: unknown) => {
    if (typeof appId !== 'string' || (command !== undefined && typeof command !== 'string')) {
      return { success: false, error: 'Parâmetros inválidos para app:stop' }
    }
    const result = await processManager.stop(appId)
    if (appId === 'kloud-games') {
      invalidateKloudGamesRunningCache()
    }
    if (result.success || !command) return result
    // O Hub só conhece processos que ele mesmo iniciou nesta sessão. Se o
    // programa está rodando em segundo plano (ex.: Hub reiniciado e o
    // processo ficou órfão), encerra pelo executável do comando.
    return killProcessesForCommand(command)
  })

  ipcMain.handle('app:status', async (_event, appId: unknown) => {
    if (typeof appId !== 'string') return { status: 'stopped', logCount: 0 }
    return processManager.getStatus(appId)
  })

  ipcMain.handle('app:all-status', async () => {
    return processManager.getAllStatus()
  })

  ipcMain.handle('app:logs', async (_event, appId: unknown) => {
    if (typeof appId !== 'string') return ''
    return processManager.getLogs(appId)
  })

  ipcMain.handle('app:shutdown', async () => {
    // Trava de reentrância: durante uma desinstalação destrutiva nenhum
    // caminho (Sair, tray, IPC direto) derruba o app no meio do msiexec/wipe.
    if (isAnyUninstallInProgress()) {
      return {
        success: false,
        error: 'Uma desinstalação está em andamento — aguarde o término.'
      }
    }
    await shutdownHub(ctx)
    return { success: true }
  })
}
