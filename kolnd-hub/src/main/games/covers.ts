import { app, dialog, nativeImage } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { getStoredGames } from '../store'
import { isValidId, GameResult } from './naming'
import { logger } from '../logger'
import { lookupIconDataUrl, storeIconDataUrl, invalidateIconCache } from '../iconCache'

/**
 * Capas escolhidas À MÃO para os jogos (T6).
 *
 * Pasta canônica `%APPDATA%/kolnd-hub/game-covers/`. Nada é baixado da
 * internet: o único caminho de entrada é o seletor nativo filtrado para imagens.
 * O arquivo é gravado por `games:set-cover` e o caminho só é persistido no
 * `games:update` seguinte (mesmo padrão do `iconPath`), que também apaga a capa
 * antiga depois de salvar com sucesso.
 */

/** Capas são maiores que ícones, mas ainda têm teto (8 MB). */
export const COVER_MAX_BYTES = 8 * 1024 * 1024

const COVER_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
}

/** Extensões aceitas (o `nativeImage` confirma que decodificam de verdade). */
const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Resultado de `games:pick-cover` — dataURL só para pré-visualização. */
export interface PickCoverResult extends GameResult {
  canceled?: boolean
  dataUrl?: string
}

/** Resultado de `games:set-cover` — caminho ainda NÃO persistido no store. */
export interface CoverPathResult extends GameResult {
  coverPath?: string | null
}

/** Pasta canônica das capas dos jogos. */
export function gameCoversDir(): string {
  return join(app.getPath('userData'), 'game-covers')
}

/**
 * Aceita apenas caminhos absolutos dentro da pasta de capas. Devolve o caminho
 * resolvido ou null (mesma defesa do `resolveIconInsideGameIcons`).
 */
export function resolveCoverInsideGameCovers(coverPath: unknown): string | null {
  if (typeof coverPath !== 'string') return null
  const trimmed = coverPath.trim()
  if (!trimmed || !isAbsolute(trimmed)) return null
  const dir = resolve(gameCoversDir())
  const target = resolve(trimmed)
  const rel = relative(dir, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

/** Nome-base seguro derivado do id do jogo (defesa em profundidade). */
export function safeCoverBase(id: string): string {
  const base = id
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100)
  return base || 'game'
}

/** Extensão canônica para o mime aceito (`image/png|jpeg|webp`) ou null. */
export function coverExtensionForMime(mime: string): string | null {
  return COVER_MIME_EXTENSIONS[mime] ?? null
}

/**
 * Nome do arquivo da capa (`<base-do-id><ext>`). Mime fora da allowlist → null.
 * Função pura: base para o `setGameCover` e para os testes.
 */
export function safeCoverFileName(id: string, mime: string): string | null {
  const ext = coverExtensionForMime(mime)
  if (!ext) return null
  return `${safeCoverBase(id)}${ext}`
}

/** Mime a partir da extensão do arquivo (default PNG, como nos ícones). */
function coverMimeType(filePath: string): string {
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

/**
 * Lê uma capa e devolve dataURL (cache LRU por mtime/tamanho). Qualquer falha
 * vira null — a UI cai no ícone/fallback.
 */
function readCoverAsDataUrl(filePath: string): string | null {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size === 0 || stat.size > COVER_MAX_BYTES) {
      invalidateIconCache(filePath)
      return null
    }
    const cached = lookupIconDataUrl(filePath, stat)
    if (cached) return cached
    const buffer = readFileSync(filePath)
    if (buffer.length === 0) return null
    const dataUrl = `data:${coverMimeType(filePath)};base64,${buffer.toString('base64')}`
    storeIconDataUrl(filePath, stat, dataUrl)
    return dataUrl
  } catch {
    invalidateIconCache(filePath)
    return null
  }
}

/**
 * Apaga as sobras `<base-do-id>.<ext>` da capa. `exceptPath` (resolvido) é
 * preservado. Nunca lança.
 */
export function deleteStaleCovers(id: string, exceptPath: string | null): void {
  const keep = exceptPath ? resolve(exceptPath) : null
  let dir: string
  try {
    dir = resolve(gameCoversDir())
  } catch {
    return
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // pasta ainda não existe
  }
  const prefixes = [`${safeCoverBase(id)}.`, `${id.trim()}.`]
  for (const entry of entries) {
    const lower = entry.toLowerCase()
    if (!COVER_EXTENSIONS.has(extname(lower))) continue
    if (!prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) continue
    const candidate = join(dir, entry)
    if (keep && resolve(candidate) === keep) continue
    try {
      rmSync(candidate, { force: true })
      invalidateIconCache(candidate)
    } catch (err) {
      logger.warn('games', `Não foi possível apagar a capa ${candidate}:`, err)
    }
  }
}

