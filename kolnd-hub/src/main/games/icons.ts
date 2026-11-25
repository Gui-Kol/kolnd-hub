import { app, dialog, nativeImage, shell } from 'electron'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import {
  getStoredGames,
  setStoredGames,
  getGameIconsVersion,
  setGameIconsVersion,
  StoredGame
} from '../store'
import { isValidId, isValidExePath, GameResult } from './naming'
import { logger } from '../logger'
import { lookupIconDataUrl, storeIconDataUrl, invalidateIconCache } from '../iconCache'
import { readExeIconIco, readExeIconIcoSized } from './exeIcon'
import { findGameExecutable, steamGameRootFromExe } from './exeFinder'
import { materialize, putIcon, readIcon, removeIfUnreferenced } from './iconVault'
import {
  findGameIconAssets,
  iconOriginForResolvedSource,
  resolveGameIcon,
  SHORTCUT_SCAN_MAX_DEPTH,
  SHORTCUT_SCAN_MAX_FILES,
  type AssetScanFs,
  type IconSource,
  type LocalIconCandidate,
  type ShortcutEntry
} from './iconResolve'
import { reloadMissingGameIcons, refreshAllGameIcons } from './iconReload'
import type { ReloadIconsResult, RefreshIconsResult } from './iconReload'

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
/**
 * Versão do pipeline de durabilidade dos ícones. Suba este número quando a
 * forma de guardar/rematerializar mudar: na próxima abertura o Hub roda a
 * passada única de `repairGameIconsIfNeeded` (cofre + origem).
 */
export const GAME_ICON_PIPELINE_VERSION = 3
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

/** Extensões canônicas, em ordem de preferência quando o `iconExt` não ajuda. */
const CANONICAL_ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const

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
 * Nomes legados gravados pelos scanners (`steam_<appid>.png`, `epic_<hash>.png`,
 * `custom_<hash>.png`, `minecraft_launcher.png`). Derivados do id/origem com
 * sanitização — nunca do `id` cru, para um id malicioso não escapar da pasta.
 */
function legacyIconFileNames(game: Pick<StoredGame, 'id' | 'origin' | 'steamAppId'>): string[] {
  const names: string[] = []
  const id = game.id.trim()
  if (game.origin === 'steam' && game.steamAppId !== undefined) {
    names.push(`steam_${game.steamAppId}.png`)
  }
  // O scanner grava o id com hífen (`epic-<hash>`) no nome com underscore.
  if (id.startsWith('epic-')) names.push(`${safeIconBase(id.replace('-', '_'))}.png`)
  if (id.startsWith('custom-')) names.push(`${safeIconBase(id.replace('-', '_'))}.png`)
  if (id === 'minecraft-launcher') names.push('minecraft_launcher.png')
  return names
}

/** Caminhos canônicos (`<safeIconBase(id)><ext>`) para um jogo. */
function canonicalIconPaths(game: StoredGame): string[] {
  const base = safeIconBase(game.id)
  const extensions: string[] = []
  const knownExt = typeof game.iconExt === 'string' ? game.iconExt.toLowerCase() : ''
  if (IMAGE_EXTENSIONS.has(knownExt)) extensions.push(knownExt)
  for (const ext of CANONICAL_ICON_EXTENSIONS) {
    if (!extensions.includes(ext)) extensions.push(ext)
  }
  return extensions.map((ext) => join(gameIconsDir(), `${base}${ext}`))
}

/** Caminho canônico do jogo para uma extensão específica. */
function canonicalIconPath(game: StoredGame, ext: string): string {
  return join(gameIconsDir(), `${safeIconBase(game.id)}${ext}`)
}

/** Candidatos locais com a origem (para a cascata de aquisição). */
function localIconCandidates(game: StoredGame): LocalIconCandidate[] {
  const candidates: LocalIconCandidate[] = []
  const seen = new Set<string>()
  const push = (path: string, source: IconSource): void => {
    const key = resolve(path)
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ path, source })
  }
  const fromPath = resolveIconInsideGameIcons(game.iconPath)
  if (fromPath) push(fromPath, 'icon-path')
  for (const path of canonicalIconPaths(game)) push(path, 'canonical')
  for (const name of legacyIconFileNames(game)) push(join(gameIconsDir(), name), 'legacy')
  return candidates
}

