import { randomUUID } from 'crypto'
import { win32 } from 'path'
import {
  hasTraversal,
  isPathInside,
  isPathInsideOrEqual,
  isSafeInputPath,
  isUncPath
} from './paths'

/**
 * Organização de arquivos com plano, journal e desfazer (task 08, T6).
 *
 * - plano de 1..10 operações (`move`, `rename`, `copy`, `delete`);
 * - origem e destino sob raízes permitidas, sem sobrescrever, sem ciclo e sem
 *   reparse point no caminho ou no pai imediato;
 * - a execução só acontece depois da confirmação (feita pelo roteador/tool);
 * - cada execução grava `userData/file-ops/<uuid>.json`;
 * - `undo` reverte na ordem inversa dentro de 24 h;
 * - exclusão vai para a Lixeira (`shell.trashItem`), nunca `unlink`.
 */

export const MAX_FILE_OPS = 10
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000

export type FileOpKind = 'move' | 'rename' | 'copy' | 'delete'

export interface FileOpInput {
  kind: FileOpKind
  from: string
  to?: string
}

export interface PlannedFileOp {
  kind: FileOpKind
  from: string
  to: string | null
  bytes: number
}

export interface FilePlan {
  ops: PlannedFileOp[]
  totalBytes: number
  summary: string
}

export interface StatLike {
  size: number
  isFile: () => boolean
  isDirectory: () => boolean
  isSymbolicLink: () => boolean
}

export interface FileOpsFs {
  realpath: (path: string) => Promise<string>
  lstat: (path: string) => Promise<StatLike>
  stat: (path: string) => Promise<StatLike>
  exists: (path: string) => Promise<boolean>
  rename: (from: string, to: string) => Promise<void>
  copyFile: (from: string, to: string) => Promise<void>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, data: string, encoding: 'utf8') => Promise<void>
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>
  unlink: (path: string) => Promise<void>
}

export interface FileOpsDeps {
  fs: FileOpsFs
  roots: string[]
  journalDir: string
  trashItem: (path: string) => Promise<void>
  now?: () => number
  uuid?: () => string
}

export interface ApplyFileOpsResult {
  ok: true
  id: string
  ops: PlannedFileOp[]
  totalBytes: number
}

interface Journal {
  v: 1
  at: number
  ops: Array<{ from: string; to: string | null; kind: FileOpKind }>
}

function rootsOf(deps: FileOpsDeps): string[] {
  return deps.roots.filter((root) => typeof root === 'string' && root.length > 0)
}

function isUnderRoots(roots: string[], path: string): boolean {
  return roots.some((root) => isPathInsideOrEqual(root, path))
}

async function assertNotReparse(fs: FileOpsFs, path: string): Promise<void> {
  try {
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink()) throw new Error(`Reparse point não é permitido: ${path}`)
  } catch (err) {
    if (err instanceof Error && err.message.includes('Reparse')) throw err
  }
}

async function resolveSource(
  deps: FileOpsDeps,
  input: string
): Promise<{ path: string; stat: StatLike }> {
  if (!isSafeInputPath(input)) {
    throw new Error('Caminho de origem inválido (absoluto, sem UNC ou "..").')
  }
  await assertNotReparse(deps.fs, input)
  const resolved = await deps.fs.realpath(input)
  if (isUncPath(resolved)) throw new Error('Caminho UNC não é permitido.')
  const roots = rootsOf(deps)
  if (!isUnderRoots(roots, resolved)) throw new Error(`Origem fora das raízes permitidas: ${input}`)
  const stat = await deps.fs.lstat(resolved)
  if (stat.isSymbolicLink()) throw new Error('Reparse point não é permitido na origem.')
  return { path: resolved, stat }
}

async function resolveDestination(
  deps: FileOpsDeps,
  input: string,
  sourcePath: string
): Promise<string> {
  if (!isSafeInputPath(input)) {
    throw new Error('Caminho de destino inválido (absoluto, sem UNC ou "..").')
  }
  if (isUncPath(input) || hasTraversal(input)) throw new Error('Destino UNC/.. não é permitido.')

  const parentInput = win32.dirname(input)
  const parentResolved = await deps.fs.realpath(parentInput)
  if (isUncPath(parentResolved)) throw new Error('Caminho UNC não é permitido.')
  const roots = rootsOf(deps)
  if (!isUnderRoots(roots, parentResolved)) {
    throw new Error(`Destino fora das raízes permitidas: ${input}`)
  }
  const parentStat = await deps.fs.lstat(parentResolved)
  if (parentStat.isSymbolicLink()) throw new Error('Pai do destino é reparse point.')

  const destination = win32.join(parentResolved, win32.basename(input))
  if (await deps.fs.exists(destination)) {
    throw new Error(`Destino já existe; sobrescrever não é permitido: ${destination}`)
  }
  if (destination.toLowerCase() === sourcePath.toLowerCase()) {
    throw new Error('Origem e destino são iguais.')
  }
  if (isPathInside(sourcePath, destination)) {
    throw new Error('Não é permitido mover uma pasta para dentro dela mesma.')
  }
  return destination
}

function summarize(ops: PlannedFileOp[], totalBytes: number): string {
  const lines = ops.map((op) => {
    if (op.kind === 'delete') return `delete ${op.from} (Lixeira)`
    return `${op.kind} ${op.from} -> ${op.to}`
  })
  return `${ops.length} operação(ões), ${totalBytes} bytes\n${lines.join('\n')}`
}

