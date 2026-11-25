import { extname } from 'path'
import type { StoredGame } from '../store'

/**
 * Aquisição de ícones **somente com fontes locais**, em cascata determinística:
 * cofre → arquivos canônicos/legados → recursos PE (maior imagem ≤ 256) →
 * atalhos `.lnk` cujo target casa com o executável → assets da pasta do jogo →
 * `app.getFileIcon`.
 *
 * Toda a I/O é injetada (`IconResolveDeps`) para o módulo ser testável como
 * unidade pura. Nada aqui acessa rede. `icons.ts` fornece as dependências reais
 * e grava o resultado no cofre + nome canônico.
 */

/** Origem do ícone resolvido (diagnóstico/testes). */
export type IconSource =
  | 'vault'
  | 'icon-path'
  | 'canonical'
  | 'legacy'
  | 'exe-pe'
  | 'shortcut'
  | 'game-assets'
  | 'file-icon'

/** Ícone pronto para ser gravado no cofre. */
export interface ResolvedIcon {
  buffer: Buffer
  ext: string
  source: IconSource
}

/** Candidato já validado dentro de `game-icons/`. */
export interface LocalIconCandidate {
  path: string
  source: IconSource
}

/** Atalho do Windows com o target resolvido. */
export interface ShortcutEntry {
  linkPath: string
  target: string
}

/** Dependências da cascata — todas fornecidas por `icons.ts`/testes. */
export interface IconResolveDeps {
  game: StoredGame
  /** Candidatos locais na ordem de prioridade (iconPath → canônico → legado). */
  localCandidates: LocalIconCandidate[]
  /** Lê o blob `sha`/`ext` do cofre. */
  vaultRead: (sha: string, ext: string) => Buffer | null
  fileExists: (path: string) => boolean
  /** Lê bytes de um arquivo de imagem (png/jpg/jpeg/webp). */
  readFile: (path: string) => Buffer | null
  /** Lê/converte um asset (inclui `.ico`) em bytes de imagem. */
  readImageFile: (path: string) => Promise<{ buffer: Buffer; ext: string } | null>
  /** Maior imagem PE ≤ 256 convertida em PNG. */
  readExeIconPng: (exePath: string) => Promise<Buffer | null>
  /** Atalhos `.lnk` (o chamador varre no máximo 1× por sessão e cacheia). */
  shortcuts: () => Promise<ShortcutEntry[]>
  /** Ícone do atalho (via `app.getFileIcon`). */
  readShortcutIconPng: (linkPath: string) => Promise<Buffer | null>
  /** Raiz da instalação para a varredura de assets; null = não varrer. */
  gameRoot: string | null
  /** Varredura limitada de assets da pasta do jogo. */
  scanGameAssets: (root: string) => string[]
  /** Ícone genérico do shell para o executável. */
  getFileIconPng: (exePath: string) => Promise<Buffer | null>
}

/** Ícones são pequenos; qualquer coisa maior que isso não é um ícone válido. */
export const ICON_RESOLVE_MAX_BYTES = 4 * 1024 * 1024

/** Extensões de imagem aceitas nas fontes locais. */
const ASSET_EXTENSIONS = new Set(['.png', '.ico', '.jpg', '.jpeg', '.webp'])

/** Extensões aceitas nos arquivos já materializados de `game-icons/`. */
const LOCAL_ICON_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico'])

/** Profundidade máxima da varredura de assets a partir da pasta do jogo. */
export const GAME_ASSET_SCAN_MAX_DEPTH = 2
/** Teto de arquivos examinados na varredura de assets (protege jogos enormes). */
export const GAME_ASSET_SCAN_MAX_FILES = 200
/** Teto de arquivos `.lnk` examinados na sessão. */
export const SHORTCUT_SCAN_MAX_FILES = 500
/** Profundidade máxima da varredura de atalhos do menu Iniciar/Desktop. */
export const SHORTCUT_SCAN_MAX_DEPTH = 3

/** Nomes de pasta/arquivo que nunca são o ícone do jogo. */
const ASSET_EXCLUDE_SUBSTRINGS = ['unins', 'redist', 'vcredist', 'directx', 'dotnet']

