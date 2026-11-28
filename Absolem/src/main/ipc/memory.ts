import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  IpcError,
  MemoryCreateResult,
  MemoryExportResult,
  MemoryImportResult,
  MemoryListRequest,
  MemoryListResult,
  MemoryRemoveAllResult,
  MemoryRemoveResult,
  MemorySearchResult,
  MemoryStatsResult,
  MemoryUpdateResult
} from '../../shared/ipc'
import {
  MEMORY_CONTENT_MAX,
  MEMORY_REMOVE_ALL_CONFIRM,
  isMemoryKind,
  type MemoryArchiveRecord,
  type MemoryKind,
  type MemoryListPage,
  type MemoryListQuery,
  type MemoryMaintenanceEntry,
  type MemoryRecord,
  type MemorySort,
  type MemoryStats
} from '../../shared/memory'
import type {
  MemoryUpdatePatch,
  NewMemoryInput,
  RemoveAllOptions,
  RemoveAllResult
} from '../memory/repository'

/**
 * Casca IPC da memória (task 09/T6).
 *
 * Todo payload chega como `unknown` e é validado aqui; o serviço recebe dados
 * já tipados. `remove-all` exige o texto literal `APAGAR TUDO`; `update` nunca
 * aceita `id`, `created_at` ou campos desconhecidos. Erros sempre voltam como
 * `{ ok:false, error }`, nunca como exceção crua.
 */

export interface MemoryService {
  list: (query: MemoryListQuery) => MemoryListPage
  archived: (limit?: number) => MemoryArchiveRecord[]
  maintenance: (limit?: number) => MemoryMaintenanceEntry[]
  search: (query: string, limit?: number) => MemoryRecord[]
  create: (input: NewMemoryInput) => MemoryRecord
  update: (id: string, patch: MemoryUpdatePatch) => MemoryRecord | null
  remove: (id: string) => boolean
  removeAll: (options?: RemoveAllOptions) => RemoveAllResult
  stats: () => MemoryStats
  exportFile: (options: { includeTranscripts: boolean }) => Promise<MemoryExportResult>
  importFile: () => Promise<MemoryImportResult>
  /** Auditoria sem conteúdo (`{ at, op, id, kind }`). */
  recordAudit: (op: string, id: string | null, kind: string | null) => void
}

export type MemoryPayloadHandler = (payload: unknown) => unknown