/**
 * Candidatos de ícone para um jogo, em ordem de prioridade:
 * `iconPath` validado → nome canônico (todas as extensões) → nomes legados dos
 * scanners. Todos os caminhos são construídos com `safeIconBase`, nunca com o
 * `id` cru (fecha o path traversal via id).
 */
export function iconCandidates(game: StoredGame): string[] {
  return localIconCandidates(game).map((candidate) => candidate.path)
}

/**
 * Apaga os arquivos de ícone cacheados do jogo nas extensões de imagem
 * conhecidas: o nome canônico (`<base>.<ext>`) e os nomes legados dos scanners
 * (`steam_…`, `epic_…`, `custom_…`, `minecraft_…`). `exceptPath` (resolvido) é
 * preservado — use para não apagar o ícone recém-gravado. Nunca lança.
 */
export function deleteStaleIcons(
  game: Pick<StoredGame, 'id' | 'origin' | 'steamAppId'>,
  exceptPath: string | null
): void {
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
  const legacyPrefixes = legacyIconFileNames(game).map((name) =>
    `${name.slice(0, name.length - extname(name).length)}.`.toLowerCase()
  )
  const prefixes = [`${safeIconBase(game.id)}.`, `${game.id.trim()}.`, ...legacyPrefixes]
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

/** Lê os bytes de um ícone validando tamanho; null para 0 byte/ilegível/> 4 MB. */
function readIconBuffer(filePath: string): Buffer | null {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size === 0 || stat.size > ICON_MAX_BYTES) return null
    const buffer = readFileSync(filePath)
    return buffer.length > 0 ? buffer : null
  } catch {
    return null
  }
}

/** Lê os bytes do primeiro candidato legível do jogo (para semear o cofre). */
function firstReadableIcon(game: StoredGame): { buffer: Buffer; file: string } | null {
  for (const candidate of iconCandidates(game)) {
    if (!existsSync(candidate)) continue
    const buffer = readIconBuffer(candidate)
    if (buffer) return { buffer, file: candidate }
  }
  return null
}

/**
 * Semeia o cofre para jogos com ícone legível e sem identidade (`iconSha`).
 * Idempotente e puro de store: devolve a lista nova e a contagem. `.ico` é
 * convertido em PNG (o cofre não aceita `.ico`). Nunca lança.
 */
function seedMissingIconEntries(games: StoredGame[]): { games: StoredGame[]; seeded: number } {
  const next = [...games]
  let seeded = 0
  for (let index = 0; index < games.length; index += 1) {
    const game = games[index]
    // Já tem blob no cofre: rodar de novo não muda nada.
    if (game.iconSha && game.iconExt) continue
    const found = firstReadableIcon(game)
    if (!found) continue
    let buffer = found.buffer
    let ext = extname(found.file).toLowerCase()
    if (ext === '.ico') {
      // `.ico` não é aceito no cofre nem servido direto: converte em PNG.
      const png = icoToPng(buffer)
      if (!png) continue
      buffer = png
      ext = '.png'
    }
    const stored = putIcon(buffer, ext)
    if (!stored) continue
    next[index] = {
      ...game,
      iconSha: stored.sha,
      iconExt: stored.ext,
      iconOrigin: game.iconOrigin ?? inferIconOrigin(game, found.file)
    }
    seeded += 1
  }
  return { games: next, seeded }
}

/**
 * Lê o store, semeia o cofre dos jogos sem `iconSha` e persiste de uma vez.
 * Best-effort: qualquer falha vira aviso no log e `persisted:false`.
 */
function seedStoredIconVault(): { seeded: number; persisted: boolean } {
  try {
    const games = getStoredGames()
    const { games: next, seeded } = seedMissingIconEntries(games)
    if (seeded === 0) return { seeded: 0, persisted: true }
    const saved = setStoredGames(next)
    if (!saved.success) {
      logger.warn('games', 'Não foi possível persistir os ícones semeados no cofre.')
      return { seeded, persisted: false }
    }
    logger.info('games', `Ícones semeados no cofre: ${seeded}`)
    return { seeded, persisted: true }
  } catch (err) {
    logger.warn('games', 'Falha ao semear os ícones no cofre:', err)
    return { seeded: 0, persisted: false }
  }
}