/** Palavras que indicam asset de ícone/logo (busca case-insensitive). */
const ASSET_KEYWORDS = ['icon', 'logo', 'game']

/** `true` para bytes de imagem dentro do teto. */
export function isValidIconBuffer(buffer: Buffer | null | undefined): buffer is Buffer {
  return Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= ICON_RESOLVE_MAX_BYTES
}

/** Normaliza caminho para comparar target do atalho × executável. */
export function normalizeIconPath(filePath: string): string {
  return filePath.trim().replace(/\//g, '\\').toLowerCase()
}

/** Fontes que apenas releem/rematerializam um ícone já existente do jogo. */
const LOCAL_ICON_SOURCES = new Set<IconSource>(['vault', 'icon-path', 'canonical', 'legacy'])

/**
 * Origem a persistir após uma aquisição. Um ícone `manual` só continua manual
 * quando a fonte também é local (cofre/arquivo); qualquer fonte re-derivada
 * (PE, atalho, assets, shell) é `derived`. Jogos sem origem viram `derived`.
 */
export function iconOriginForResolvedSource(
  currentOrigin: StoredGame['iconOrigin'],
  source: IconSource
): NonNullable<StoredGame['iconOrigin']> {
  if (currentOrigin === 'manual' && LOCAL_ICON_SOURCES.has(source)) return 'manual'
  return 'derived'
}

/** O target do atalho aponta para o executável do jogo? */
export function shortcutMatchesExe(target: string, exePath: string): boolean {
  if (!target || !exePath) return false
  return normalizeIconPath(target) === normalizeIconPath(exePath)
}

function assetScore(name: string): number {
  const lower = name.toLowerCase()
  for (let index = 0; index < ASSET_KEYWORDS.length; index++) {
    if (lower.includes(ASSET_KEYWORDS[index])) return index
  }
  return Number.MAX_SAFE_INTEGER
}

function isExcludedAssetName(name: string): boolean {
  const lower = name.toLowerCase()
  return ASSET_EXCLUDE_SUBSTRINGS.some((part) => lower.includes(part))
}

/** Sistema de arquivos mínimo para a varredura testável de assets. */
export interface AssetScanEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink?: boolean
}

export interface AssetScanFs {
  readDir: (dir: string) => AssetScanEntry[]
  statFile: (path: string) => { size: number } | null
}

export interface AssetScanLimits {
  maxDepth?: number
  maxFiles?: number
  maxBytes?: number
}

