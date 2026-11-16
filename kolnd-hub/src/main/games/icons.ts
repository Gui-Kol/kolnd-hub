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
import { getStoredGames, StoredGame } from '../store'
import { isValidId, isValidExePath, GameResult } from './naming'
import { logger } from '../logger'
import { lookupIconDataUrl, storeIconDataUrl, invalidateIconCache } from '../iconCache'

/**
 * Ícones da biblioteca de jogos: extração de executáveis, cache em disco em
 * `%APPDATA%/kolnd-hub/game-icons/` e data URLs para o renderer.
 * Extraído de main/games.ts — nenhuma mudança de comportamento.
 */

/** Resultado de `games:pick-icon` — `dataUrl` alimenta a pré-visualização (nada é gravado em disco). */
export interface PickIconResult extends GameResult {
  canceled?: boolean
  dataUrl?: string
}

/** Resultado de `games:set-icon` / `games:restore-exe-icon` — `iconPath` é o caminho absoluto gravado (ainda NÃO persistido no store; quem persiste é `games:update`). */
export interface IconPathResult extends GameResult {
  iconPath?: string
}

/** Resultado de `games:preview-exe-icon` — extração em memória, sem tocar no disco. */
export interface PreviewExeIconResult extends GameResult {
  dataUrl?: string
}

/** Ícones são pequenos; qualquer coisa maior que isso não é um ícone válido. */
const ICON_MAX_BYTES = 4 * 1024 * 1024
/** Formatos de imagem aceitos para capa/ícone de jogo (`.ico` NÃO decodifica de forma confiável no nativeImage). */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** Pasta canônica de ícones cacheados dos jogos. */
export function gameIconsDir(): string {
  return join(app.getPath('userData'), 'game-icons')
}

/**
 * Aceita apenas caminhos absolutos que apontem para dentro da pasta de
 * ícones do Hub. Devolve o caminho resolvido, ou null se for de fora.
 */
export function resolveIconInsideGameIcons(iconPath: unknown): string | null {
  if (typeof iconPath !== 'string') return null
  const trimmed = iconPath.trim()
  if (!trimmed || !isAbsolute(trimmed)) return null
  const dir = resolve(gameIconsDir())
  const target = resolve(trimmed)
  const rel = relative(dir, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
  return target
}

/**
 * Nome-base seguro para arquivos de ícone derivados do id do jogo
 * (ids da Steam/custom são seguros, mas sanitizamos por defesa em profundidade).
 */
function safeIconBase(id: string): string {
  const base = id
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 100)
  return base || 'game'
}

/**
 * Apaga os arquivos de ícone cacheados do jogo nas extensões de imagem
 * conhecidas (`<base>.png|.jpg|.jpeg|.webp` e o legado `<id>.png`).
 * `exceptPath` (resolvido) é preservado — use para não apagar o ícone recém-gravado.
 * Nunca lança.
 */
export function deleteStaleIcons(id: string, exceptPath: string | null): void {
  const keep = exceptPath ? resolve(exceptPath) : null
  let dir: string
  try {
    dir = resolve(gameIconsDir())
  } catch {
    return
  }
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return // pasta ainda não existe — nada a limpar
  }
  const prefixes = [`${safeIconBase(id)}.`, `${id.trim()}.`]
  for (const entry of entries) {
    const lower = entry.toLowerCase()
    const ext = extname(lower)
    if (!IMAGE_EXTENSIONS.has(ext)) continue
    if (!prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) continue
    const candidate = join(dir, entry)
    if (keep && resolve(candidate) === keep) continue
    try {
      rmSync(candidate, { force: true })
      invalidateIconCache(candidate)
    } catch (err) {
      logger.warn('games', `Não foi possível apagar o ícone ${candidate}:`, err)
    }
  }
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