export async function planFileOps(
  deps: FileOpsDeps,
  input: { ops: FileOpInput[] }
): Promise<FilePlan> {
  const inputOps = input?.ops
  if (!Array.isArray(inputOps) || inputOps.length === 0) {
    throw new Error('Informe entre 1 e 10 operações.')
  }
  if (inputOps.length > MAX_FILE_OPS) {
    throw new Error(`Máximo de ${MAX_FILE_OPS} operações por pedido.`)
  }

  const planned: PlannedFileOp[] = []
  const sources = new Set<string>()
  const destinations = new Set<string>()
  let totalBytes = 0

  for (const op of inputOps) {
    if (!op || typeof op !== 'object') throw new Error('Operação inválida.')
    const kind = op.kind
    if (kind !== 'move' && kind !== 'rename' && kind !== 'copy' && kind !== 'delete') {
      throw new Error('Tipo de operação inválido (move, rename, copy ou delete).')
    }
    const source = await resolveSource(deps, op.from)
    const sourceKey = source.path.toLowerCase()
    if (sources.has(sourceKey)) throw new Error(`Origem repetida no plano: ${source.path}`)
    sources.add(sourceKey)

    let destination: string | null = null
    if (kind !== 'delete') {
      if (typeof op.to !== 'string' || !op.to.trim()) {
        throw new Error(`Operação ${kind} exige destino.`)
      }
      destination = await resolveDestination(deps, op.to, source.path)
      const destinationKey = destination.toLowerCase()
      if (destinations.has(destinationKey)) {
        throw new Error(`Destino repetido no plano: ${destination}`)
      }
      destinations.add(destinationKey)
    }

    const bytes = kind === 'delete' || source.stat.isFile() ? source.stat.size : 0
    if (kind !== 'delete') totalBytes += bytes
    planned.push({ kind, from: source.path, to: destination, bytes })
  }

  // Ciclo: qualquer destino que também é origem (ex.: a->b e b->a).
  for (const destination of destinations) {
    if (sources.has(destination.toLowerCase())) {
      throw new Error('Plano com ciclo: um destino também é origem de outra operação.')
    }
  }

  return { ops: planned, totalBytes, summary: summarize(planned, totalBytes) }
}

export async function applyFileOps(deps: FileOpsDeps, plan: FilePlan): Promise<ApplyFileOpsResult> {
  const validated = await planFileOps(deps, {
    ops: plan.ops.map((op) => ({
      kind: op.kind,
      from: op.from,
      ...(op.to ? { to: op.to } : {})
    }))
  })
  const now = deps.now ?? (() => Date.now())
  const uuid = deps.uuid ?? randomUUID
  const id = uuid()
  const performed: PlannedFileOp[] = []

  const writeJournal = async (): Promise<void> => {
    const journal: Journal = {
      v: 1,
      at: now(),
      ops: performed.map((op) => ({ from: op.from, to: op.to, kind: op.kind }))
    }
    await deps.fs.mkdir(deps.journalDir, { recursive: true })
    await deps.fs.writeFile(
      win32.join(deps.journalDir, `${id}.json`),
      JSON.stringify(journal),
      'utf8'
    )
  }

  try {
    for (const op of validated.ops) {
      if (op.kind === 'delete') {
        await deps.trashItem(op.from)
      } else if (op.kind === 'copy') {
        await deps.fs.copyFile(op.from, op.to as string)
      } else {
        await deps.fs.rename(op.from, op.to as string)
      }
      performed.push(op)
    }
  } catch (err) {
    if (performed.length > 0) {
      try {
        await writeJournal()
      } catch {
        // best-effort: o erro original é mais importante
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Falha ao executar o plano: ${message}`, { cause: err })
  }

  await writeJournal()
  return { ok: true, id, ops: performed, totalBytes: validated.totalBytes }
}

export async function undoFileOp(
  deps: FileOpsDeps,
  id: string
): Promise<{ ok: true; id: string; undone: number }> {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(id)) {
    throw new Error('Id de journal inválido.')
  }
  const journalPath = win32.join(deps.journalDir, `${id}.json`)
  let journal: Journal
  try {
    journal = JSON.parse(await deps.fs.readFile(journalPath, 'utf8')) as Journal
  } catch {
    throw new Error('Journal não encontrado.')
  }
  if (!journal || journal.v !== 1 || !Array.isArray(journal.ops)) {
    throw new Error('Journal inválido.')
  }
  const now = deps.now ?? (() => Date.now())
  if (typeof journal.at !== 'number' || now() - journal.at > UNDO_WINDOW_MS) {
    throw new Error('Desfazer expirou: a janela é de 24 h.')
  }
  if (journal.ops.some((op) => op.kind === 'delete')) {
    throw new Error('Exclusão vai para a Lixeira; restaure manualmente pelo Windows.')
  }

  for (const op of [...journal.ops].reverse()) {
    if (!op.to) throw new Error('Journal sem destino para desfazer.')
    const destinationExists = await deps.fs.exists(op.to)
    const sourceExists = await deps.fs.exists(op.from)
    if (!destinationExists || sourceExists) {
      throw new Error('Desfazer recusado: o destino sumiu ou a origem voltou a existir.')
    }
    if (op.kind === 'copy') {
      await deps.trashItem(op.to)
    } else {
      await deps.fs.rename(op.to, op.from)
    }
  }

  try {
    await deps.fs.unlink(journalPath)
  } catch {
    // best-effort: o journal fica e um novo undo falha na verificação acima.
  }
  return { ok: true, id, undone: journal.ops.length }
}