/** Junta pasta e nome sem depender do `path` do SO nos testes. */
function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${name}`
}

interface AssetCandidate {
  path: string
  score: number
  depth: number
  size: number
}

/**
 * Varre a pasta do jogo (máx. `maxDepth` níveis, `maxFiles` arquivos) atrás de
 * imagens cujo nome contenha icon/logo/game. Ignora instaladores/redist e
 * symlinks; arquivos vazios ou > 4 MB são descartados. Devolve os caminhos em
 * ordem de preferência (nome mais específico, mais raso, maior).
 */
export function findGameIconAssets(
  root: string,
  fs: AssetScanFs,
  limits: AssetScanLimits = {}
): string[] {
  const maxDepth = limits.maxDepth ?? GAME_ASSET_SCAN_MAX_DEPTH
  const maxFiles = limits.maxFiles ?? GAME_ASSET_SCAN_MAX_FILES
  const maxBytes = limits.maxBytes ?? ICON_RESOLVE_MAX_BYTES
  const found: AssetCandidate[] = []
  let examined = 0

  const walk = (dir: string, depth: number): void => {
    if (examined >= maxFiles) return
    let entries: AssetScanEntry[]
    try {
      entries = fs.readDir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (examined >= maxFiles) return
      if (entry.isSymbolicLink) continue
      if (entry.isDirectory) {
        if (depth >= maxDepth || isExcludedAssetName(entry.name)) continue
        walk(joinPath(dir, entry.name), depth + 1)
        continue
      }
      if (!entry.isFile) continue
      examined += 1
      if (isExcludedAssetName(entry.name)) continue
      const ext = extname(entry.name).toLowerCase()
      if (!ASSET_EXTENSIONS.has(ext)) continue
      const score = assetScore(entry.name)
      if (score === Number.MAX_SAFE_INTEGER) continue
      const fullPath = joinPath(dir, entry.name)
      const stat = fs.statFile(fullPath)
      if (!stat || stat.size <= 0 || stat.size > maxBytes) continue
      found.push({ path: fullPath, score, depth, size: stat.size })
    }
  }

  walk(root, 0)
  return found
    .sort(
      (a, b) =>
        a.score - b.score || a.depth - b.depth || b.size - a.size || a.path.localeCompare(b.path)
    )
    .map((candidate) => candidate.path)
}

function extOf(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return ext === '.ico' ? '.png' : ext
}

/** Executa a cascata local e devolve o primeiro ícone válido. Nunca lança. */
export async function resolveGameIcon(deps: IconResolveDeps): Promise<ResolvedIcon | null> {
  const { game } = deps

  // 1) Cofre: os bytes persistidos valem mais que qualquer arquivo em cache.
  if (game.iconSha && game.iconExt) {
    try {
      const buffer = deps.vaultRead(game.iconSha, game.iconExt)
      if (isValidIconBuffer(buffer)) {
        return { buffer, ext: game.iconExt, source: 'vault' }
      }
    } catch {
      // Segue para as fontes locais.
    }
  }

  // 2) Arquivos já materializados (iconPath → canônico → legado).
  for (const candidate of deps.localCandidates) {
    const ext = extname(candidate.path).toLowerCase()
    if (!LOCAL_ICON_EXTENSIONS.has(ext)) continue
    try {
      if (!deps.fileExists(candidate.path)) continue
      if (ext === '.ico') {
        // `.ico` precisa ser convertido (nativeImage) antes de virar blob.
        const image = await deps.readImageFile(candidate.path)
        if (image && isValidIconBuffer(image.buffer)) {
          return { buffer: image.buffer, ext: image.ext, source: candidate.source }
        }
        continue
      }
      const buffer = deps.readFile(candidate.path)
      if (isValidIconBuffer(buffer)) {
        return { buffer, ext: extOf(candidate.path), source: candidate.source }
      }
    } catch {
      // Arquivo ilegível: tenta o próximo.
    }
  }

  const exePath = game.exePath

  // 3) Recursos PE do executável, maior tamanho ≤ 256.
  try {
    if (exePath && deps.fileExists(exePath)) {
      const buffer = await deps.readExeIconPng(exePath)
      if (isValidIconBuffer(buffer)) return { buffer, ext: '.png', source: 'exe-pe' }
    }
  } catch {
    // Executável sem PE/ícone: segue.
  }

  // 4) Atalhos .lnk cujo target é exatamente o executável do jogo.
  try {
    const shortcuts = await deps.shortcuts()
    for (const shortcut of shortcuts) {
      if (!shortcutMatchesExe(shortcut.target, exePath)) continue
      const buffer = await deps.readShortcutIconPng(shortcut.linkPath)
      if (isValidIconBuffer(buffer)) return { buffer, ext: '.png', source: 'shortcut' }
    }
  } catch {
    // Sem permissão de leitura do menu Iniciar: segue.
  }

  // 5) Assets da pasta do jogo (limites aplicados na varredura).
  if (deps.gameRoot) {
    try {
      for (const assetPath of deps.scanGameAssets(deps.gameRoot)) {
        const image = await deps.readImageFile(assetPath)
        if (image && isValidIconBuffer(image.buffer)) {
          return { buffer: image.buffer, ext: image.ext, source: 'game-assets' }
        }
      }
    } catch {
      // Pasta do jogo inacessível: segue.
    }
  }

  // 6) Ícone do shell (último recurso; pode ser o genérico do Windows).
  try {
    if (exePath && deps.fileExists(exePath)) {
      const buffer = await deps.getFileIconPng(exePath)
      if (isValidIconBuffer(buffer)) return { buffer, ext: '.png', source: 'file-icon' }
    }
  } catch {
    // Sem ícone do shell: desiste.
  }

  return null
}
