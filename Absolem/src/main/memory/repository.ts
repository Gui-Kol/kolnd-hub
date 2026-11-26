import { randomUUID } from 'crypto'
import {
  MEMORY_ACTIVE_LIMIT,
  MEMORY_CONTENT_MAX,
  MEMORY_DEFAULT_CONFIDENCE,
  MEMORY_TAGS_MAX,
  MEMORY_TAG_MAX,
  MEMORY_TEMPORARY_TTL_MS,
  isMemoryKind,
  type MemoryArchiveRecord,
  type MemoryKind,
  type MemoryListPage,
  type MemoryListQuery,
  type MemoryMaintenanceEntry,
  type MemoryRecord,
  type MemorySession,
  type MemorySort,
  type MemoryTurn
} from '../../shared/memory'
import type { SqlDatabase } from './db'

/**
 * RepositÃ³rio da memÃ³ria: toda escrita passa por aqui.
 *
 * - validaÃ§Ã£o de entrada (kind, conteÃºdo, tags, confianÃ§a, expiraÃ§Ã£o);
 * - transaÃ§Ã£o explÃ­cita em `insert`/`update`/`remove`/`removeAll`;
 * - FTS5 atualizado pelos triggers; `remove` e `removeAll` tambÃ©m rodam
 *   `rebuild` na mesma transaÃ§Ã£o (nada de resultado fantasma);
 * - turnos/sessÃµes da voz no mesmo banco, com `interrupted` marcado.
 */

export class MemoryValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryValidationError'
  }
}

export interface NewMemoryInput {
  kind: unknown
  content: unknown
  tags?: unknown
  confidence?: unknown
  source?: unknown
  expiresAt?: unknown
  pinned?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  lastUsedAt?: unknown
  useCount?: unknown
}

export type MemoryUpdatePatch = {
  kind?: unknown
  content?: unknown
  tags?: unknown
  confidence?: unknown
  expiresAt?: unknown
  pinned?: unknown
}

export interface RemoveAllOptions {
  includeTurns?: boolean
}

export interface RemoveAllResult {
  removed: number
  turns: number
  sessions: number
}

export interface RankedMemory {
  memory: MemoryRecord
  /** bm25 cru do SQLite (negativo; mais negativo = mais relevante). */
  rank: number
}

export interface TurnInput {
  sessionId: string
  role: 'user' | 'model'
  content: string
  at: number
  interrupted?: boolean
}

export interface MemoryRepository {
  handle: SqlDatabase
  insert: (input: NewMemoryInput) => MemoryRecord
  get: (id: string) => MemoryRecord | null
  update: (id: string, patch: MemoryUpdatePatch) => MemoryRecord | null
  remove: (id: string) => boolean
  list: (query?: MemoryListQuery) => MemoryListPage
  search: (query: string, options?: { limit?: number; now?: number }) => MemoryRecord[]
  searchRanked: (query: string, options?: { limit?: number; now?: number }) => RankedMemory[]
  listPriority: (options?: { limit?: number; now?: number }) => MemoryRecord[]
  touch: (ids: string[], at?: number) => number
  removeAll: (options?: RemoveAllOptions) => RemoveAllResult
  listArchived: (limit?: number) => MemoryArchiveRecord[]
  maintenance: (limit?: number) => MemoryMaintenanceEntry[]
  turns: {
    startSession: (sessionId: string, at: number) => void
    endSession: (sessionId: string, at: number, summary?: string | null) => void
    insert: (turn: TurnInput) => number
    list: (sessionId: string, limit?: number) => MemoryTurn[]
    sessionTurns: (sessionId: string, limit?: number) => MemoryTurn[]
    recent: (limit?: number) => MemoryTurn[]
    countSession: (sessionId: string) => number
    countAll: () => number
    listSessions: () => MemorySession[]
    clear: () => number
  }
}

