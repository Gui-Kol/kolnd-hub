import { app, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import {
  getStoredGames,
  setStoredGames,
  normalizeGame,
  StoredGame,
  GameOrigin
} from './store'

/**
 * Biblioteca de jogos do Kolnd Hub.
 *
 * Persistência canônica no electron-store (chave `games`, ver store.ts) —
 * nunca localStorage nem JSON solto. Os ícones extraídos ficam em
 * `%APPDATA%/kolnd-hub/game-icons/` e o `iconPath` gravado no jogo é sempre
 * um caminho absoluto dentro dessa pasta (defesa contra leitura arbitrária
 * de arquivos via IPC comprometido).
 *
 * IMPORTANTE: `games:launch` faz spawn direto do exe. Não reutiliza o
 * ProcessManager (`app:launch`) de propósito — jogos não contam como
 * "apps gerenciados em execução" e não devem inflacionar o contador do Layout.
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

export interface GameResult {
  success: boolean
  error?: string
}

const GAME_ID_MAX_LENGTH = 200
const EXE_PATH_MAX_LENGTH = 1024
/** Ícones são pequenos; qualquer coisa maior que isso não é um ícone válido. */
const ICON_MAX_BYTES = 4 * 1024 * 1024

/** Pasta canônica de ícones cacheados dos jogos. */
export function gameIconsDir(): string {
  return join(app.getPath('userData'), 'game-icons')
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0 && id.trim().length <= GAME_ID_MAX_LENGTH
}

function isValidExePath(exePath: unknown): exePath is string {
  return (
    typeof exePath === 'string' &&
    exePath.trim().length > 0 &&
    exePath.trim().length <= EXE_PATH_MAX_LENGTH
  )
}

/**
 * Aceita apenas caminhos absolutos que apontem para dentro da pasta de
 * ícones do Hub. Devolve o caminho resolvido, ou null se for de fora.
 */
function resolveIconInsideGameIcons(iconPath: unknown): string | null {
  if (typeof iconPath !== 'string') return null
  const trimmed = iconPath.trim()
  if (!trimmed || !isAbsolute(trimmed)) return null
  const dir = resolve(gameIconsDir())
  const target = resolve(trimmed)
  const rel = relative(dir, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

function iconMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.png':
    default:
      return 'image/png'
  }
}

/** Lê um PNG/JPG/WebP do disco e devolve um dataURL (ou null em qualquer falha). */
function readIconAsDataUrl(filePath: string): string | null {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size === 0 || stat.size > ICON_MAX_BYTES) return null
    const buffer = readFileSync(filePath)
    if (buffer.length === 0) return null
    return `data:${iconMimeType(filePath)};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

/** Candidatos de ícone para um jogo, em ordem de prioridade. */
function iconCandidates(game: StoredGame): string[] {
  const candidates: string[] = []
  const fromPath = resolveIconInsideGameIcons(game.iconPath)
  if (fromPath) candidates.push(fromPath)
  candidates.push(join(gameIconsDir(), `${game.id}.png`))
  return candidates
}

export function getGames(): Game[] {
  return getStoredGames()
}

/**
 * Extrai o ícone embutido de um executável e grava como PNG em `pngPath`.
 * Devolve `true` em sucesso; `false` (sem lançar) quando o exe não tem
 * ícone utilizável — o card cai no fallback visual. Compartilhado entre a
 * importação da Steam (steamScanner) e a adição de jogos personalizados.
 */
export async function extractIconPng(exePath: string, pngPath: string): Promise<boolean> {
  try {
    const image = await app.getFileIcon(exePath, { size: 'large' })
    if (image.isEmpty()) return false
    const png = image.toPNG()
    if (png.length === 0) return false
    mkdirSync(dirname(pngPath), { recursive: true })
    writeFileSync(pngPath, png)
    return true
  } catch (err) {
    console.warn(`[games] Não foi possível extrair o ícone de ${exePath}:`, err)
    return false
  }
}

export function addGame(input: unknown): GameResult {
  const game = normalizeGame(input)
  if (!game) {
    return { success: false, error: 'Dados do jogo inválidos (id, nome e executável são obrigatórios).' }
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
  console.log(`[games] Jogo adicionado: ${game.name} (${game.id})`)
  return { success: true }
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
            return { success: false, error: 'O ícone deve estar dentro da pasta de ícones do Kolnd Hub.' }
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
  console.log(`[games] Jogo atualizado: ${updated.name} (${updated.id})`)
  return { success: true }
}

/** Apaga o ícone cacheado do jogo (se houver). Best-effort: nunca lança. */
function deleteCachedIcon(game: StoredGame): void {
  const candidates = iconCandidates(game)
  for (const candidate of candidates) {
    try {
      rmSync(candidate, { force: true })
    } catch (err) {
      console.warn(`[games] Não foi possível apagar o ícone ${candidate}:`, err)
    }
  }
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
  console.log(`[games] Jogo removido: ${removed.name} (${removed.id})`)
  return { success: true }
}

export function getGameIcon(id: unknown): string | null {
  if (!isValidId(id)) return null
  const trimmedId = id.trim()
  const game = getStoredGames().find((g) => g.id === trimmedId)
  if (!game) return null
  for (const candidate of iconCandidates(game)) {
    if (!existsSync(candidate)) continue
    const dataUrl = readIconAsDataUrl(candidate)
    if (dataUrl) return dataUrl
  }
  return null
}

/**
 * Lança o jogo com spawn direto (sem ProcessManager): desanexado, fora do
 * contador de apps ativos do Hub e sem rastreamento de "em execução".
 */
export function launchGame(id: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!isValidId(id)) {
    return Promise.resolve({ ok: false, error: 'Identificador do jogo inválido.' })
  }
  const trimmedId = id.trim()
  const game = getStoredGames().find((g) => g.id === trimmedId)
  if (!game) {
    return Promise.resolve({ ok: false, error: 'Jogo não encontrado na biblioteca.' })
  }
  if (!existsSync(game.exePath)) {
    return Promise.resolve({
      ok: false,
      error: `Executável não encontrado: ${game.exePath}`
    })
  }

  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (result: { ok: boolean; error?: string }): void => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }

    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(game.exePath, [], {
        cwd: dirname(game.exePath),
        detached: true,
        windowsHide: false,
        stdio: 'ignore',
        shell: false
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      finish({ ok: false, error: `Não foi possível iniciar o jogo: ${message}` })
      return
    }

    child.once('spawn', () => {
      child?.unref()
      console.log(`[games] Jogo iniciado: ${game.name} (${game.exePath})`)
      finish({ ok: true })
    })
    child.once('error', (err: Error) => {
      finish({ ok: false, error: `Não foi possível iniciar o jogo: ${err.message}` })
    })
    // Falha de spawn normalmente dispara 'error' na hora; o timeout é só um
    // guarda para nunca deixar a promise pendente para sempre. Se ele disparar
    // sem 'spawn'/'error', o processo muito provavelmente já foi criado.
    const safety = setTimeout(() => {
      console.warn(`[games] Timeout aguardando evento de spawn para ${game.name} — assumindo iniciado.`)
      finish({ ok: true })
    }, 5000)
    safety.unref?.()
  })
}

/** Registra os canais IPC da biblioteca de jogos. */
export function registerGamesIpc(): void {
  ipcMain.handle('games:get', (): Game[] => getGames())

  ipcMain.handle('games:add', (_event, input: unknown): GameResult => addGame(input))

  ipcMain.handle('games:update', (_event, id: unknown, patch: unknown): GameResult =>
    updateGame(id, patch)
  )

  ipcMain.handle('games:remove', (_event, id: unknown): GameResult => removeGame(id))

  ipcMain.handle(
    'games:launch',
    (_event, id: unknown): Promise<{ ok: boolean; error?: string }> => launchGame(id)
  )

  ipcMain.handle('games:get-icon', (_event, id: unknown): string | null => getGameIcon(id))
}
