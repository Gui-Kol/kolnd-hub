import { ipcMain } from 'electron'
import {
  getGames,
  addGame,
  addCustomGame,
  updateGame,
  checkExePaths,
  removeGame,
  removeGames,
  getGameCollections,
  createGameCollection
} from './store'
import type { Game, AddCustomGameResult, CreateCollectionResult, RemoveGamesResult } from './store'
import type { GameResult } from './naming'
import {
  pickGameIcon,
  setGameIcon,
  previewExeIcon,
  restoreExeIcon,
  getGameIcon,
  reloadGameIcons,
  refreshGameIcons
} from './icons'
import type { PickIconResult, IconPathResult, PreviewExeIconResult } from './icons'
import { pickGameCover, setGameCover, getGameCover } from './covers'
import type { PickCoverResult, CoverPathResult } from './covers'
import type { ReloadIconsResult, RefreshIconsResult } from './iconReload'
import { launchGame, stopGame, runningGamesMap, startPlaytimeMonitoring } from './launch'
import type { LaunchGameResult } from './launch'

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
export { formatGameName } from './naming'
export type { GameResult } from './naming'
export {
  gameIconsDir,
  extractIconPng,
  pickGameIcon,
  setGameIcon,
  previewExeIcon,
  restoreExeIcon,
  getGameIcon,
  reloadGameIcons,
  refreshGameIcons,
  repairGameIconsIfNeeded,
  GAME_ICON_PIPELINE_VERSION
} from './icons'
export type { PickIconResult, IconPathResult, PreviewExeIconResult } from './icons'
export { pickGameCover, setGameCover, getGameCover } from './covers'
export type { PickCoverResult, CoverPathResult } from './covers'
export type { ReloadIconsResult, RefreshIconsResult } from './iconReload'
export {
  findGameProcesses,
  launchGame,
  stopGame,
  runningGamesMap,
  startPlaytimeMonitoring,
  flushPlaytimeTracking,
  playtimeTracker
} from './launch'
export type { LaunchGameResult, GameProcess } from './launch'
export {
  getGames,
  addGame,
  addCustomGame,
  updateGame,
  checkExePaths,
  removeGame,
  removeGames,
  getGameCollections,
  createGameCollection
} from './store'
export type { Game, AddCustomGameResult, CreateCollectionResult, RemoveGamesResult } from './store'

/** Registra os canais IPC da biblioteca de jogos. */
export function registerGamesIpc(): void {
  // Tick de 20 s do tempo de jogo (uma listagem de processos por tick, e só
  // enquanto houver sessão aberta pelo Hub).
  startPlaytimeMonitoring()

  ipcMain.handle('games:get', (): Game[] => getGames())

  ipcMain.handle('games:add', (_event, input: unknown): GameResult => addGame(input))

  ipcMain.handle('games:add-custom', (_event, exePath: unknown): Promise<AddCustomGameResult> =>
    addCustomGame(exePath)
  )

  ipcMain.handle('games:update', (_event, id: unknown, patch: unknown): GameResult =>
    updateGame(id, patch)
  )

  ipcMain.handle('games:collections', (): string[] => getGameCollections())

  ipcMain.handle('games:collection-create', (_event, name: unknown): CreateCollectionResult =>
    createGameCollection(name)
  )

  ipcMain.handle('games:pick-icon', (): Promise<PickIconResult> => pickGameIcon())

  ipcMain.handle('games:set-icon', (_event, id: unknown, dataUrl: unknown): IconPathResult =>
    setGameIcon(id, dataUrl)
  )

  ipcMain.handle('games:pick-cover', (): Promise<PickCoverResult> => pickGameCover())

  ipcMain.handle('games:set-cover', (_event, id: unknown, dataUrl: unknown): CoverPathResult =>
    setGameCover(id, dataUrl)
  )

  ipcMain.handle('games:get-cover', (_event, id: unknown): string | null => getGameCover(id))

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

  ipcMain.handle('games:remove-many', (_event, ids: unknown): RemoveGamesResult => removeGames(ids))

  ipcMain.handle('games:launch', (_event, id: unknown): Promise<LaunchGameResult> => launchGame(id))

  ipcMain.handle(
    'games:stop',
    (_event, id: unknown): Promise<{ ok: boolean; error?: string; killed?: number }> => stopGame(id)
  )

  ipcMain.handle('games:running-map', (_event, ids: unknown) => runningGamesMap(ids))

  ipcMain.handle('games:get-icon', (_event, id: unknown): string | null => getGameIcon(id))

  // Sem argumentos: o main resolve a lista e re-extrai só os ícones ilegíveis.
  ipcMain.handle('games:reload-icons', (): Promise<ReloadIconsResult> => reloadGameIcons())

  // Sem argumentos: ação explícita do usuário ("Atualizar todos os ícones") —
  // re-extrai o ícone de TODOS os jogos, sobrescrevendo os escolhidos à mão.
  ipcMain.handle('games:refresh-icons', (): Promise<RefreshIconsResult> => refreshGameIcons())
}