const MAX_QUERY_CHARS = 500
const MAX_PAGE = 500
const SORTS: readonly MemorySort[] = ['date', 'usage', 'confidence']

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isVoid(value: unknown): boolean {
  return value === undefined || value === null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function rejectUnknown(
  payload: Record<string, unknown>,
  allowed: readonly string[]
): string | null {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) return `Campo desconhecido: ${key}.`
  }
  return null
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Campo ${field} inválido.`)
  const text = value.trim()
  if (text.length > max) throw new Error(`Campo ${field} passa de ${max} caracteres.`)
  return text
}

function optionalTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    throw new Error('Campo tags deve ser uma lista de textos.')
  }
  return value
}

function optionalConfidence(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Confiança deve ficar entre 0 e 1.')
  }
  return value
}

function optionalExpiresAt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('Expiração inválida.')
  }
  return Math.floor(value)
}

function optionalPinned(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error('Campo pinned deve ser booleano.')
  return value
}

function parseListRequest(payload: unknown): MemoryListRequest {
  if (isVoid(payload)) return {}
  if (!isRecord(payload)) throw new Error('Payload da lista inválido.')
  const unknown = rejectUnknown(payload, ['query', 'kind', 'sort', 'offset', 'limit'])
  if (unknown) throw new Error(unknown)
  const request: MemoryListRequest = {}
  if (payload.query !== undefined) {
    if (typeof payload.query !== 'string') throw new Error('Busca inválida.')
    if (payload.query.length > MAX_QUERY_CHARS) throw new Error('Busca longa demais.')
    request.query = payload.query
  }
  if (payload.kind !== undefined) {
    if (!isMemoryKind(payload.kind)) throw new Error('Tipo de memória inválido.')
    request.kind = payload.kind
  }
  if (payload.sort !== undefined) {
    if (typeof payload.sort !== 'string' || !SORTS.includes(payload.sort as MemorySort)) {
      throw new Error('Ordenação inválida.')
    }
    request.sort = payload.sort as MemorySort
  }
  if (payload.offset !== undefined) {
    if (
      typeof payload.offset !== 'number' ||
      !Number.isInteger(payload.offset) ||
      payload.offset < 0
    ) {
      throw new Error('Deslocamento inválido.')
    }
    request.offset = payload.offset
  }
  if (payload.limit !== undefined) {
    if (
      typeof payload.limit !== 'number' ||
      !Number.isInteger(payload.limit) ||
      payload.limit < 1 ||
      payload.limit > MAX_PAGE
    ) {
      throw new Error(`Limite deve ficar entre 1 e ${MAX_PAGE}.`)
    }
    request.limit = payload.limit
  }
  return request
}

function parseCreate(payload: unknown): NewMemoryInput {
  if (!isRecord(payload)) throw new Error(`Payload inválido para ${IPC.memoryCreate}.`)
  const unknown = rejectUnknown(payload, [
    'kind',
    'content',
    'tags',
    'confidence',
    'expiresAt',
    'pinned'
  ])
  if (unknown) throw new Error(unknown)
  if (!isMemoryKind(payload.kind)) throw new Error('Tipo de memória inválido.')
  const content = requireText(payload.content, 'content', MEMORY_CONTENT_MAX)
  const input: NewMemoryInput = { kind: payload.kind, content, source: 'manual' }
  const tags = optionalTags(payload.tags)
  if (tags !== undefined) input.tags = tags
  const confidence = optionalConfidence(payload.confidence)
  if (confidence !== undefined) input.confidence = confidence
  const expiresAt = optionalExpiresAt(payload.expiresAt)
  if (expiresAt !== undefined) input.expiresAt = expiresAt
  const pinned = optionalPinned(payload.pinned)
  if (pinned !== undefined) input.pinned = pinned
  return input
}

function parseUpdate(payload: unknown): { id: string; patch: MemoryUpdatePatch } {
  if (!isRecord(payload)) throw new Error(`Payload inválido para ${IPC.memoryUpdate}.`)
  const unknown = rejectUnknown(payload, ['id', 'patch'])
  if (unknown) throw new Error(unknown)
  const id = requireText(payload.id, 'id', 100)
  if (!isRecord(payload.patch)) throw new Error('Patch da memória inválido.')
  const patchUnknown = rejectUnknown(payload.patch, [
    'kind',
    'content',
    'tags',
    'confidence',
    'expiresAt',
    'pinned'
  ])
  if (patchUnknown) throw new Error(patchUnknown)

  const patch: MemoryUpdatePatch = {}
  if (payload.patch.kind !== undefined) {
    if (!isMemoryKind(payload.patch.kind)) throw new Error('Tipo de memória inválido.')
    patch.kind = payload.patch.kind
  }
  if (payload.patch.content !== undefined) {
    patch.content = requireText(payload.patch.content, 'content', MEMORY_CONTENT_MAX)
  }
  const tags = optionalTags(payload.patch.tags)
  if (tags !== undefined) patch.tags = tags
  const confidence = optionalConfidence(payload.patch.confidence)
  if (confidence !== undefined) patch.confidence = confidence
  const expiresAt = optionalExpiresAt(payload.patch.expiresAt)
  if (expiresAt !== undefined) patch.expiresAt = expiresAt
  const pinned = optionalPinned(payload.patch.pinned)
  if (pinned !== undefined) patch.pinned = pinned
  return { id, patch }
}

function parseRemove(payload: unknown): string {
  if (!isRecord(payload)) throw new Error(`Payload inválido para ${IPC.memoryRemove}.`)
  const unknown = rejectUnknown(payload, ['id'])
  if (unknown) throw new Error(unknown)
  return requireText(payload.id, 'id', 100)
}

function parseRemoveAll(payload: unknown): RemoveAllOptions {
  if (!isRecord(payload)) throw new Error(`Payload inválido para ${IPC.memoryRemoveAll}.`)
  const unknown = rejectUnknown(payload, ['confirm', 'includeTurns'])
  if (unknown) throw new Error(unknown)
  if (payload.confirm !== MEMORY_REMOVE_ALL_CONFIRM) {
    throw new Error(`Confirmação inválida: escreva exatamente "${MEMORY_REMOVE_ALL_CONFIRM}".`)
  }
  if (payload.includeTurns !== undefined && typeof payload.includeTurns !== 'boolean') {
    throw new Error('Campo includeTurns deve ser booleano.')
  }
  return { includeTurns: payload.includeTurns === true }
}

function parseExport(payload: unknown): { includeTranscripts: boolean } {
  if (isVoid(payload)) return { includeTranscripts: false }
  if (!isRecord(payload)) throw new Error(`Payload inválido para ${IPC.memoryExport}.`)
  const unknown = rejectUnknown(payload, ['includeTranscripts'])
  if (unknown) throw new Error(unknown)
  if (payload.includeTranscripts !== undefined && typeof payload.includeTranscripts !== 'boolean') {
    throw new Error('Campo includeTranscripts deve ser booleano.')
  }
  return { includeTranscripts: payload.includeTranscripts === true }
}

/** Handlers puros por canal (testáveis sem Electron). */
export function createMemoryHandlers(service: MemoryService): Record<string, MemoryPayloadHandler> {
  const safe = <T>(run: () => T): T | IpcError => {
    try {
      return run()
    } catch (error) {
      return failure(errorMessage(error))
    }
  }

  return {
    [IPC.memoryList]: (payload): MemoryListResult =>
      safe(() => {
        const request = parseListRequest(payload)
        const page = service.list(request)
        const offset = request.offset ?? 0
        return {
          ok: true,
          memories: page.memories,
          total: page.total,
          hasMore: offset + page.memories.length < page.total,
          archived: service.archived(50),
          maintenance: service.maintenance(20)
        }
      }),
    [IPC.memorySearch]: (payload): MemorySearchResult =>
      safe(() => {
        if (!isRecord(payload)) throw new Error(`Payload inválido para ${IPC.memorySearch}.`)
        const unknown = rejectUnknown(payload, ['query', 'limit'])
        if (unknown) throw new Error(unknown)
        const query = requireText(payload.query, 'query', MAX_QUERY_CHARS)
        const limit =
          payload.limit === undefined
            ? 50
            : typeof payload.limit === 'number' &&
                Number.isInteger(payload.limit) &&
                payload.limit >= 1 &&
                payload.limit <= 200
              ? payload.limit
              : null
        if (limit === null) throw new Error('Limite deve ficar entre 1 e 200.')
        return { ok: true, memories: service.search(query, limit) }
      }),
    [IPC.memoryCreate]: (payload): MemoryCreateResult =>
      safe(() => {
        const memory = service.create(parseCreate(payload))
        service.recordAudit('create', memory.id, memory.kind)
        return { ok: true, memory }
      }),
    [IPC.memoryUpdate]: (payload): MemoryUpdateResult =>
      safe(() => {
        const { id, patch } = parseUpdate(payload)
        const memory = service.update(id, patch)
        if (!memory) return failure('Memória não encontrada.')
        service.recordAudit('update', memory.id, memory.kind)
        return { ok: true, memory }
      }),
    [IPC.memoryRemove]: (payload): MemoryRemoveResult =>
      safe(() => {
        const id = parseRemove(payload)
        const removed = service.remove(id)
        if (removed) service.recordAudit('remove', id, null)
        return { ok: true, removed }
      }),
    [IPC.memoryRemoveAll]: (payload): MemoryRemoveAllResult =>
      safe(() => {
        const options = parseRemoveAll(payload)
        const result = service.removeAll(options)
        service.recordAudit('remove-all', null, null)
        return {
          ok: true,
          removed: result.removed,
          turns: result.turns,
          sessions: result.sessions
        }
      }),
    [IPC.memoryStats]: (payload): MemoryStatsResult =>
      safe(() => {
        if (!isVoid(payload)) return failure(`Payload inválido para ${IPC.memoryStats}.`)
        return { ok: true, stats: service.stats() }
      }),
    [IPC.memoryExport]: (payload: unknown): Promise<MemoryExportResult> => {
      let options: { includeTranscripts: boolean }
      try {
        options = parseExport(payload)
      } catch (error) {
        return Promise.resolve(failure(errorMessage(error)))
      }
      return service
        .exportFile(options)
        .then((result) => {
          if (result.ok && !result.canceled) service.recordAudit('export', null, null)
          return result
        })
        .catch((error: unknown) => failure(errorMessage(error)))
    },
    [IPC.memoryImport]: (payload: unknown): Promise<MemoryImportResult> => {
      if (!isVoid(payload)) {
        return Promise.resolve(failure(`Payload inválido para ${IPC.memoryImport}.`))
      }
      return service
        .importFile()
        .then((result) => {
          if (result.ok && !result.canceled) service.recordAudit('import', null, null)
          return result
        })
        .catch((error: unknown) => failure(errorMessage(error)))
    }
  }
}

/** Registra os 9 canais. `ipcMain.handle` é o único ponto que toca Electron. */
export function registerMemoryIpc(service: MemoryService): void {
  const handlers = createMemoryHandlers(service)
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, payload: unknown) => handler(payload))
  }
}

/** Reexporta o tipo do `kind` para consumidores do serviço. */
export type { MemoryKind }
