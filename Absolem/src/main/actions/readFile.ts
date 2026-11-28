import { extname } from 'path'
import { isPathInside, isSafeInputPath, isUncPath } from './paths'

/**
 * Leitura de arquivo com limites (task 08, T5).
 *
 * O caminho é resolvido por `fs.realpath`; UNC, `..`, reparse point para fora e
 * extensão fora da allowlist são recusados. O conteúdo lido é dado NÃO
 * confiável no prompt (mesmo tratamento da tela) e nunca vai para a auditoria.
 */

export const READ_ALLOWED_EXTENSIONS = [
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.log',
  '.ts',
  '.tsx',
  '.js',
  '.py',
  '.css',
  '.html',
  '.yml',
  '.yaml'
] as const

export const READ_MAX_BYTES = 1024 * 1024
export const READ_MAX_LINES = 2_000

export interface ReadFileFs {
  realpath: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ size: number; isFile: () => boolean }>
  /** Lê no máximo `maxBytes`; produção usa `open` + `read` do fs.promises. */
  readPrefix: (path: string, maxBytes: number) => Promise<Buffer>
}

export interface ReadFileInput {
  path: string
  maxBytes?: number
}

export interface ReadFileResult {
  path: string
  text: string
  truncated: boolean
  bytes: number
  lines: number
}

export interface ReadFileDeps {
  fs: ReadFileFs
  roots: string[]
}

function extensionAllowed(path: string): boolean {
  return (READ_ALLOWED_EXTENSIONS as readonly string[]).includes(extname(path).toLowerCase())
}

export async function readTextFile(
  deps: ReadFileDeps,
  input: ReadFileInput
): Promise<ReadFileResult> {
  const inputPath = typeof input?.path === 'string' ? input.path.trim() : ''
  if (!inputPath) throw new Error('Caminho vazio.')
  if (isUncPath(inputPath)) throw new Error('Caminho UNC não é permitido.')
  if (!isSafeInputPath(inputPath)) {
    throw new Error('Caminho inválido: use um caminho absoluto, sem "..".')
  }

  const resolved = await deps.fs.realpath(inputPath)
  if (isUncPath(resolved)) throw new Error('Caminho UNC não é permitido.')

  const roots = deps.roots.filter((root) => typeof root === 'string' && root.length > 0)
  if (!roots.some((root) => isPathInside(root, resolved))) {
    throw new Error('Arquivo fora das raízes permitidas.')
  }
  if (!extensionAllowed(resolved)) {
    throw new Error(
      `Extensão não permitida para leitura. Aceitas: ${READ_ALLOWED_EXTENSIONS.join(', ')}.`
    )
  }

  const stat = await deps.fs.stat(resolved)
  if (!stat.isFile()) throw new Error('O caminho não é um arquivo.')

  const requested = typeof input.maxBytes === 'number' ? Math.floor(input.maxBytes) : READ_MAX_BYTES
  const maxBytes = Math.min(READ_MAX_BYTES, Math.max(1, requested))
  const buffer = await deps.fs.readPrefix(resolved, maxBytes + 1)

  const probe = buffer.subarray(0, Math.min(8_192, buffer.length))
  if (probe.includes(0)) throw new Error('Arquivo binário não é permitido.')

  let truncated = buffer.length > maxBytes || stat.size > maxBytes
  let bytes = Math.min(buffer.length, maxBytes)
  let text = buffer.subarray(0, maxBytes).toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const allLines = text.split(/\r?\n/)
  let lines = allLines.length
  if (lines > READ_MAX_LINES) {
    text = allLines.slice(0, READ_MAX_LINES).join('\n')
    lines = READ_MAX_LINES
    truncated = true
    bytes = Buffer.byteLength(text, 'utf8')
  }

  return { path: resolved, text, truncated, bytes, lines }
}