/** Metadados do ícone persistidos junto do jogo (identidade no cofre + origem). */
interface IconMetaUpdate {
  iconSha: string
  iconExt: string
  iconOrigin: NonNullable<StoredGame['iconOrigin']>
}

/**
 * Grava a identidade do cofre/origem no jogo. NÃO mexe no `iconPath`: quem
 * persiste o caminho é o `games:update` seguinte (mesmo fluxo de sempre).
 * Best-effort: falha de store vira aviso no log, nunca lança.
 */
function persistIconMeta(id: string, meta: IconMetaUpdate): boolean {
  try {
    const games = getStoredGames()
    const index = games.findIndex((game) => game.id === id)
    if (index === -1) return false
    games[index] = { ...games[index], ...meta }
    const saved = setStoredGames(games)
    if (!saved.success) {
      logger.warn('games', `Não foi possível persistir os metadados do ícone de ${id}.`)
      return false
    }
    return true
  } catch (err) {
    logger.warn('games', `Falha ao persistir os metadados do ícone de ${id}:`, err)
    return false
  }
}

/**
 * Extrai o ícone embutido de um executável e grava como PNG em `pngPath`.
 * Devolve `true` em sucesso; `false` (sem lançar) quando o exe não tem
 * ícone utilizável — o card cai no fallback visual. Compartilhado entre a
 * importação da Steam (steamScanner) e a adição de jogos personalizados.
 */
export async function extractIconPng(exePath: string, pngPath: string): Promise<boolean> {
  try {
    const png = await loadExeIconPng(exePath)
    if (!png) return false
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
 * Converte um .ico em PNG usando o decodificador do Chromium. O `nativeImage`
 * não aceita .ico via buffer; gravar num arquivo temporário e usar
 * `createFromPath` é o caminho suportado.
 */
function icoToPng(ico: Buffer): Buffer | null {
  let tempDir: string | null = null
  try {
    tempDir = mkdtempSync(join(tmpdir(), 'kolnd-exe-icon-'))
    const icoPath = join(tempDir, 'icon.ico')
    writeFileSync(icoPath, ico)
    const image = nativeImage.createFromPath(icoPath)
    if (image.isEmpty()) return null
    const png = image.toPNG()
    return png.length > 0 ? png : null
  } catch {
    return null
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Temporário preso — o SO limpa depois.
      }
    }
  }
}

/**
 * PNG do ícone do executável: primeiro os recursos PE (mesmo ícone que o
 * Windows mostra na barra de tarefas/bandeja, em qualquer DPI); se o arquivo
 * não for um PE com ícones, cai para o `app.getFileIcon` (comportamento antigo).
 */
async function loadExeIconPng(exePath: string): Promise<Buffer | null> {
  const ico = readExeIconIco(exePath)
  if (ico) {
    const png = icoToPng(ico)
    if (png) return png
  }
  try {
    const image = await app.getFileIcon(exePath, { size: 'large' })
    if (image.isEmpty()) return null
    const png = image.toPNG()
    return png.length > 0 ? png : null
  } catch (err) {
    logger.warn('games', `Não foi possível extrair o ícone de ${exePath}:`, err)
    return null
  }
}

/** Ícone de arquivo/atalho do shell, convertido em PNG (null em falha). */
async function fileIconPng(filePath: string): Promise<Buffer | null> {
  try {
    const image = await app.getFileIcon(filePath, { size: 'large' })
    if (image.isEmpty()) return null
    const png = image.toPNG()
    return png.length > 0 ? png : null
  } catch {
    return null
  }
}

/** Recursos PE com a maior imagem ≤ 256 (sem cair no genérico do shell). */
async function loadExeIconPngSized(exePath: string): Promise<Buffer | null> {
  try {
    const ico = readExeIconIcoSized(exePath, 256)
    return ico ? icoToPng(ico) : null
  } catch {
    return null
  }
}

