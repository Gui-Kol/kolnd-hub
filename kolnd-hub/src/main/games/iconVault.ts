import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'
import { logger } from '../logger'

/**
 * Cofre content-addressed dos ícones da Biblioteca.
 *
 * Os bytes de cada ícone aceito vivem em `<userData>/icon-vault/<sha256><ext>`,
 * fora de `game-icons/`. O arquivo em `game-icons/` é só uma materialização:
 * apagar a pasta não perde o ícone — `getGameIcon` regrava a partir do cofre.
 * A chave é o SHA-256 do conteúdo, então ícones iguais (inclusive entre jogos
 * diferentes) ocupam um único blob; o store guarda apenas `iconSha`/`iconExt`.
 *
 * Não há manifesto no store: o próprio nome do arquivo carrega o hash. A
 * escrita é sempre atômica (temporário no mesmo diretório + rename) para um
 * leitor concorrente nunca enxergar um blob truncado.
 */

/** Ícones são pequenos; acima disso o arquivo não é um ícone válido. */
export const ICON_VAULT_MAX_BYTES = 4 * 1024 * 1024

/** Extensões aceitas no cofre (imagens decodificáveis + SVG gerado). */
const VAULT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg'])

/** SHA-256 em hexadecimal minúsculo — o único formato que vira nome de arquivo. */
const SHA_PATTERN = /^[a-f0-9]{64}$/

/** Resultado de `putIcon`: identidade do blob gravado (ou já existente). */
export interface VaultIcon {
  sha: string
  ext: string
  path: string
}

/** Pasta canônica do cofre de ícones. */
export function iconVaultDir(): string {
  return join(app.getPath('userData'), 'icon-vault')
}

/** Normaliza a extensão para a allowlist; null = entrada inválida. */
function normalizeExt(ext: unknown): string | null {
  if (typeof ext !== 'string') return null
  const lower = ext.trim().toLowerCase()
  return VAULT_EXTENSIONS.has(lower) ? lower : null
}

function isValidSha(sha: unknown): sha is string {
  return typeof sha === 'string' && SHA_PATTERN.test(sha)
}

function blobPath(sha: string, ext: string): string {
  return join(iconVaultDir(), `${sha}${ext}`)
}

/** Blob existente e legível (não vazio, dentro do teto). */
function isUsableBlob(filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    return stat.isFile() && stat.size > 0 && stat.size <= ICON_VAULT_MAX_BYTES
  } catch {
    return false
  }
}

/**
 * Escrita atômica: grava num temporário no mesmo diretório e renomeia. Assim
 * um leitor nunca vê o destino pela metade e uma falha não deixa lixo no cofre.
 * Nunca lança.
 */
function writeAtomic(targetPath: string, buffer: Buffer): boolean {
  let tempPath: string | null = null
  try {
    mkdirSync(dirname(targetPath), { recursive: true })
    tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`
    writeFileSync(tempPath, buffer)
    renameSync(tempPath, targetPath)
    tempPath = null
    return true
  } catch (err) {
    logger.warn('games', `Não foi possível gravar o ícone ${targetPath}:`, err)
    return false
  } finally {
    if (tempPath) {
      try {
        rmSync(tempPath, { force: true })
      } catch {
        // Temporário preso — o SO limpa depois.
      }
    }
  }
}

/**
 * Grava os bytes no cofre e devolve `{ sha, ext, path }`. Conteúdo repetido é
 * deduplicado pelo SHA (um único blob para todos os jogos com o mesmo ícone).
 * Entrada inválida ou falha de disco → null (nunca lança).
 */
export function putIcon(buffer: Buffer, extInput: string): VaultIcon | null {
  const ext = normalizeExt(extInput)
  if (!ext || !Buffer.isBuffer(buffer) || buffer.length === 0) return null
  if (buffer.length > ICON_VAULT_MAX_BYTES) return null
  try {
    const sha = createHash('sha256').update(buffer).digest('hex')
    const target = blobPath(sha, ext)
    // Blob íntegro já existe: nada a escrever. Um arquivo truncado/0 byte no
    // caminho é sobrescrito pela escrita atômica.
    if (isUsableBlob(target)) {
      try {
        const existing = statSync(target).size
        if (existing === buffer.length) return { sha, ext, path: target }
      } catch {
        // Cai na gravação abaixo.
      }
    }
    if (!writeAtomic(target, buffer)) return null
    return { sha, ext, path: target }
  } catch (err) {
    logger.warn('games', 'Falha ao gravar o ícone no cofre:', err)
    return null
  }
}

/** Lê o blob do cofre; null para sha/ext inválidos ou arquivo ilegível. */
export function readIcon(sha: unknown, extInput: unknown): Buffer | null {
  const ext = normalizeExt(extInput)
  if (!isValidSha(sha) || !ext) return null
  try {
    const target = blobPath(sha, ext)
    if (!isUsableBlob(target)) return null
    const buffer = readFileSync(target)
    return buffer.length > 0 ? buffer : null
  } catch {
    return null
  }
}

/** `true` quando o blob está presente e legível. */
export function hasIcon(sha: unknown, extInput: unknown): boolean {
  const ext = normalizeExt(extInput)
  if (!isValidSha(sha) || !ext) return false
  return isUsableBlob(blobPath(sha, ext))
}

/**
 * Regrava o blob em `targetPath` de forma atômica (materialização canônica).
 * `false` quando o blob não existe ou a escrita falha — nunca lança.
 */
export function materialize(sha: unknown, extInput: unknown, targetPath: string): boolean {
  const buffer = readIcon(sha, extInput)
  if (!buffer) return false
  return writeAtomic(targetPath, buffer)
}

/**
 * Remove o blob se nenhum jogo o referencia mais (GC da remoção de jogo).
 * `isReferenced` recebe o SHA e decide; devolve `true` quando apagou.
 * Best-effort: nunca lança.
 */
export function removeIfUnreferenced(
  sha: unknown,
  extInput: unknown,
  isReferenced: (sha: string) => boolean
): boolean {
  const ext = normalizeExt(extInput)
  if (!isValidSha(sha) || !ext) return false
  try {
    if (isReferenced(sha)) return false
    const target = blobPath(sha, ext)
    if (!existsSync(target)) return false
    rmSync(target, { force: true })
    return true
  } catch (err) {
    logger.warn('games', `Não foi possível remover o ícone ${sha}${ext} do cofre:`, err)
    return false
  }
}