export interface MemoryRow {
  id: string
  kind: string
  content: string
  tags: string
  confidence: number
  source: string
  created_at: number
  updated_at: number
  last_used_at: number | null
  use_count: number
  expires_at: number | null
  pinned: number
}

interface ArchiveRow extends MemoryRow {
  archived_at: number
  reason: string
}

interface RankedRow extends MemoryRow {
  rank: number
}

interface CountRow {
  total: number
}

interface MetaRow {
  value: string
}

interface TurnRow {
  id: number
  session_id: string
  role: string
  content: string
  at: number
  interrupted: number
}

interface SessionRow {
  id: string
  started_at: number
  ended_at: number | null
  summary: string | null
}

const SORT_SQL: Record<MemorySort, string> = {
  date: 'updated_at DESC, id DESC',
  usage: 'use_count DESC, COALESCE(last_used_at, updated_at) DESC',
  confidence: 'confidence DESC, updated_at DESC'
}

const ALLOWED_PATCH_KEYS = new Set(['kind', 'content', 'tags', 'confidence', 'expiresAt', 'pinned'])

/** Recusa qualquer campo que nÃ£o seja editÃ¡vel (ex.: `id`, `createdAt`). */
export function assertAllowedPatchKeys(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_PATCH_KEYS.has(key)) {
      throw new MemoryValidationError(`Campo nÃ£o editÃ¡vel: ${key}.`)
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegativeInt(value: unknown, fallback = 0): number {
  const parsed = numberOr(value, fallback)
  return Math.max(0, Math.floor(parsed))
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Math.floor(numberOr(value, fallback))
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(max, parsed)
}

export function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    return []
  }
}

export function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new MemoryValidationError('Tags devem ser uma lista de textos.')
  }
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new MemoryValidationError('Cada tag deve ser um texto.')
    }
    const tag = item.trim().replace(/\s+/g, ' ')
    if (!tag) continue
    if (tag.length > MEMORY_TAG_MAX) {
      throw new MemoryValidationError(`Cada tag deve ter no mÃ¡ximo ${MEMORY_TAG_MAX} caracteres.`)
    }
    const key = tag.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MEMORY_TAGS_MAX) break
  }
  return tags
}

export function requireContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw new MemoryValidationError('ConteÃºdo da memÃ³ria deve ser texto.')
  }
  const content = value.trim()
  if (!content) {
    throw new MemoryValidationError('ConteÃºdo da memÃ³ria nÃ£o pode ficar vazio.')
  }
  if (content.length > MEMORY_CONTENT_MAX) {
    throw new MemoryValidationError(
      `ConteÃºdo da memÃ³ria passa de ${MEMORY_CONTENT_MAX} caracteres.`
    )
  }
  return content
}

export function requireKind(value: unknown): MemoryKind {
  if (!isMemoryKind(value)) {
    throw new MemoryValidationError('Tipo de memÃ³ria invÃ¡lido.')
  }
  return value
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new MemoryValidationError('Identificador de memÃ³ria invÃ¡lido.')
  }
  return value.trim()
}

function clampConfidence(value: unknown, fallback: number): number {
  const parsed = numberOr(value, fallback)
  return Math.min(1, Math.max(0, parsed))
}

function normalizeSource(value: unknown): string {
  if (value === undefined) return 'manual'
  if (typeof value !== 'string') {
    throw new MemoryValidationError('Origem da memÃ³ria invÃ¡lida.')
  }
  const source = value.trim().slice(0, 30)
  return source || 'manual'
}

function normalizeExpiresAt(kind: MemoryKind, value: unknown, now: number): number | null {
  if (kind !== 'temporary') return null
  if (value === undefined || value === null) return now + MEMORY_TEMPORARY_TTL_MS
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new MemoryValidationError('ExpiraÃ§Ã£o da memÃ³ria temporÃ¡ria invÃ¡lida.')
  }
  return Math.floor(value)
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 1
}

