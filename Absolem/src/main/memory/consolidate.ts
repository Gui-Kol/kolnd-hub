import {
  MEMORY_ACTIVE_LIMIT,
  MEMORY_ARCHIVE_CONFIDENCE,
  MEMORY_DECAY_AFTER_DAYS,
  type MemoryRecord
} from '../../shared/memory'
import type { SqlDatabase } from './db'
import {
  addMaintenance,
  archiveMemory,
  mapMemoryRow,
  rebuildMemoryIndex,
  type MemoryRepository,
  type MemoryRow
} from './repository'
import { isDuplicateContent } from './similarity'

/**
 * Consolidação local (sem modelo, sem custo de token).
 *
 * Roda uma vez por dia e na abertura quando atrasada:
 * 1. remove `temporary` expiradas;
 * 2. mescla duplicatas (trigramas > 0.85), preservando tags/uso;
 * 3. reduz a confiança do que não é usado há 90 dias;
 * 4. arquiva (nunca apaga) o que caiu abaixo de 0.2;
 * 5. mantém no máximo 5.000 memórias ativas, arquivando o excedente.
 *
 * Toda remoção/arquivamento entra no relatório de manutenção visível na tela.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DECAY_AMOUNT = 0.1

export interface ConsolidationOptions {
  now?: number
  limit?: number
  decayAfterDays?: number
  decayAmount?: number
  archiveBelow?: number
  /** Persiste `memory.lastConsolidationAt` no store (fora da transação). */
  persistLastConsolidationAt?: (at: number) => void
}

export interface ConsolidationReport {
  at: number
  expiredRemoved: number
  merged: number
  decayed: number
  archived: number
  trimmed: number
  lines: string[]
}

interface CountRow {
  total: number
}

