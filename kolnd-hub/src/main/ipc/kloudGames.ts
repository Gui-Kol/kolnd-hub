import { dirname } from 'path'
import { ipcMain } from 'electron'
import {
  ensureKloudGamesInstalled,
  getKloudGamesStatus,
  invalidateKloudGamesRunningCache,
  launchKloudGamesElevated
} from '../kloudGames'
import type { IpcContext } from './lifecycle'

export function registerKloudGamesIpc(_ctx: IpcContext): void {
  // ── IPC: Kloud Games ─────────────────────────────
  // Abrir: procura o .exe (estado salvo → pasta do Hub → Program Files).
  // Se não encontrar, abre o MSI embutido para instalação (UAC), detecta o
  // caminho do .exe e salva tudo em %APPDATA%\kolnd-hub\kloud-games.paths.json (userData;
  // o conteúdo legado em resources/programs/kloud-games é migrado automaticamente).
  //
  // O app é SEMPRE aberto elevado (UAC), em qualquer conta do Windows: o estado
  // dele fica em C:\Program Files\KLOUD_GAMES\config e o certificado em
  // config\credentials não é legível por usuários comuns — sem elevação o
  // KLOUD_GAMES morre com `use_certificate_chain_file: Acesso negado`.
  ipcMain.handle('kloud-games:launch', async () => {
    const ensured = await ensureKloudGamesInstalled()
    if (!ensured.success || !ensured.exePath) {
      return { success: false, error: ensured.error ?? 'Kloud Games não está disponível.' }
    }

    const exePath = ensured.exePath
    const launch = await launchKloudGamesElevated(exePath)
    if (launch.success) {
      invalidateKloudGamesRunningCache()
    }
    return {
      success: launch.success,
      error: launch.error,
      exePath,
      cwd: dirname(exePath),
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
