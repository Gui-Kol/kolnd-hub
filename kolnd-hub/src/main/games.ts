import { ipcMain } from 'electron'
import {
  getGames,
  addGame,
  addCustomGame,
  updateGame,
  checkExePaths,
  removeGame
} from './games/store'
import type { Game, AddCustomGameResult } from './games/store'
import type { GameResult } from './games/naming'
import {
  pickGameIcon,
  setGameIcon,
  previewExeIcon,
  restoreExeIcon,
  getGameIcon
} from './games/icons'
import type { PickIconResult, IconPathResult, PreviewExeIconResult } from './games/icons'
import { launchGame, stopGame, runningGamesMap } from './games/launch'
import type { LaunchGameResult } from './games/launch'

/**
 * Biblioteca de jogos do Kolnd Hub.
 *
 * Persistência canônica no electron-store (chave `games`, ver store.ts) —
 * nunca localStorage nem JSON solto. Os ícones extraídos ficam em
 * `%APPDATA%/kolnd-hub/game-icons/` e o `iconPath` gravado no jogo é sempre
 * um caminho absoluto dentro dessa pasta (defesa contra leitura arbitrária
 * de arquivos via IPC comprometido).
 *
 * IMPORTANTE: `games:launch` faz spawn direto do exe (ou, se o jogo já
 * estiver aberto, traz a janela dele para o primeiro plano em vez de abrir
 * outra instância). Não reutiliza o ProcessManager (`app:launch`) de
 * propósito — jogos não contam como "apps gerenciados em execução" e não
 * devem inflacionar o contador do Layout.
 */

/** Re-exporta o que saiu para games/naming.ts, games/icons.ts, games/launch.ts e games/store.ts, mantendo a superfície pública de './games'. */
export { formatGameName } from './games/naming'
export type { GameResult } from './games/naming'
export {
  gameIconsDir,
  extractIconPng,
  pickGameIcon,
  setGameIcon,
  previewExeIcon,
  restoreExeIcon,
  getGameIcon
} from './games/icons'
export type { PickIconResult, IconPathResult, PreviewExeIconResult } from './games/icons'
export { findGameProcesses, launchGame, stopGame, runningGamesMap } from './games/launch'
export type { LaunchGameResult, GameProcess } from './games/launch'
export {
  getGames,
  addGame,
  addCustomGame,
  updateGame,
  checkExePaths,
  removeGame
} from './games/store'
export type { Game, AddCustomGameResult } from './games/store'

/** Registra os canais IPC da biblioteca de jogos. */
export function registerGamesIpc(): void {
  ipcMain.handle('games:get', (): Game[] => getGames())

  ipcMain.handle('games:add', (_event, input: unknown): GameResult => addGame(input))

  ipcMain.handle('games:add-custom', (_event, exePath: unknown): Promise<AddCustomGameResult> =>
    addCustomGame(exePath)
  )

  ipcMain.handle('games:update', (_event, id: unknown, patch: unknown): GameResult =>
    updateGame(id, patch)
  )

  ipcMain.handle('games:pick-icon', (): Promise<PickIconResult> => pickGameIcon())

  ipcMain.handle('games:set-icon', (_event, id: unknown, dataUrl: unknown): IconPathResult =>
    setGameIcon(id, dataUrl)
  )

  ipcMain.handle(
    'games:preview-exe-icon',
    (_event, exePath: unknown): Promise<PreviewExeIconResult> => previewExeIcon(exePath)
  )

  ipcMain.handle(
    'games:restore-exe-icon',
    (_event, id: unknown, exePath?: unknown): Promise<IconPathResult> => restoreExeIcon(id, exePath)
  )

  ipcMain.handle('games:check-exes', (_event, paths: unknown): boolean[] => checkExePaths(paths))

  ipcMain.handle('games:remove', (_event, id: unknown): GameResult => removeGame(id))

  ipcMain.handle('games:launch', (_event, id: unknown): Promise<LaunchGameResult> => launchGame(id))

  ipcMain.handle(
    'games:stop',
    (_event, id: unknown): Promise<{ ok: boolean; error?: string; killed?: number }> => stopGame(id)
  )

  ipcMain.handle('games:running-map', (_event, ids: unknown) => runningGamesMap(ids))

  ipcMain.handle('games:get-icon', (_event, id: unknown): string | null => getGameIcon(id))
}