function count(db: SqlDatabase, sql: string, ...params: Array<string | number>): number {
  const row = db.prepare(sql).get(...params)
  if (!row || typeof row !== 'object') return 0
  const total = (row as CountRow).total
  return typeof total === 'number' && Number.isFinite(total) ? total : 0
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function mergeTags(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const tag of [...a, ...b]) {
    const key = tag.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(tag)
    if (merged.length >= 8) break
  }
  return merged
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

function pickKeeper(a: MemoryRecord, b: MemoryRecord): MemoryRecord {
  if (a.pinned !== b.pinned) return a.pinned ? a : b
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b
  if (a.useCount !== b.useCount) return a.useCount > b.useCount ? a : b
  return a.createdAt <= b.createdAt ? a : b
}

function mergeRecords(keeper: MemoryRecord, other: MemoryRecord): MemoryRecord {
  return {
    ...keeper,
    tags: mergeTags(keeper.tags, other.tags),
    confidence: Math.max(keeper.confidence, other.confidence),
    createdAt: Math.min(keeper.createdAt, other.createdAt),
    updatedAt: Math.max(keeper.updatedAt, other.updatedAt),
    lastUsedAt: maxNullable(keeper.lastUsedAt, other.lastUsedAt),
    useCount: keeper.useCount + other.useCount,
    pinned: keeper.pinned || other.pinned,
    expiresAt: keeper.kind === 'temporary' ? maxNullable(keeper.expiresAt, other.expiresAt) : null
  }
}

function writeMerged(db: SqlDatabase, memory: MemoryRecord): void {
  db.prepare(
    `UPDATE memories SET
      tags = ?, confidence = ?, created_at = ?, updated_at = ?,
      last_used_at = ?, use_count = ?, expires_at = ?, pinned = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(memory.tags),
    memory.confidence,
    memory.createdAt,
    memory.updatedAt,
    memory.lastUsedAt,
    memory.useCount,
    memory.expiresAt,
    memory.pinned ? 1 : 0,
    memory.id
  )
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

export function consolidate(
  repo: MemoryRepository,
  options: ConsolidationOptions = {}
): ConsolidationReport {
  const db = repo.handle
  const now =
    typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const limit = Math.max(1, Math.floor(options.limit ?? MEMORY_ACTIVE_LIMIT))
  const decayAfterDays = Math.max(1, Math.floor(options.decayAfterDays ?? MEMORY_DECAY_AFTER_DAYS))
  const decayAmount = Math.max(0, options.decayAmount ?? DECAY_AMOUNT)
  const archiveBelow = Math.max(0, options.archiveBelow ?? MEMORY_ARCHIVE_CONFIDENCE)

  const report: ConsolidationReport = {
    at: now,
    expiredRemoved: 0,
    merged: 0,
    decayed: 0,
    archived: 0,
    trimmed: 0,
    lines: []
  }

  inTransaction(db, () => {
    // 1. temporárias expiradas
    const expired = db
      .prepare(
        `DELETE FROM memories
         WHERE kind = 'temporary' AND expires_at IS NOT NULL AND expires_at <= ?`
      )
      .run(now)
    report.expiredRemoved = expired.changes

    // 2. duplicatas restantes
    const active = repo.list({ limit: MEMORY_ACTIVE_LIMIT }).memories
    const removed = new Set<string>()
    for (let index = 0; index < active.length; index += 1) {
      let keeper = active[index]
      if (!keeper || removed.has(keeper.id)) continue
      for (let next = index + 1; next < active.length; next += 1) {
        const other = active[next]
        if (!other || removed.has(other.id)) continue
        if (other.kind !== keeper.kind) continue
        if (!isDuplicateContent(keeper.content, other.content)) continue
        const chosen = pickKeeper(keeper, other)
        const discarded = chosen.id === keeper.id ? other : keeper
        const merged = mergeRecords(chosen, discarded)
        writeMerged(db, merged)
        db.prepare('DELETE FROM memories WHERE id = ?').run(discarded.id)
        removed.add(discarded.id)
        keeper = merged
        active[index] = merged
        report.merged += 1
      }
    }
    if (report.merged > 0) rebuildMemoryIndex(db)

    // 3. decaimento por desuso
    const cutoff = now - decayAfterDays * DAY_MS
    const afterMerge = repo.list({ limit: MEMORY_ACTIVE_LIMIT }).memories
    const decayStatement = db.prepare('UPDATE memories SET confidence = ? WHERE id = ?')
    for (const memory of afterMerge) {
      if (memory.pinned) continue
      const lastUsed = memory.lastUsedAt ?? memory.updatedAt
      if (lastUsed >= cutoff) continue
      const next = roundConfidence(memory.confidence - decayAmount)
      if (next === memory.confidence) continue
      decayStatement.run(next, memory.id)
      report.decayed += 1
    }

    // 4. arquivo por confiança baixa
    const afterDecay = repo.list({ limit: MEMORY_ACTIVE_LIMIT }).memories
    for (const memory of afterDecay) {
      if (memory.pinned || memory.confidence >= archiveBelow) continue
      archiveMemory(db, memory, now, 'confidence')
      report.archived += 1
    }
    if (report.archived > 0) rebuildMemoryIndex(db)

    // 5. limite de memórias ativas
    const total = count(db, 'SELECT COUNT(*) AS total FROM memories')
    const excess = total - limit
    if (excess > 0) {
      const rows = db
        .prepare(
          `SELECT * FROM memories
           ORDER BY pinned ASC, confidence ASC, COALESCE(last_used_at, updated_at) ASC, created_at ASC
           LIMIT ?`
        )
        .all(excess)
      for (const row of rows) {
        archiveMemory(db, mapMemoryRow(row as MemoryRow), now, 'limit')
        report.trimmed += 1
      }
      if (report.trimmed > 0) rebuildMemoryIndex(db)
    }

    // 6. relatório visível na tela
    if (report.expiredRemoved > 0) {
      const line = `${report.expiredRemoved} memória(s) temporária(s) expirada(s) removida(s)`
      report.lines.push(line)
      addMaintenance(db, now, 'expire', line)
    }
    if (report.merged > 0) {
      const line = `${report.merged} duplicata(s) mesclada(s)`
      report.lines.push(line)
      addMaintenance(db, now, 'merge', line)
    }
    if (report.decayed > 0) {
      const line = `${report.decayed} memória(s) com confiança reduzida por desuso`
      report.lines.push(line)
      addMaintenance(db, now, 'decay', line)
    }
    if (report.archived > 0) {
      const line = `${report.archived} memória(s) movida(s) ao arquivo por confiança baixa`
      report.lines.push(line)
      addMaintenance(db, now, 'archive', line)
    }
    if (report.trimmed > 0) {
      const line = `${report.trimmed} memória(s) movida(s) ao arquivo para manter o limite de ${limit}`
      report.lines.push(line)
      addMaintenance(db, now, 'trim', line)
    }
    addMaintenance(
      db,
      now,
      'consolidate',
      report.lines.length > 0 ? report.lines.join('; ') : 'nada a fazer'
    )
  })

  try {
    options.persistLastConsolidationAt?.(now)
  } catch {
    // persistir a data no store é best-effort; a consolidação já terminou
  }

  return report
}

/** `true` quando a última consolidação tem mais de 24 h (ou nunca rodou). */
export function needsConsolidation(lastAt: number | null, now: number = Date.now()): boolean {
  if (lastAt === null || !Number.isFinite(lastAt)) return true
  return now - lastAt >= DAY_MS
}
