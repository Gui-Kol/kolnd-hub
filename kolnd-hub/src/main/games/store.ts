import { existsSync, rmSync, statSync } from 'fs'
import { basename, extname, isAbsolute, join } from 'path'
import {
  getStoredGames,
  setStoredGames,
  getGameCollections,
  setGameCollections,
  normalizeGame,
  normalizeGameCollections,
  MAX_GAME_COLLECTIONS,
  MAX_GAME_COLLECTION_TAGS,
  GameOrigin
} from '../store'
import {
  formatGameName,
  exePathHash,
  isValidId,
  isValidExePath,
  EXE_PATH_MAX_LENGTH,
  GameResult
} from './naming'
import {
  gameIconsDir,
  resolveIconInsideGameIcons,
  deleteStaleIcons,
  extractIconPng,
  deleteCachedIcon
} from './icons'
import { resolveCoverInsideGameCovers, deleteStaleCovers, deleteCachedCover } from './covers'
import { logger } from '../logger'

/**
 * Modelo Game e CRUD da biblioteca de jogos (persistência no electron-store
 * via ./store — nunca localStorage nem JSON solto).
 * Extraído de main/games.ts — nenhuma mudança de comportamento.
 */

export interface Game {
  id: string
  name: string
  exePath: string
  iconPath: string | null
  origin: GameOrigin
  steamAppId?: number
  addedAt: string
  favorite?: boolean
  collections?: string[]
  playtimeSeconds?: number
  playtimeDays?: Record<string, number>
  lastPlayedAt?: string
  coverPath?: string | null
}

/** Resultado de `games:collection-create` — inclui a lista atualizada. */
export interface CreateCollectionResult extends GameResult {
  collections?: string[]
}

/** Resultado de `games:add-custom` — inclui o nome formatado para o toast de confirmação. */
export interface AddCustomGameResult extends GameResult {
  id?: string
  name?: string
}

export function getGames(): Game[] {
  return getStoredGames()
}

/** Reexporta a leitura das coleções (mesma fonte da chave `gameCollections`). */
export { getGameCollections } from '../store'

/**
 * Cria uma coleção nova (`games:collection-create`). Deduplica sem diferenciar
 * caixa, respeita o cap de 30 e devolve a lista atualizada para a UI.
 */
export function createGameCollection(nameInput: unknown): CreateCollectionResult {
  const invalidError = 'Informe um nome de coleção entre 1 e 24 caracteres.'
  if (typeof nameInput !== 'string') return { success: false, error: invalidError }
  const [name] = normalizeGameCollections([nameInput], 1)
  if (!name) return { success: false, error: invalidError }

  const current = getGameCollections()
  const key = name.toLowerCase()
  if (current.some((collection) => collection.toLowerCase() === key)) {
    return { success: false, error: 'Já existe uma coleção com esse nome.', collections: current }
  }
  if (current.length >= MAX_GAME_COLLECTIONS) {
    return {
      success: false,
      error: `Você já tem o máximo de ${MAX_GAME_COLLECTIONS} coleções.`,
      collections: current
    }
  }

  const next = [...current, name]
  const saved = setGameCollections(next)
  if (!saved.success) {
    return {
      success: false,
      error: saved.error ?? 'Não foi possível criar a coleção.',
      collections: current
    }
  }
  logger.info('games', `Coleção criada: ${name}`)
  return { success: true, collections: next }
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
const PATCHABLE_FIELDS = [
  'name',
  'exePath',
  'iconPath',
  'origin',
  'steamAppId',
  'favorite',
  'collections',
  'coverPath'
] as const

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
        if (value !== 'steam' && value !== 'epic' && value !== 'minecraft' && value !== 'custom') {
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
      case 'favorite':
        if (typeof value !== 'boolean') {
          return { success: false, error: 'Valor inválido para favorito.' }
        }
        merged.favorite = value
        break
      case 'collections':
        if (!Array.isArray(value)) {
          return { success: false, error: 'Lista de coleções inválida.' }
        }
        merged.collections = normalizeGameCollections(value, MAX_GAME_COLLECTION_TAGS)
        break
      case 'coverPath':
        // null limpa a capa (o card volta ao ícone/fallback visual).
        if (value === null) {
          merged.coverPath = null
          break
        }
        {
          const resolved = resolveCoverInsideGameCovers(value)
          if (!resolved) {
            return {
              success: false,
              error: 'A capa deve estar dentro da pasta de capas do Kolnd Hub.'
            }
          }
          merged.coverPath = resolved
        }
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

  // Capa trocada/limpa: depois de persistir com sucesso, apaga o arquivo antigo
  // (se estava na pasta de capas e não é mais o referenciado) e sobras do id.
  if ('coverPath' in raw) {
    const resolvedNew = resolveCoverInsideGameCovers(updated.coverPath)
    const resolvedOld = resolveCoverInsideGameCovers(current.coverPath)
    if (resolvedOld && resolvedOld !== resolvedNew) {
      try {
        rmSync(resolvedOld, { force: true })
      } catch (err) {
        logger.warn('games', `Não foi possível apagar a capa antiga ${resolvedOld}:`, err)
      }
    }
    deleteStaleCovers(updated.id, resolvedNew)
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
  deleteCachedCover(removed)
  logger.info('games', `Jogo removido: ${removed.name} (${removed.id})`)
  return { success: true }
}
