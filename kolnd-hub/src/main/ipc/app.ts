import { ipcMain, shell, app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { killProcessesForCommand } from '../processKiller'
import { invalidateKloudGamesRunningCache, stopKloudGamesElevated } from '../kloudGames'
import { isAnyUninstallInProgress } from '../uninstaller'
import { shutdownHub } from './lifecycle'
import type { IpcContext } from './lifecycle'
import { logger } from '../logger'

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

      return processManager.launch(trimmedId, trimmedCommand, trimmedCwd, {
        shell: useShell !== false
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
      if (!result.success) {
        // O Kloud Games é aberto elevado (ver kloud-games:launch), então ele não
        // é rastreado pelo processManager e um processo de alta integridade não
        // pode ser encerrado pelo Hub sem elevação. taskkill via UAC primeiro;
        // o fallback por nome só funciona quando o processo não é elevado.
        const elevated = await stopKloudGamesElevated()
        if (elevated.success) return elevated
        if (command) {
          const fallback = await killProcessesForCommand(command)
          if (fallback.success) return fallback
        }
        return elevated
      }
      return result
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

  // Abre `%APPDATA%/kolnd-hub/logs` no Explorer (05-5.7). Sem argumentos —
  // o caminho é sempre o do userData, nunca algo vindo do renderer.
  ipcMain.handle('app:open-logs-folder', async () => {
    try {
      const logsDir = join(app.getPath('userData'), 'logs')
      // shell.openPath falha silenciosamente se a pasta não existe ainda
      // (nenhum app com a pref ligada logou nesta máquina).
      mkdirSync(logsDir, { recursive: true })
      const failure = await shell.openPath(logsDir)
      return failure ? { success: false, error: failure } : { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('app', `app:open-logs-folder falhou: ${message}`)
      return { success: false, error: message }
    }
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
