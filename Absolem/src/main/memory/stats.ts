import {
  MEMORY_KINDS,
  emptyMemoryStats,
  type MemoryKind,
  type MemoryMaintenanceEntry,
  type MemoryStats
} from '../../shared/memory'
import type { SqlDatabase } from './db'
import { getNumberMeta } from './repository'

/**
 * Estatísticas da memória (task 09/T10).
 *
 * Números reais do banco, sem "personalidade" gerada: o perfil mostrado na
 * tela é a lista de memórias `profile`/`preference`, não um texto inventado.
 */

export interface MemoryStatsOptions {
  lastConsolidationAt?: number | null
  maintenanceLimit?: number
}

interface KindCountRow {
  kind: string
  total: number
}

interface AggregateRow {
  total: number
  oldest: number | null
  newest: number | null
  pinned: number | null
  approxBytes: number | null
}

interface MaintenanceRow {
  at: number
  op: string
  detail: string
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function getMemoryStats(db: SqlDatabase, options: MemoryStatsOptions = {}): MemoryStats {
  const stats = emptyMemoryStats()

  const kinds = db.prepare('SELECT kind, COUNT(*) AS total FROM memories GROUP BY kind').all()
  for (const row of kinds) {
    const entry = row as KindCountRow
    if (MEMORY_KINDS.includes(entry.kind as MemoryKind)) {
      stats.byKind[entry.kind as MemoryKind] = finite(entry.total, 0)
    }
  }

  const aggregate = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         MIN(created_at) AS oldest,
         MAX(created_at) AS newest,
         SUM(pinned) AS pinned,
         SUM(LENGTH(content) + LENGTH(tags) + LENGTH(source) + 64) AS approxBytes
       FROM memories`
    )
    .get()
  const totals = aggregate ? (aggregate as AggregateRow) : null
  stats.total = totals ? finite(totals.total, 0) : 0
  stats.oldest = totals && typeof totals.oldest === 'number' ? totals.oldest : null
  stats.newest = totals && typeof totals.newest === 'number' ? totals.newest : null
  stats.pinned = totals ? finite(totals.pinned, 0) : 0
  stats.approxBytes = totals ? Math.max(0, finite(totals.approxBytes, 0)) : 0
  stats.lastExtractionAt = getNumberMeta(db, 'last_extraction_at')
  stats.lastConsolidationAt = options.lastConsolidationAt ?? null

  const limit = Math.max(1, Math.min(100, Math.floor(options.maintenanceLimit ?? 20)))
  const rows = db
    .prepare('SELECT at, op, detail FROM memory_maintenance ORDER BY id DESC LIMIT ?')
    .all(limit)
  stats.maintenance = rows.map((row): MemoryMaintenanceEntry => {
    const entry = row as MaintenanceRow
    return {
      at: finite(entry.at, 0),
      op: typeof entry.op === 'string' ? entry.op : '',
      detail: typeof entry.detail === 'string' ? entry.detail : ''
    }
  })

  return stats
}
