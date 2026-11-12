import { app, dialog, ipcMain, nativeImage } from 'electron'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
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

/**
 * Siglas preservadas em maiúsculas na formatação do nome derivado do arquivo.
 * Lista curta e conhecida — o objetivo é previsibilidade, não perfeição.
 */
const KNOWN_ACRONYMS = new Set([
  'GTA',
  'FIFA',
  'RPG',
  'FPS',
  'MMO',
  'MMORPG',
  'MOBA',
  'RTS',
  'DLC',
  'VR',
  'HD',
  'HDR',
  'AI',
  'NPC'
])

/** Numerais romanos comuns em títulos (mantidos em maiúsculas). */
const ROMAN_NUMERALS = new Set([
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XX'
])

function formatNameWord(word: string): string {
  const upper = word.toUpperCase()
  if (KNOWN_ACRONYMS.has(upper)) return upper
  if (ROMAN_NUMERALS.has(upper)) return upper
  if (/^\d+$/.test(word)) return word
  // Palavra já escrita em maiúsculas e curta (ex.: "V", "GTA"): mantém.
  if (word.length <= 5 && word === upper && /^[A-Z0-9]+$/.test(word)) return upper
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * Deriva um nome legível a partir do nome do arquivo sem extensão.
 * Heurística intencionalmente simples e previsível (documentada no código):
 *  1. `.`, `_`, `-` e espaços múltiplos viram um único espaço;
 *  2. cada palavra recebe inicial maiúscula e o restante minúscula;
 *  3. siglas conhecidas (GTA, FIFA…), numerais romanos (II, III…) e palavras
 *     já em maiúsculas com até 5 caracteres são preservadas como estão;
 *  4. acentos são mantidos; sufixos técnicos comuns (`_x64`, `-Win64-Shipping`)
 *     NÃO são removidos — viram "X64"/"Win64 Shipping" no nome. Aceito de
 *     propósito para manter a regra simples e sem surpresas.
 * Se nada sobrar (ex.: arquivo "___.exe"), devolve "Jogo sem nome".
 */
export function formatGameName(rawBase: string): string {
  const cleaned = rawBase
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Jogo sem nome'
  return cleaned.split(' ').map(formatNameWord).join(' ')
}

/** Hash determinístico (40 bits) de um caminho normalizado — mesmo espírito do steamScanner. */
function exePathHash(exePath: string): string {
  return createHash('sha1').update(exePath.toLowerCase()).digest('hex').slice(0, 10)
}

export interface GameResult {
  success: boolean
  error?: string
}

/** Resultado de `games:add-custom` — inclui o nome formatado para o toast de confirmação. */
export interface AddCustomGameResult extends GameResult {
  id?: string
  name?: string
}

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

const GAME_ID_MAX_LENGTH = 200
const EXE_PATH_MAX_LENGTH = 1024
/** Ícones são pequenos; qualquer coisa maior que isso não é um ícone válido. */
const ICON_MAX_BYTES = 4 * 1024 * 1024
/** Formatos de imagem aceitos para capa/ícone de jogo (`.ico` NÃO decodifica de forma confiável no nativeImage). */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

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

/**
 * Nome-base seguro para arquivos de ícone derivados do id do jogo
 * (ids da Steam/custom são seguros, mas sanitizamos por defesa em profundidade).
 */
function safeIconBase(id: string): string {
  const base = id.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
  return base || 'game'
}

/**
 * Apaga os arquivos de ícone cacheados do jogo nas extensões de imagem
 * conhecidas (`<base>.png|.jpg|.jpeg|.webp` e o legado `<id>.png`).
 * `exceptPath` (resolvido) é preservado — use para não apagar o ícone recém-gravado.
 * Nunca lança.
 */
function deleteStaleIcons(id: string, exceptPath: string | null): void {
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
    } catch (err) {
      console.warn(`[games] Não foi possível apagar o ícone ${candidate}:`, err)
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
  console.log(`[games] Jogo personalizado adicionado: ${name} (${exePath})`)
  return { success: true, id, name }
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
    console.warn('[games] Falha ao escolher a imagem:', err)
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
  } catch (err) {
    console.warn(`[games] Não foi possível gravar o ícone ${iconPath}:`, err)
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
    console.warn(`[games] Não foi possível extrair o ícone de ${exePath}:`, err)
    return { success: false, error: 'O executável não tem um ícone utilizável.' }
  }
}

/**
 * Extrai o ícone embutido do executável e grava como PNG em
 * `game-icons/<base-do-id>.png` — "Restaurar ícone do executável" no modal de edição.
 * Também NÃO persiste no store (o `games:update` seguinte resolve).
 * `exePath` opcional sobrepõe o gravado (permite restaurar do exe recém-trocado).
 */
export async function restoreExeIcon(
  id: unknown,
  exePathInput?: unknown
): Promise<IconPathResult> {
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
        console.warn(`[games] Não foi possível apagar o ícone antigo ${resolvedOld}:`, err)
      }
    }
    deleteStaleIcons(updated.id, resolvedNew)
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
  // Varre também as sobras `<base-do-id>.<ext>` (ex.: ícone trocado no modal de edição).
  deleteStaleIcons(game.id, null)
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

  ipcMain.handle(
    'games:add-custom',
    (_event, exePath: unknown): Promise<AddCustomGameResult> => addCustomGame(exePath)
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
    (_event, id: unknown, exePath?: unknown): Promise<IconPathResult> =>
      restoreExeIcon(id, exePath)
  )

  ipcMain.handle('games:check-exes', (_event, paths: unknown): boolean[] => checkExePaths(paths))

  ipcMain.handle('games:remove', (_event, id: unknown): GameResult => removeGame(id))

  ipcMain.handle(
    'games:launch',
    (_event, id: unknown): Promise<{ ok: boolean; error?: string }> => launchGame(id)
  )

  ipcMain.handle('games:get-icon', (_event, id: unknown): string | null => getGameIcon(id))
}