/** Adaptador real da varredura limitada de assets. */
const GAME_ASSET_FS: AssetScanFs = {
  readDir: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: entry.isSymbolicLink()
      }))
    } catch {
      return []
    }
  },
  statFile: (filePath) => {
    try {
      const stat = statSync(filePath)
      return stat.isFile() ? { size: stat.size } : null
    } catch {
      return null
    }
  }
}

function scanGameAssets(root: string): string[] {
  try {
    return findGameIconAssets(root, GAME_ASSET_FS)
  } catch {
    return []
  }
}

/** Lê um asset de imagem (converte `.ico` em PNG via nativeImage). */
async function readImageAsset(filePath: string): Promise<{ buffer: Buffer; ext: string } | null> {
  const ext = extname(filePath).toLowerCase()
  const buffer = readIconBuffer(filePath)
  if (!buffer) return null
  if (ext === '.ico') {
    const png = icoToPng(buffer)
    return png ? { buffer: png, ext: '.png' } : null
  }
  if (!IMAGE_EXTENSIONS.has(ext)) return null
  return { buffer, ext }
}

/** Raízes dos atalhos do Windows (menu Iniciar do usuário/todos + Desktop). */
function shortcutRoots(): string[] {
  const roots: string[] = []
  const appData = process.env.APPDATA
  const programData = process.env.ProgramData
  const userProfile = process.env.USERPROFILE
  const publicDir = process.env.PUBLIC
  if (appData) roots.push(join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  if (programData) roots.push(join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  if (userProfile) roots.push(join(userProfile, 'Desktop'))
  if (publicDir) roots.push(join(publicDir, 'Desktop'))
  return roots
}

/** Coleta `.lnk` com profundidade/total limitados (sem seguir symlinks). */
function collectShortcutLinks(): string[] {
  const links: string[] = []
  let examined = 0
  const walk = (dir: string, depth: number): void => {
    if (examined >= SHORTCUT_SCAN_MAX_FILES) return
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (examined >= SHORTCUT_SCAN_MAX_FILES) return
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth < SHORTCUT_SCAN_MAX_DEPTH) walk(fullPath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (extname(entry.name).toLowerCase() !== '.lnk') continue
      examined += 1
      links.push(fullPath)
    }
  }
  for (const root of shortcutRoots()) walk(root, 0)
  return links
}

/** Varredura de atalhos no máximo 1× por sessão (cache em memória). */
let shortcutCache: Promise<ShortcutEntry[]> | null = null
function loadShortcutEntries(): Promise<ShortcutEntry[]> {
  if (!shortcutCache) {
    shortcutCache = (async () => {
      const entries: ShortcutEntry[] = []
      for (const linkPath of collectShortcutLinks()) {
        try {
          const info = shell.readShortcutLink(linkPath)
          if (info?.target) entries.push({ linkPath, target: info.target })
        } catch {
          // Atalho inválido/sem permissão — ignora.
        }
      }
      return entries
    })()
  }
  return shortcutCache
}

/** Raiz da instalação usada para varrer assets (Steam: pasta do jogo). */
function gameInstallRoot(game: StoredGame): string | null {
  if (game.origin === 'steam') {
    const root = steamGameRootFromExe(game.exePath)
    if (root) return root
  }
  try {
    return dirname(game.exePath)
  } catch {
    return null
  }
}

/** Persiste o resultado da cascata (caminho materializado + cofre + origem). */
function persistAcquiredIcon(
  id: string,
  iconPath: string,
  stored: { sha: string; ext: string },
  source: IconSource
): boolean {
  try {
    const games = getStoredGames()
    const index = games.findIndex((game) => game.id === id)
    if (index === -1) return false
    const current = games[index]
    games[index] = {
      ...current,
      iconPath,
      iconSha: stored.sha,
      iconExt: stored.ext,
      // Fonte local (cofre/arquivo) não rebaixa um ícone manual; só uma
      // re-derivação real (PE/atalho/assets/shell) marca `derived`.
      iconOrigin: iconOriginForResolvedSource(current.iconOrigin, source)
    }
    const saved = setStoredGames(games)
    if (!saved.success) logger.warn('games', `Não foi possível persistir o ícone de ${id}.`)
    return saved.success
  } catch (err) {
    logger.warn('games', `Falha ao persistir o ícone de ${id}:`, err)
    return false
  }
}

/**
 * Aquisição em cascata (somente fontes locais): resolve, grava no cofre,
 * materializa no nome canônico e persiste caminho/origem. Usada pelo
 * `reloadGameIcons` para preencher ícones ausentes/ilegíveis.
 */
async function acquireIconForGame(game: StoredGame): Promise<boolean> {
  try {
    // Steam: o `exePath` salvo pode ser um launcher/ferramenta — prefere o
    // binário real da instalação (mesma escolha do refresh/reparo).
    const sourceExe = resolveIconSourceExe(game)
    const resolved = await resolveGameIcon({
      game: { ...game, exePath: sourceExe },
      localCandidates: localIconCandidates(game),
      vaultRead: (sha, ext) => readIcon(sha, ext),
      fileExists: (path) => existsSync(path),
      readFile: (path) => readIconBuffer(path),
      readImageFile: (path) => readImageAsset(path),
      readExeIconPng: (exePath) => loadExeIconPngSized(exePath),
      shortcuts: () => loadShortcutEntries(),
      readShortcutIconPng: (linkPath) => fileIconPng(linkPath),
      gameRoot: gameInstallRoot(game),
      scanGameAssets: (root) => scanGameAssets(root),
      getFileIconPng: (exePath) => fileIconPng(exePath)
    })
    if (!resolved) return false
    const stored = putIcon(resolved.buffer, resolved.ext)
    if (!stored) return false
    const iconPath = canonicalIconPath(game, stored.ext)
    if (!materialize(stored.sha, stored.ext, iconPath)) return false
    invalidateIconCache(iconPath)
    return persistAcquiredIcon(game.id, iconPath, stored, resolved.source)
  } catch (err) {
    logger.warn('games', `Falha ao adquirir o ícone de ${game.id}:`, err)
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
 * Grava a imagem (dataURL base64 vindo de `games:pick-icon`) no nome canônico
 * `game-icons/<safeIconBase(id)><ext>` e no cofre content-addressed; persiste
 * `iconOrigin:'manual'` + `iconSha`/`iconExt`. O `iconPath` continua sendo
 * persistido pelo `games:update` seguinte, que preserva esses metadados.
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

  const game = getStoredGames().find((item) => item.id === trimmedId)
  if (!game) {
    return { success: false, error: 'Jogo não encontrado na biblioteca.' }
  }

  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png'
  const iconPath = canonicalIconPath(game, ext)
  const stored = putIcon(buffer, ext)
  if (!stored || !materialize(stored.sha, stored.ext, iconPath)) {
    logger.warn('games', `Não foi possível gravar o ícone ${iconPath}.`)
    return { success: false, error: 'Não foi possível gravar a imagem na pasta de ícones.' }
  }
  invalidateIconCache(iconPath)
  persistIconMeta(trimmedId, {
    iconSha: stored.sha,
    iconExt: stored.ext,
    iconOrigin: 'manual'
  })
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
    const png = await loadExeIconPng(exePath)
    if (!png) {
      return { success: false, error: 'O executável não tem um ícone utilizável.' }
    }
    return { success: true, dataUrl: `data:image/png;base64,${png.toString('base64')}` }
  } catch (err) {
    logger.warn('games', `Não foi possível extrair o ícone de ${exePath}:`, err)
    return { success: false, error: 'O executável não tem um ícone utilizável.' }
  }
}

/**
 * Extrai o ícone embutido do executável e grava como PNG no nome canônico
 * `game-icons/<base-do-id>.png` + cofre — "Restaurar ícone do executável" no
 * modal de edição. Persiste `iconOrigin:'derived'`/`iconSha`/`iconExt`; o
 * `iconPath` continua sendo gravado pelo `games:update` seguinte.
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

  const png = await loadExeIconPng(exePath)
  if (!png) {
    return { success: false, error: 'O executável não tem um ícone utilizável.' }
  }
  const iconPath = canonicalIconPath(game, '.png')
  const stored = putIcon(png, '.png')
  if (!stored || !materialize(stored.sha, stored.ext, iconPath)) {
    logger.warn('games', `Não foi possível gravar o ícone ${iconPath}.`)
    return { success: false, error: 'Não foi possível gravar o ícone na pasta de ícones.' }
  }
  invalidateIconCache(iconPath)
  persistIconMeta(trimmedId, {
    iconSha: stored.sha,
    iconExt: stored.ext,
    iconOrigin: 'derived'
  })
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
  // Varre também as sobras `<base-do-id>.<ext>` e os nomes legados dos scanners.
  deleteStaleIcons(game, null)
  // GC do cofre: o blob só sai quando nenhum outro jogo o referencia.
  removeIfUnreferenced(game.iconSha, game.iconExt, (sha) =>
    getStoredGames().some((other) => other.iconSha === sha)
  )
}

export function getGameIcon(id: unknown): string | null {
  if (!isValidId(id)) return null
  const trimmedId = id.trim()
  const game = getStoredGames().find((g) => g.id === trimmedId)
  if (!game) return null
  for (const candidate of iconCandidates(game)) {
    if (!existsSync(candidate)) continue
    // Arquivo 0 byte/inválido/grande demais não encerra a busca: o próximo
    // candidato (canônico, legado ou cofre) ainda pode servir um ícone bom.
    const dataUrl = readIconAsDataUrl(candidate)
    if (dataUrl) return dataUrl
  }
  // Rematerialização: o cofre tem os bytes mesmo se `game-icons/` foi apagada.
  const ext = typeof game.iconExt === 'string' ? game.iconExt.toLowerCase() : ''
  if (game.iconSha && IMAGE_EXTENSIONS.has(ext)) {
    const target = canonicalIconPath(game, ext)
    if (materialize(game.iconSha, ext, target)) {
      const dataUrl = readIconAsDataUrl(target)
      if (dataUrl) return dataUrl
    }
  }
  return null
}

/**
 * Executável usado como fonte do ícone. Jogos da Steam usam o melhor exe da
 * pasta de instalação (o `exePath` salvo pode apontar para uma ferramenta,
 * ex.: `tools/ModUploader.exe`); os demais usam o próprio `exePath`.
 */
function resolveIconSourceExe(game: StoredGame): string {
  if (game.origin === 'steam') {
    const root = steamGameRootFromExe(game.exePath)
    if (root) {
      const best = findGameExecutable(root)
      if (best && existsSync(best)) return best
    }
  }
  return game.exePath
}

/**
 * Infere a origem de um ícone que já estava no disco antes da v3. O que veio
 * dos scanners (nomes legados) é `derived`; qualquer outro arquivo pode ter
 * sido escolhido à mão — na dúvida marcamos `manual` para NUNCA sobrescrever.
 */
function inferIconOrigin(
  game: StoredGame,
  iconFile: string
): NonNullable<StoredGame['iconOrigin']> {
  const name = basename(iconFile).toLowerCase()
  const legacy = new Set(legacyIconFileNames(game).map((entry) => entry.toLowerCase()))
  return legacy.has(name) ? 'derived' : 'manual'
}

/**
 * Semeadura de durabilidade dos ícones. Roda em **toda** abertura, não só na
 * troca de versão: jogos importados depois da v3 também entram no cofre.
 * Para cada jogo sem `iconSha`, lê o ícone legível existente, grava no cofre e
 * infere a origem (`manual` na dúvida — nunca sobrescreve). Idempotente: jogos
 * que já têm identidade no cofre não são tocados. A versão do pipeline é só
 * bookkeeping. Roda antes de a janela abrir; nunca lança.
 */
export async function repairGameIconsIfNeeded(): Promise<number> {
  try {
    const versionCurrent = getGameIconsVersion() >= GAME_ICON_PIPELINE_VERSION
    const { seeded, persisted } = seedStoredIconVault()
    // Falha ao persistir: tenta de novo na próxima abertura (não grava versão).
    if (!persisted) return 0
    if (!versionCurrent) setGameIconsVersion(GAME_ICON_PIPELINE_VERSION)
    return seeded
  } catch (err) {
    logger.warn('games', 'Falha ao reparar ícones cacheados:', err)
    return 0
  }
}

/**
 * Apaga sobras do ícone que o jogo tinha antes de ser atualizado (o arquivo
 * antigo, quando diferente do novo, e os `<base-do-id>.<ext>` restantes).
 */
function cleanupRefreshedIcon(game: StoredGame, keptTarget: string): void {
  const kept = resolve(keptTarget)
  const previous = resolveIconInsideGameIcons(game.iconPath)
  if (previous && previous !== kept) {
    try {
      rmSync(previous, { force: true })
      invalidateIconCache(previous)
    } catch (err) {
      logger.warn('games', `Não foi possível apagar o ícone antigo ${previous}:`, err)
    }
  }
  deleteStaleIcons(game, kept)
}

/**
 * Extração do "Atualizar ícones" já grava PNG canônico e o cofre — o store
 * precisa receber a identidade nova junto do `iconPath`, senão a
 * rematerialização serviria o ícone antigo.
 */
function captureIconMeta(target: string): IconMetaUpdate | null {
  const buffer = readIconBuffer(target)
  if (!buffer) return null
  const stored = putIcon(buffer, extname(target).toLowerCase())
  if (!stored) return null
  return { iconSha: stored.sha, iconExt: stored.ext, iconOrigin: 'derived' }
}

/**
 * "Atualizar todos os ícones automáticos" da Biblioteca: re-extrai do
 * executável os ícones que NÃO foram escolhidos à mão (`iconOrigin:'manual'`).
 * Ícones manuais são preservados sem exceção. Só é chamado por ação explícita
 * do usuário (IPC `games:refresh-icons`). Best-effort: qualquer falha vira
 * contagem e aviso no log, nunca lança.
 */
export async function refreshGameIcons(): Promise<RefreshIconsResult> {
  try {
    const result = await refreshAllGameIcons({
      games: getStoredGames,
      // Mesmo destino do "Restaurar ícone" (`restoreExeIcon`).
      targetOf: (game) => canonicalIconPath(game, '.png'),
      // Steam: melhor executável da pasta (mesma fonte do reparo); demais: exePath.
      exeOf: resolveIconSourceExe,
      extract: extractIconPng,
      isManual: (game) => game.iconOrigin === 'manual',
      metaOf: (_game, target) => captureIconMeta(target),
      persist: (games) => setStoredGames(games).success,
      cleanup: cleanupRefreshedIcon
    })
    if (result.refreshed > 0) {
      logger.info('games', `Ícones atualizados: ${result.refreshed} de ${result.checked}`)
    }
    return result
  } catch (err) {
    logger.warn('games', 'Falha ao atualizar todos os ícones:', err)
    return { checked: 0, refreshed: 0, failed: 0 }
  }
}

/**
 * Re-extrai do executável os ícones que não estão legíveis — chamado ao abrir
 * a Biblioteca para garantir que os cards fiquem preenchidos. Só toca em
 * ícones ausentes/corrompidos: um ícone válido (inclusive o escolhido à mão
 * pelo usuário) nunca é sobrescrito. Best-effort: qualquer falha vira aviso
 * no log e contagem, nunca impede a lista de carregar.
 */
export async function reloadGameIcons(): Promise<ReloadIconsResult> {
  try {
    // Antes de buscar os ausentes, protege quem já tem ícone legível mas ainda
    // não entrou no cofre (jogos importados depois da v3). Não sobrescreve
    // arquivos: só lê e registra a identidade no store.
    seedStoredIconVault()
    const result = await reloadMissingGameIcons({
      games: getStoredGames,
      iconOf: (game) => getGameIcon(game.id),
      // Destino canônico PNG (a extração sempre grava bytes PNG; nunca PNG
      // disfarçado de `.jpg` herdado do `iconPath` antigo).
      targetOf: (game) => canonicalIconPath(game, '.png'),
      exeOf: resolveIconSourceExe,
      extract: extractIconPng,
      // Cascata local (cofre → PE ≤256 → atalho → assets → shell).
      acquire: acquireIconForGame
    })
    if (result.reloaded > 0) {
      logger.info('games', `Ícones recarregados: ${result.reloaded} de ${result.checked}`)
    }
    return result
  } catch (err) {
    logger.warn('games', 'Falha ao recarregar os ícones dos jogos:', err)
    return { checked: 0, reloaded: 0, failed: 0 }
  }
}