/**
 * Lê um PNG/JPG/WebP do disco e devolve um dataURL (ou null em qualquer falha).
 * Servido do cache LRU em memória quando o stat (mtime/tamanho) bate — a leitura
 * e o base64 só acontecem na primeira vez ou após o arquivo mudar.
 */
function readIconAsDataUrl(filePath: string): string | null {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size === 0 || stat.size > ICON_MAX_BYTES) {
      invalidateIconCache(filePath)
      return null
    }
    const cached = lookupIconDataUrl(filePath, stat)
    if (cached) return cached
    const buffer = readFileSync(filePath)
    if (buffer.length === 0) return null
    const dataUrl = `data:${iconMimeType(filePath)};base64,${buffer.toString('base64')}`
    storeIconDataUrl(filePath, stat, dataUrl)
    return dataUrl
  } catch {
    invalidateIconCache(filePath)
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
    // Arquivo recém-escrito: derruba entradas antigas (mtime/tamanho podem repetir).
    invalidateIconCache(pngPath)
    return true
  } catch (err) {
    logger.warn('games', `Não foi possível extrair o ícone de ${exePath}:`, err)
    return false
  }
}

/**
 * Abre o seletor nativo filtrado para imagens (PNG/JPG/WebP). NÃO grava nada
 * em disco: devolve a imagem como dataURL para o renderer pré-visualizar.
 * A gravação acontece só no "Salvar" do modal, via `games:set-icon` + `games:update`.
 * ".ico" é recusado com aviso amigável mesmo se o usuário forçar "Todos os arquivos".
 */
export async function pickGameIcon(): Promise<PickIconResult> {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Escolha a imagem do jogo',
      properties: ['openFile'],
      filters: [
        { name: 'Imagens (PNG, JPG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    })
    if (canceled || filePaths.length === 0) return { success: false, canceled: true }

    const filePath = filePaths[0]
    const ext = extname(filePath).toLowerCase()
    if (ext === '.ico') {
      return {
        success: false,
        error: 'Formato não suportado: .ico. Use PNG, JPG ou WebP.'
      }
    }
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return { success: false, error: 'Formato não suportado. Use PNG, JPG ou WebP.' }
    }
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size === 0) {
      return { success: false, error: 'A imagem escolhida está vazia ou é inválida.' }
    }
    if (stat.size > ICON_MAX_BYTES) {
      return { success: false, error: 'A imagem é muito grande (máx. 4 MB).' }
    }
    // Confere que o arquivo decodifica de verdade (não confiar só na extensão).
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
      dataUrl: `data:${iconMimeType(filePath)};base64,${buffer.toString('base64')}`
    }
  } catch (err) {
    logger.warn('games', 'Falha ao escolher a imagem:', err)
    return { success: false, error: 'Não foi possível abrir a imagem escolhida.' }
  }
}

/**
 * Grava a imagem (dataURL base64 vindo de `games:pick-icon`) em
 * `game-icons/<base-do-id>.<ext>` e devolve o caminho absoluto.
 * NÃO persiste no store — o renderer encadeia `games:update({ iconPath })`,
 * que por sua vez apaga os ícones antigos depois de salvar com sucesso.
 */
export function setGameIcon(id: unknown, dataUrl: unknown): IconPathResult {
  if (!isValidId(id)) {
    return { success: false, error: 'Identificador do jogo inválido.' }
  }
  const trimmedId = id.trim()
  if (typeof dataUrl !== 'string' || dataUrl.length > ICON_MAX_BYTES * 2) {
    return { success: false, error: 'Imagem inválida ou muito grande (máx. 4 MB).' }
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) {
    return { success: false, error: 'Formato de imagem não suportado. Use PNG, JPG ou WebP.' }
  }
  const [, mime, base64] = match
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0 || buffer.length > ICON_MAX_BYTES) {
    return { success: false, error: 'Imagem inválida ou muito grande (máx. 4 MB).' }
  }
  // Decodifica de novo no main — nunca confiar no base64 recebido via IPC.
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) {
    return { success: false, error: 'Formato de imagem não suportado. Use PNG, JPG ou WebP.' }
  }

  const games = getStoredGames()
  const game = games.find((g) => g.id === trimmedId)
  if (!game) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png'
  const iconPath = join(gameIconsDir(), `${safeIconBase(trimmedId)}${ext}`)
  try {
    mkdirSync(dirname(iconPath), { recursive: true })
    writeFileSync(iconPath, buffer)
    invalidateIconCache(iconPath)
  } catch (err) {
    logger.warn('games', `Não foi possível gravar o ícone ${iconPath}:`, err)
    return { success: false, error: 'Não foi possível gravar a imagem na pasta de ícones.' }
  }
  return { success: true, iconPath }
}