export function mapMemoryRow(row: MemoryRow): MemoryRecord {
  if (!isMemoryKind(row.kind)) {
    throw new MemoryValidationError(`Tipo de memÃ³ria corrompido no banco: ${row.kind}`)
  }
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    tags: parseTags(row.tags),
    confidence: numberOr(row.confidence, MEMORY_DEFAULT_CONFIDENCE),
    source: row.source,
    createdAt: numberOr(row.created_at, 0),
    updatedAt: numberOr(row.updated_at, 0),
    lastUsedAt: row.last_used_at === null ? null : numberOr(row.last_used_at, 0),
    useCount: nonNegativeInt(row.use_count),
    expiresAt: row.expires_at === null ? null : numberOr(row.expires_at, 0),
    pinned: parseBoolean(row.pinned)
  }
}

function mapArchiveRow(row: ArchiveRow): MemoryArchiveRecord {
  return {
    ...mapMemoryRow(row),
    archivedAt: numberOr(row.archived_at, 0),
    reason: row.reason
  }
}

function mapTurn(row: TurnRow): MemoryTurn {
  return {
    id: numberOr(row.id, 0),
    sessionId: row.session_id,
    role: row.role === 'model' ? 'model' : 'user',
    content: row.content,
    at: numberOr(row.at, 0),
    interrupted: parseBoolean(row.interrupted)
  }
}

/**
 * Converte texto livre em consulta FTS5. Tokens de atÃ© 8 termos, prefixo,
 * aspas escapadas; devolve '' quando nÃ£o hÃ¡ termo Ãºtil.
 */
export function buildFtsQuery(query: string): string {
  if (typeof query !== 'string') return ''
  const tokens = query
    .toLocaleLowerCase('pt-BR')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.slice(0, 8)
  if (!tokens || tokens.length === 0) return ''
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' OR ')
}

function inTransaction<T>(db: SqlDatabase, run: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // rollback best-effort
    }
    throw error
  }
}

export function rebuildMemoryIndex(db: SqlDatabase): void {
  db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
}

export function addMaintenance(db: SqlDatabase, at: number, op: string, detail: string): void {
  db.prepare('INSERT INTO memory_maintenance (at, op, detail) VALUES (?, ?, ?)').run(
    at,
    op.slice(0, 40),
    detail.slice(0, 400)
  )
}

/**
 * Move uma memória para o arquivo (nunca apaga): o conteúdo fica legível na
 * tela em modo somente leitura e o relatório de manutenção registra a razão.
 */
