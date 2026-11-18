import { dirname } from 'path'
import { ipcMain } from 'electron'
import {
  ensureKloudGamesInstalled,
  getKloudGamesStatus,
  invalidateKloudGamesRunningCache
} from '../kloudGames'
import type { IpcContext } from './lifecycle'

export function registerKloudGamesIpc(ctx: IpcContext): void {
  const processManager = ctx.processManager

  // ── IPC: Kloud Games ─────────────────────────────
  // Abrir: procura o .exe (estado salvo → pasta do Hub → Program Files).
  // Se não encontrar, abre o MSI embutido para instalação (UAC), detecta o
  // caminho do .exe e salva tudo em %APPDATA%\kolnd-hub\kloud-games.paths.json (userData;
  // o conteúdo legado em resources/programs/kloud-games é migrado automaticamente).
  ipcMain.handle('kloud-games:launch', async () => {
    const ensured = await ensureKloudGamesInstalled()
    if (!ensured.success || !ensured.exePath) {
      return { success: false, error: ensured.error ?? 'Kloud Games não está disponível.' }
    }

    const exePath = ensured.exePath
    const cwd = dirname(exePath)
    const launch = processManager.launch('kloud-games', `"${exePath}"`, cwd)
    if (launch.success) {
      invalidateKloudGamesRunningCache()
    }
    return {
      success: launch.success,
      error: launch.error,
      exePath,
      cwd,
      installedNow: ensured.installedNow ?? false
    }
  })

  // Status: retorna os caminhos salvos (usado pelo renderer ao abrir). O
  // principal é barato: escritas idênticas são elididas e o tasklist fica
  // cacheado por ~2 s (ver kloudGames.ts).
  ipcMain.handle('kloud-games:status', async () => {
    return getKloudGamesStatus()
  })
}