/** Apaga a capa persistida do jogo e sobras do mesmo id. Best-effort. */
export function deleteCachedCover(game: { id: string; coverPath?: string | null }): void {
  const current = resolveCoverInsideGameCovers(game.coverPath)
  if (current) {
    try {
      rmSync(current, { force: true })
      invalidateIconCache(current)
    } catch (err) {
      logger.warn('games', `Não foi possível apagar a capa ${current}:`, err)
    }
  }
  deleteStaleCovers(game.id, null)
}

/**
 * Abre o seletor nativo SÓ de imagens e devolve a capa como dataURL para a
 * pré-visualização. Nada é gravado em disco antes do "Salvar".
 */
export async function pickGameCover(): Promise<PickCoverResult> {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Escolha a capa do jogo',
      properties: ['openFile'],
      filters: [{ name: 'Imagens (PNG, JPG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (canceled || filePaths.length === 0) return { success: false, canceled: true }

    const filePath = filePaths[0]
    const ext = extname(filePath).toLowerCase()
    if (!COVER_EXTENSIONS.has(ext)) {
      return { success: false, error: 'Formato não suportado. Use PNG, JPG ou WebP.' }
    }
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size === 0) {
      return { success: false, error: 'A imagem escolhida está vazia ou é inválida.' }
    }
    if (stat.size > COVER_MAX_BYTES) {
      return { success: false, error: 'A imagem é muito grande (máx. 8 MB).' }
    }
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) {
      return {
        success: false,
        error: 'Não foi possível ler a imagem. O arquivo pode estar corrompido.'
      }
    }
    const buffer = readFileSync(filePath)
    return {
      success: true,
      dataUrl: `data:${coverMimeType(filePath)};base64,${buffer.toString('base64')}`
    }
  } catch (err) {
    logger.warn('games', 'Falha ao escolher a capa:', err)
    return { success: false, error: 'Não foi possível abrir a imagem escolhida.' }
  }
}

/**
 * Grava a capa (dataURL vindo de `games:pick-cover`) em
 * `game-covers/<base-do-id>.<ext>` e devolve o caminho absoluto.
 * NÃO persiste no store — o `games:update({ coverPath })` seguinte resolve e
 * apaga o arquivo antigo após salvar com sucesso.
 */
export function setGameCover(id: unknown, dataUrl: unknown): CoverPathResult {
  if (!isValidId(id)) {
    return { success: false, error: 'Identificador do jogo inválido.' }
  }
  const trimmedId = id.trim()
  if (typeof dataUrl !== 'string' || dataUrl.length > COVER_MAX_BYTES * 2) {
    return { success: false, error: 'Imagem inválida ou muito grande (máx. 8 MB).' }
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) {
    return { success: false, error: 'Formato de imagem não suportado. Use PNG, JPG ou WebP.' }
  }
  const [, mime, base64] = match
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0 || buffer.length > COVER_MAX_BYTES) {
    return { success: false, error: 'Imagem inválida ou muito grande (máx. 8 MB).' }
  }
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) {
    return { success: false, error: 'Formato de imagem não suportado. Use PNG, JPG ou WebP.' }
  }

  const game = getStoredGames().find((item) => item.id === trimmedId)
  if (!game) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  const fileName = safeCoverFileName(trimmedId, mime)
  if (!fileName) {
    return { success: false, error: 'Formato de imagem não suportado. Use PNG, JPG ou WebP.' }
  }
  const coverPath = join(gameCoversDir(), fileName)
  try {
    mkdirSync(dirname(coverPath), { recursive: true })
    writeFileSync(coverPath, buffer)
    invalidateIconCache(coverPath)
  } catch (err) {
    logger.warn('games', `Não foi possível gravar a capa ${coverPath}:`, err)
    return { success: false, error: 'Não foi possível gravar a imagem na pasta de capas.' }
  }
  return { success: true, coverPath }
}

/** dataURL da capa persistida do jogo (null = sem capa/arquivo ilegível). */
export function getGameCover(id: unknown): string | null {
  if (!isValidId(id)) return null
  const trimmedId = id.trim()
  const game = getStoredGames().find((item) => item.id === trimmedId)
  if (!game) return null
  const coverPath = resolveCoverInsideGameCovers(game.coverPath)
  if (!coverPath || !existsSync(coverPath)) return null
  return readCoverAsDataUrl(coverPath)
}