export function archiveMemory(
  db: SqlDatabase,
  memory: MemoryRecord,
  at: number,
  reason: string
): void {
  db.prepare(
    `INSERT OR REPLACE INTO memories_archive
      (id, kind, content, tags, confidence, source, created_at, updated_at, last_used_at, use_count, expires_at, pinned, archived_at, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    memory.id,
    memory.kind,
    memory.content,
    JSON.stringify(memory.tags),
    memory.confidence,
    memory.source,
    memory.createdAt,
    memory.updatedAt,
    memory.lastUsedAt,
    memory.useCount,
    memory.expiresAt,
    memory.pinned ? 1 : 0,
    at,
    reason.slice(0, 40)
  )
  db.prepare('DELETE FROM memories WHERE id = ?').run(memory.id)
}

export function getMeta(db: SqlDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM memory_meta WHERE key = ?').get(key)
  if (!row || typeof row !== 'object') return null
  const value = (row as MetaRow).value
  return typeof value === 'string' ? value : null
}

export function setMeta(db: SqlDatabase, key: string, value: string): void {
  db.prepare(
    'INSERT INTO memory_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function getNumberMeta(db: SqlDatabase, key: string): number | null {
  const raw = getMeta(db, key)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function createMemoryRepository(db: SqlDatabase): MemoryRepository {
  function getMemory(id: string): MemoryRecord | null {
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
    return row ? mapMemoryRow(row as MemoryRow) : null
  }

  function insert(input: NewMemoryInput): MemoryRecord {
    const now = numberOr(input.createdAt, Date.now())
    const kind = requireKind(input.kind)
    const content = requireContent(input.content)
    const tags = normalizeTags(input.tags)
    const confidence = clampConfidence(input.confidence, MEMORY_DEFAULT_CONFIDENCE)
    const source = normalizeSource(input.source)
    const expiresAt = normalizeExpiresAt(kind, input.expiresAt, now)
    const pinned = input.pinned === true
    const id = randomUUID()

    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO memories
          (id, kind, content, tags, confidence, source, created_at, updated_at, last_used_at, use_count, expires_at, pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        kind,
        content,
        JSON.stringify(tags),
        confidence,
        source,
        now,
        numberOr(input.updatedAt, now),
        typeof input.lastUsedAt === 'number' && Number.isFinite(input.lastUsedAt)
          ? Math.floor(input.lastUsedAt)
          : null,
        nonNegativeInt(input.useCount),
        expiresAt,
        pinned ? 1 : 0
      )
    })
    const created = getMemory(id)
    if (!created) throw new Error('memÃ³ria nÃ£o encontrada apÃ³s a inserÃ§Ã£o')
    return created
  }

  function update(id: string, patch: MemoryUpdatePatch): MemoryRecord | null {
    const memoryId = requireId(id)
    const current = getMemory(memoryId)
    if (!current) return null
    assertAllowedPatchKeys(patch as Record<string, unknown>)
    const now = Date.now()
    const kind = patch.kind === undefined ? current.kind : requireKind(patch.kind)
    const content = patch.content === undefined ? current.content : requireContent(patch.content)
    const tags = patch.tags === undefined ? current.tags : normalizeTags(patch.tags)
    const confidence =
      patch.confidence === undefined
        ? current.confidence
        : clampConfidence(patch.confidence, current.confidence)
    const pinned = patch.pinned === undefined ? current.pinned : patch.pinned === true
    const expiresAt =
      kind !== 'temporary'
        ? null
        : patch.expiresAt === undefined
          ? current.kind === 'temporary'
            ? current.expiresAt
            : now + MEMORY_TEMPORARY_TTL_MS
          : normalizeExpiresAt(kind, patch.expiresAt, now)

    inTransaction(db, () => {
      db.prepare(
        `UPDATE memories SET
          kind = ?, content = ?, tags = ?, confidence = ?, updated_at = ?,
          expires_at = ?, pinned = ?
         WHERE id = ?`
      ).run(
        kind,
        content,
        JSON.stringify(tags),
        confidence,
        now,
        expiresAt,
        pinned ? 1 : 0,
        memoryId
      )
    })
    return getMemory(memoryId)
  }

  function remove(id: string): boolean {
    const memoryId = requireId(id)
    return inTransaction(db, () => {
      const result = db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId)
      if (result.changes > 0) rebuildMemoryIndex(db)
      return result.changes > 0
    })
  }

  function list(query: MemoryListQuery = {}): MemoryListPage {
    const now = Date.now()
    const limit = positiveInt(query.limit, 100, MEMORY_ACTIVE_LIMIT)
    const offset = nonNegativeInt(query.offset)
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.kind !== undefined) {
      where.push('kind = ?')
      params.push(requireKind(query.kind))
    }
    where.push('(expires_at IS NULL OR expires_at > ?)')
    params.push(now)
    const text = typeof query.query === 'string' ? query.query.trim() : ''
    const match = buildFtsQuery(text)
    if (match) {
      where.push(
        'id IN (SELECT m2.id FROM memories_fts JOIN memories m2 ON m2.rowid = memories_fts.rowid WHERE memories_fts MATCH ?)'
      )
      params.push(match)
    }
    const whereSql = `WHERE ${where.join(' AND ')}`
    const sort = query.sort && SORT_SQL[query.sort] ? SORT_SQL[query.sort] : SORT_SQL.date
    const rows = db
      .prepare(`SELECT * FROM memories ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
    const countRow = db.prepare(`SELECT COUNT(*) AS total FROM memories ${whereSql}`).get(...params)
    const total = countRow ? nonNegativeInt((countRow as CountRow).total) : 0
    return { memories: rows.map((row) => mapMemoryRow(row as MemoryRow)), total }
  }

  function search(query: string, options: { limit?: number; now?: number } = {}): MemoryRecord[] {
    const match = buildFtsQuery(query)
    if (!match) return []
    const now = numberOr(options.now, Date.now())
    const limit = positiveInt(options.limit, 50, 200)
    const rows = db
      .prepare(
        `SELECT m.* FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ?
           AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY bm25(memories_fts)
         LIMIT ?`
      )
      .all(match, now, limit)
    return rows.map((row) => mapMemoryRow(row as MemoryRow))
  }

  function searchRanked(
    query: string,
    options: { limit?: number; now?: number } = {}
  ): RankedMemory[] {
    const match = buildFtsQuery(query)
    if (!match) return []
    const now = numberOr(options.now, Date.now())
    const limit = positiveInt(options.limit, 50, 200)
    const rows = db
      .prepare(
        `SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ?
           AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY rank
         LIMIT ?`
      )
      .all(match, now, limit)
    return rows.map((row) => {
      const ranked = row as RankedRow
      return { memory: mapMemoryRow(ranked), rank: numberOr(ranked.rank, 0) }
    })
  }

  function listPriority(options: { limit?: number; now?: number } = {}): MemoryRecord[] {
    const now = numberOr(options.now, Date.now())
    const limit = positiveInt(options.limit, 50, 200)
    const rows = db
      .prepare(
        `SELECT * FROM memories
         WHERE (pinned = 1 OR kind = 'profile')
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY pinned DESC, use_count DESC, updated_at DESC
         LIMIT ?`
      )
      .all(now, limit)
    return rows.map((row) => mapMemoryRow(row as MemoryRow))
  }

  function touch(ids: string[], at: number = Date.now()): number {
    const valid = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (valid.length === 0) return 0
    return inTransaction(db, () => {
      const statement = db.prepare(
        'UPDATE memories SET use_count = use_count + 1, last_used_at = ? WHERE id = ?'
      )
      let changes = 0
      for (const id of valid) changes += statement.run(at, id).changes
      return changes
    })
  }

  function removeAll(options: RemoveAllOptions = {}): RemoveAllResult {
    return inTransaction(db, () => {
      const memories = db.prepare('SELECT COUNT(*) AS total FROM memories').get()
      const turns = db.prepare('SELECT COUNT(*) AS total FROM turns').get()
      const sessions = db.prepare('SELECT COUNT(*) AS total FROM sessions').get()
      db.exec('DELETE FROM memories')
      db.exec('DELETE FROM memories_archive')
      rebuildMemoryIndex(db)
      let removedTurns = 0
      let removedSessions = 0
      if (options.includeTurns === true) {
        removedTurns = turns ? nonNegativeInt((turns as CountRow).total) : 0
        removedSessions = sessions ? nonNegativeInt((sessions as CountRow).total) : 0
        db.exec('DELETE FROM turns')
        db.exec('DELETE FROM sessions')
      }
      return {
        removed: memories ? nonNegativeInt((memories as CountRow).total) : 0,
        turns: removedTurns,
        sessions: removedSessions
      }
    })
  }

  function listArchived(limit = 50): MemoryArchiveRecord[] {
    const rows = db
      .prepare('SELECT * FROM memories_archive ORDER BY archived_at DESC LIMIT ?')
      .all(positiveInt(limit, 50, 200))
    return rows.map((row) => mapArchiveRow(row as ArchiveRow))
  }

  function maintenance(limit = 20): MemoryMaintenanceEntry[] {
    const rows = db
      .prepare('SELECT at, op, detail FROM memory_maintenance ORDER BY id DESC LIMIT ?')
      .all(positiveInt(limit, 20, 100))
    return rows.map((row) => {
      const entry = row as MemoryMaintenanceEntry
      return {
        at: numberOr(entry.at, 0),
        op: String(entry.op ?? ''),
        detail: String(entry.detail ?? '')
      }
    })
  }

  function startSession(sessionId: string, at: number): void {
    const id = requireId(sessionId)
    db.prepare(
      'INSERT INTO sessions (id, started_at, ended_at, summary) VALUES (?, ?, NULL, NULL) ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at'
    ).run(id, Math.floor(at))
  }

  function endSession(sessionId: string, at: number, summary: string | null = null): void {
    const id = requireId(sessionId)
    db.prepare('UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?').run(
      Math.floor(at),
      summary === null ? null : summary.slice(0, 2000),
      id
    )
  }

  function insertTurn(turn: TurnInput): number {
    const sessionId = requireId(turn.sessionId)
    if (turn.role !== 'user' && turn.role !== 'model') {
      throw new MemoryValidationError('Papel do turno invÃ¡lido.')
    }
    if (typeof turn.content !== 'string' || !turn.content.trim()) {
      throw new MemoryValidationError('Turno vazio.')
    }
    const content = turn.content.trim().slice(0, 8000)
    const result = db
      .prepare(
        'INSERT INTO turns (session_id, role, content, at, interrupted) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        sessionId,
        turn.role,
        content,
        Math.floor(numberOr(turn.at, Date.now())),
        turn.interrupted ? 1 : 0
      )
    return result.lastInsertRowid
  }

  function sessionTurns(sessionId: string, limit = 200): MemoryTurn[] {
    const id = requireId(sessionId)
    const rows = db
      .prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY id ASC LIMIT ?')
      .all(id, positiveInt(limit, 200, 1000))
    return rows.map((row) => mapTurn(row as TurnRow))
  }

  function countSession(sessionId: string): number {
    const id = requireId(sessionId)
    const row = db.prepare('SELECT COUNT(*) AS total FROM turns WHERE session_id = ?').get(id)
    return row ? nonNegativeInt((row as CountRow).total) : 0
  }

  function countAll(): number {
    const row = db.prepare('SELECT COUNT(*) AS total FROM turns').get()
    return row ? nonNegativeInt((row as CountRow).total) : 0
  }

  /** Últimos turnos de todas as sessões, em ordem cronológica. */
  function recentTurns(limit = 20): MemoryTurn[] {
    const rows = db
      .prepare('SELECT * FROM turns ORDER BY id DESC LIMIT ?')
      .all(positiveInt(limit, 20, 200))
    return rows.reverse().map((row) => mapTurn(row as TurnRow))
  }

  function listSessions(): MemorySession[] {
    const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all()
    return rows.map((row) => {
      const session = row as SessionRow
      return {
        id: session.id,
        startedAt: numberOr(session.started_at, 0),
        endedAt: session.ended_at === null ? null : numberOr(session.ended_at, 0),
        summary: typeof session.summary === 'string' ? session.summary : null
      }
    })
  }

  function clearTurns(): number {
    return inTransaction(db, () => {
      const row = db.prepare('SELECT COUNT(*) AS total FROM turns').get()
      db.exec('DELETE FROM turns')
      db.exec('DELETE FROM sessions')
      return row ? nonNegativeInt((row as CountRow).total) : 0
    })
  }

  return {
    handle: db,
    insert,
    get: getMemory,
    update,
    remove,
    list,
    search,
    searchRanked,
    listPriority,
    touch,
    removeAll,
    listArchived,
    maintenance,
    turns: {
      startSession,
      endSession,
      insert: insertTurn,
      list: sessionTurns,
      sessionTurns,
      recent: recentTurns,
      countSession,
      countAll,
      listSessions,
      clear: clearTurns
    }
  }
}

/** Limite fÃ­sico de memÃ³rias ativas (para diagnÃ³stico/tela). */
export const MEMORY_STORAGE_LIMIT = MEMORY_ACTIVE_LIMIT
