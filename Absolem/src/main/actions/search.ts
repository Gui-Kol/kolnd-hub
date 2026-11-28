import { isPathInsideOrEqual } from './paths'

/**
 * Pesquisa de arquivos por nome (task 08, T4).
 *
 * Raízes permitidas vêm do chamador (Documentos, Área de Trabalho, Downloads e
 * pastas que o usuário adicionar). A varredura:
 * - profundidade máxima 6;
 * - no máximo 200 resultados;
 * - timeout de 10 s devolvendo os parciais;
 * - pula ocultos, `node_modules`, `AppData`, lixeira e reparse points;
 * - nenhuma dependência nova: `fs.promises.readdir` com fila e deadline.
 */

export interface SearchDirent {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
  isSymbolicLink: () => boolean
}

export interface SearchFs {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<SearchDirent[]>
}

export interface SearchInput {
  query: string
  roots?: string[]
  maxResults?: number
}

export interface SearchResultItem {
  name: string
  path: string
  depth: number
  score: number
}

export interface SearchResult {
  results: SearchResultItem[]
  truncated: boolean
  timedOut: boolean
  scannedDirectories: number
}

export interface SearchDeps {
  fs: SearchFs
  /** Raízes padrão + pastas adicionadas pelo usuário. */
  allowedRoots: string[]
  now?: () => number
  timeoutMs?: number
  maxDepth?: number
  defaultMaxResults?: number
}

export const SEARCH_MAX_DEPTH = 6
export const SEARCH_MAX_RESULTS = 200
export const SEARCH_TIMEOUT_MS = 10_000

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'appdata',
  '$recycle.bin',
  'system volume information'
])

export interface DefaultSearchPaths {
  documents: string
  desktop: string
  downloads: string
}

export function defaultSearchRoots(paths: DefaultSearchPaths): string[] {
  return [paths.documents, paths.desktop, paths.downloads].filter(
    (path) => typeof path === 'string' && path.length > 0
  )
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${name}`
}

function shouldSkipDirectory(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('.') || lower.startsWith('~$') || SKIPPED_DIRECTORIES.has(lower)
}

function scoreName(name: string, query: string): number {
  const lower = name.toLowerCase()
  const index = lower.indexOf(query)
  if (index < 0) return -1
  const boundary = index === 0 || /[\s._-]/.test(lower[index - 1] ?? '')
  return (index === 0 ? 1_000 : 500 - index) + (boundary ? 50 : 0)
}

export async function searchFiles(deps: SearchDeps, input: SearchInput): Promise<SearchResult> {
  const query = typeof input?.query === 'string' ? input.query.trim() : ''
  if (!query) throw new Error('Consulta vazia: informe parte do nome do arquivo.')
  if (query.length > 100) throw new Error('Consulta longa demais (máximo 100 caracteres).')

  const allowedRoots = deps.allowedRoots.filter(
    (root) => typeof root === 'string' && root.trim().length > 0
  )
  if (allowedRoots.length === 0) throw new Error('Nenhuma pasta de pesquisa permitida.')

  const requested = Array.isArray(input.roots)
    ? input.roots.filter((root): root is string => typeof root === 'string' && root.trim() !== '')
    : []
  const roots =
    requested.length > 0
      ? requested.filter((root) =>
          allowedRoots.some((allowed) => isPathInsideOrEqual(allowed, root))
        )
      : allowedRoots
  if (roots.length === 0) throw new Error('Pasta de pesquisa fora das raízes permitidas.')

  const maxResults = Math.min(
    SEARCH_MAX_RESULTS,
    Math.max(1, Math.floor(input.maxResults ?? deps.defaultMaxResults ?? SEARCH_MAX_RESULTS))
  )
  const timeoutMs = deps.timeoutMs ?? SEARCH_TIMEOUT_MS
  const maxDepth = deps.maxDepth ?? SEARCH_MAX_DEPTH
  const now = deps.now ?? (() => Date.now())
  const startedAt = now()
  const normalizedQuery = query.toLowerCase()

  const results: SearchResultItem[] = []
  const queue: Array<{ dir: string; depth: number }> = roots.map((dir) => ({ dir, depth: 0 }))
  let scannedDirectories = 0
  let timedOut = false
  let truncated = false

  const expired = (): boolean => now() - startedAt >= timeoutMs

  while (queue.length > 0) {
    if (expired()) {
      timedOut = true
      break
    }
    const current = queue.shift()
    if (!current) break
    let entries: SearchDirent[]
    try {
      entries = await deps.fs.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    scannedDirectories += 1
    for (const entry of entries) {
      if (expired()) {
        timedOut = true
        break
      }
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (current.depth >= maxDepth || shouldSkipDirectory(entry.name)) continue
        queue.push({ dir: joinPath(current.dir, entry.name), depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue
      const score = scoreName(entry.name, normalizedQuery)
      if (score < 0) continue
      results.push({
        name: entry.name,
        path: joinPath(current.dir, entry.name),
        depth: current.depth,
        score
      })
      if (results.length >= maxResults) {
        truncated = true
        break
      }
    }
    if (truncated || timedOut) break
  }

  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return { results, truncated, timedOut, scannedDirectories }
}
