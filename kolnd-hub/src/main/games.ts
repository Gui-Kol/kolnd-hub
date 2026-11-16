import { ipcMain } from 'electron'
import { existsSync, rmSync, statSync } from 'fs'
import { basename, extname, isAbsolute, join } from 'path'
import { getStoredGames, setStoredGames, normalizeGame, GameOrigin } from './store'
import {
  formatGameName,
  exePathHash,
  isValidId,
  isValidExePath,
  EXE_PATH_MAX_LENGTH,
  GameResult
} from './games/naming'
import { logger } from './logger'
import {
  gameIconsDir,
  resolveIconInsideGameIcons,
  deleteStaleIcons,
  extractIconPng,
  deleteCachedIcon,
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

export interface Game {
  id: string
  name: string
  exePath: string
  iconPath: string | null
  origin: GameOrigin
  steamAppId?: number
  addedAt: string
}

/** Re-exporta o que saiu para games/naming.ts e games/icons.ts, mantendo a superfície pública de './games'. */
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

/** Resultado de `games:add-custom` — inclui o nome formatado para o toast de confirmação. */
export interface AddCustomGameResult extends GameResult {
  id?: string
  name?: string
}

export function getGames(): Game[] {
  return getStoredGames()
}

export function addGame(input: unknown): GameResult {
  const game = normalizeGame(input)
  if (!game) {
    return {
      success: false,
      error: 'Dados do jogo inválidos (id, nome e executável são obrigatórios).'
    }
  }
  if (game.iconPath) {
    // Ícone fora da pasta canônica seria uma leitura arbitrária via get-icon.
    const resolved = resolveIconInsideGameIcons(game.iconPath)
    if (!resolved) {
      return { success: false, error: 'O ícone deve estar dentro da pasta de ícones do Kolnd Hub.' }
    }
    game.iconPath = resolved
  }

  const games = getStoredGames()
  if (games.some((g) => g.id === game.id)) {
    return { success: false, error: 'Já existe um jogo com este identificador.' }
  }
  if (game.steamAppId !== undefined && games.some((g) => g.steamAppId === game.steamAppId)) {
    return { success: false, error: 'Este jogo da Steam já está na sua biblioteca.' }
  }
  const exeKey = game.exePath.toLowerCase()
  if (games.some((g) => g.exePath.toLowerCase() === exeKey)) {
    return { success: false, error: 'Este executável já está na sua biblioteca.' }
  }

  const saved = setStoredGames([...games, game])
  if (!saved.success) {
    return { success: false, error: saved.error ?? 'Não foi possível salvar o jogo.' }
  }
  logger.info('games', `Jogo adicionado: ${game.name} (${game.id})`)
  return { success: true }
}

/**
 * Adiciona um jogo personalizado a partir do caminho absoluto de um .exe
 * escolhido pelo usuário (seletor nativo via `dialog:pick-path`).
 * O exe NÃO é copiado — o caminho gravado é o original. O ícone embutido é
 * extraído para `game-icons/custom_<hash>.png` (hash do caminho, igual ao
 * `id` `custom-<hash>`, tornando o fluxo idempotente).
 */
export async function addCustomGame(exePathInput: unknown): Promise<AddCustomGameResult> {
  if (!isValidExePath(exePathInput)) {
    return { success: false, error: 'Caminho do executável inválido.' }
  }
  const exePath = (exePathInput as string).trim()
  if (!isAbsolute(exePath)) {
    return { success: false, error: 'Escolha um caminho absoluto para o executável.' }
  }
  if (extname(exePath).toLowerCase() !== '.exe') {
    return { success: false, error: 'Escolha um arquivo .exe do jogo.' }
  }
  try {
    const stat = statSync(exePath)
    if (!stat.isFile()) {
      return { success: false, error: 'O caminho escolhido não é um arquivo.' }
    }
  } catch {
    return { success: false, error: `Executável não encontrado: ${exePath}` }
  }

  const hash = exePathHash(exePath)
  const id = `custom-${hash}`
  const name = formatGameName(basename(exePath, extname(exePath)))

  // Já está na biblioteca? Falha com mensagem clara em vez de um erro de id.
  const existing = getStoredGames()
  const exeKey = exePath.toLowerCase()
  if (existing.some((g) => g.id === id || g.exePath.toLowerCase() === exeKey)) {
    return { success: false, error: 'Este jogo já está na sua biblioteca.' }
  }

  const iconPath = join(gameIconsDir(), `custom_${hash}.png`)
  const iconOk = await extractIconPng(exePath, iconPath)

  const result = addGame({
    id,
    name,
    exePath,
    iconPath: iconOk ? iconPath : null,
    origin: 'custom',
    addedAt: new Date().toISOString()
  })
  if (!result.success) {
    return { success: false, error: result.error ?? 'Não foi possível adicionar o jogo.' }
  }
  logger.info('games', `Jogo personalizado adicionado: ${name} (${exePath})`)
  return { success: true, id, name }
}

/** Verifica, em lote, quais executáveis existem no disco (selo ".exe não encontrado"). */
export function checkExePaths(pathsInput: unknown): boolean[] {
  if (!Array.isArray(pathsInput)) return []
  return pathsInput.slice(0, 500).map((entry) => {
    if (typeof entry !== 'string') return false
    const trimmed = entry.trim()
    if (!trimmed || trimmed.length > EXE_PATH_MAX_LENGTH) return false
    try {
      return existsSync(trimmed)
    } catch {
      return false
    }
  })
}

/** Campos do patch que o renderer pode alterar (whitelist). */
const PATCHABLE_FIELDS = ['name', 'exePath', 'iconPath', 'origin', 'steamAppId'] as const

export function updateGame(id: unknown, patch: unknown): GameResult {
  if (!isValidId(id)) {
    return { success: false, error: 'Identificador do jogo inválido.' }
  }
  const trimmedId = id.trim()
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { success: false, error: 'Alterações inválidas.' }
  }

  const games = getStoredGames()
  const index = games.findIndex((g) => g.id === trimmedId)
  if (index === -1) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  const current = games[index]
  const raw = patch as Record<string, unknown>
  const merged: Record<string, unknown> = { ...current }

  for (const field of PATCHABLE_FIELDS) {
    if (!(field in raw)) continue
    const value = raw[field]
    switch (field) {
      case 'name':
        if (typeof value !== 'string' || !value.trim()) {
          return { success: false, error: 'O nome do jogo não pode ficar vazio.' }
        }
        merged.name = value.trim()
        break
      case 'exePath':
        if (!isValidExePath(value)) {
          return { success: false, error: 'Caminho do executável inválido.' }
        }
        merged.exePath = (value as string).trim()
        break
      case 'iconPath':
        // null limpa o ícone (o card cai no fallback visual).
        if (value === null) {
          merged.iconPath = null
          break
        }
        {
          const resolved = resolveIconInsideGameIcons(value)
          if (!resolved) {
            return {
              success: false,
              error: 'O ícone deve estar dentro da pasta de ícones do Kolnd Hub.'
            }
          }
          merged.iconPath = resolved
        }
        break
      case 'origin':
        if (value !== 'steam' && value !== 'custom') {
          return { success: false, error: 'Origem do jogo inválida.' }
        }
        merged.origin = value
        break
      case 'steamAppId':
        if (value === null) {
          delete merged.steamAppId
          break
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
          return { success: false, error: 'steamAppId inválido.' }
        }
        merged.steamAppId = value
        break
    }
  }

  const updated = normalizeGame(merged)
  if (!updated) {
    return { success: false, error: 'Dados do jogo inválidos após a alteração.' }
  }

  games[index] = updated
  const saved = setStoredGames(games)
  if (!saved.success) {
    return { success: false, error: saved.error ?? 'Não foi possível salvar as alterações.' }
  }

  // Ícone trocado/limpo: depois de persistir com sucesso, apaga o arquivo
  // antigo (se estava na pasta de ícones e não é mais o referenciado) e
  // quaisquer sobras `<base-do-id>.<ext>` da imagem anterior.
  if ('iconPath' in raw) {
    const resolvedNew = resolveIconInsideGameIcons(updated.iconPath)
    const resolvedOld = resolveIconInsideGameIcons(current.iconPath)
    if (resolvedOld && resolvedOld !== resolvedNew) {
      try {
        rmSync(resolvedOld, { force: true })
      } catch (err) {
        logger.warn('games', `Não foi possível apagar o ícone antigo ${resolvedOld}:`, err)
      }
    }
    deleteStaleIcons(updated.id, resolvedNew)
  }
  logger.info('games', `Jogo atualizado: ${updated.name} (${updated.id})`)
  return { success: true }
}

export function removeGame(id: unknown): GameResult {
  if (!isValidId(id)) {
    return { success: false, error: 'Identificador do jogo inválido.' }
  }
  const trimmedId = id.trim()
  const games = getStoredGames()
  const index = games.findIndex((g) => g.id === trimmedId)
  if (index === -1) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  const [removed] = games.splice(index, 1)
  const saved = setStoredGames(games)
  if (!saved.success) {
    return { success: false, error: saved.error ?? 'Não foi possível remover o jogo.' }
  }

  // Só apaga o ícone cacheado DEPOIS de persistir a remoção.
  deleteCachedIcon(removed)
  logger.info('games', `Jogo removido: ${removed.name} (${removed.id})`)
  return { success: true }
}

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