/**
 * Extrai o ícone embutido de um executável e devolve um dataURL
 * (sem gravar nada) — usado para pré-visualizar no modal de edição.
 */
export async function previewExeIcon(exePathInput: unknown): Promise<PreviewExeIconResult> {
  if (!isValidExePath(exePathInput)) {
    return { success: false, error: 'Caminho do executável inválido.' }
  }
  const exePath = (exePathInput as string).trim()
  if (!isAbsolute(exePath) || !existsSync(exePath)) {
    return { success: false, error: `Executável não encontrado: ${exePath}` }
  }
  try {
    const image = await app.getFileIcon(exePath, { size: 'large' })
    if (image.isEmpty()) {
      return { success: false, error: 'O executável não tem um ícone utilizável.' }
    }
    const png = image.toPNG()
    if (png.length === 0) {
      return { success: false, error: 'O executável não tem um ícone utilizável.' }
    }
    return { success: true, dataUrl: `data:image/png;base64,${png.toString('base64')}` }
  } catch (err) {
    logger.warn('games', `Não foi possível extrair o ícone de ${exePath}:`, err)
    return { success: false, error: 'O executável não tem um ícone utilizável.' }
  }
}

/**
 * Extrai o ícone embutido do executável e grava como PNG em
 * `game-icons/<base-do-id>.png` — "Restaurar ícone do executável" no modal de edição.
 * Também NÃO persiste no store (o `games:update` seguinte resolve).
 * `exePath` opcional sobrepõe o gravado (permite restaurar do exe recém-trocado).
 */
export async function restoreExeIcon(id: unknown, exePathInput?: unknown): Promise<IconPathResult> {
  if (!isValidId(id)) {
    return { success: false, error: 'Identificador do jogo inválido.' }
  }
  const trimmedId = id.trim()
  const game = getStoredGames().find((g) => g.id === trimmedId)
  if (!game) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  let exePath = game.exePath
  if (exePathInput !== undefined) {
    if (!isValidExePath(exePathInput)) {
      return { success: false, error: 'Caminho do executável inválido.' }
    }
    exePath = (exePathInput as string).trim()
  }
  if (!isAbsolute(exePath) || !existsSync(exePath)) {
    return { success: false, error: `Executável não encontrado: ${exePath}` }
  }

  const iconPath = join(gameIconsDir(), `${safeIconBase(trimmedId)}.png`)
  const ok = await extractIconPng(exePath, iconPath)
  if (!ok) {
    return { success: false, error: 'O executável não tem um ícone utilizável.' }
  }
  return { success: true, iconPath }
}

/** Apaga o ícone cacheado do jogo (se houver). Best-effort: nunca lança. */
export function deleteCachedIcon(game: StoredGame): void {
  const candidates = iconCandidates(game)
  for (const candidate of candidates) {
    try {
      rmSync(candidate, { force: true })
      invalidateIconCache(candidate)
    } catch (err) {
      logger.warn('games', `Não foi possível apagar o ícone ${candidate}:`, err)
    }
  }
  // Varre também as sobras `<base-do-id>.<ext>` (ex.: ícone trocado no modal de edição).
  deleteStaleIcons(game.id, null)
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
