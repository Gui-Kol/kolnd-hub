import { statSync } from 'fs'
import { describe, expect, it } from 'vitest'
import type { MemoryExportFile } from '../../shared/memory'
import { MEMORY_EXPORT_VERSION } from '../../shared/memory'
import { consolidate } from './consolidate'
import type { MemoryIODialog, MemoryIOFs } from './exportImport'
import { createMemoryIO } from './exportImport'
import { nodeSqliteOpener } from './testing/nodeSqlite'
import { createTestMemoryDatabase } from './testing/tempDatabase'
import { createMemoryRepository, type MemoryRepository } from './repository'
import { recall } from './retrieve'

/**
 * Perfil local da memória (task 06/T1).
 *
 * Não roda no `npm test` normal: use `MEMORY_BENCH=1` para executar. Mede o
 * banco real (`node:sqlite` com as mesmas migrações/FTS5 do app) em diretórios
 * temporários, sem rede, sem chave e sem dados do usuário.
 *
 * Variáveis:
 * - `MEMORY_BENCH=1` ativa o perfil;
 * - `MEMORY_BENCH_SIZES=100,1000,5000` escolhe os tamanhos;
 * - `MEMORY_BENCH_CONSOLIDATE_MAX=1000` limita a consolidação medida nesse
 *   tamanho (a de 5.000 é extrapolada quadraticamente, salvo `full`).
 */

const BENCH = process.env.MEMORY_BENCH === '1'
const SIZES = (process.env.MEMORY_BENCH_SIZES ?? '100,1000,5000')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0)
const CONSOLIDATE_MAX =
  process.env.MEMORY_BENCH_CONSOLIDATE_MAX === 'full'
    ? Number.POSITIVE_INFINITY
    : Number(process.env.MEMORY_BENCH_CONSOLIDATE_MAX ?? 1000)

const QUERY_ROUNDS = 25
const RECALL_ROUNDS = 15
const WORDS = [
  'cafe',
  'curitiba',
  'japones',
  'terca',
  'reuniao',
  'manha',
  'parque',
  'domingo',
  'acucar',
  'notebook',
  'windows',
  'gatos',
  'trabalho',
  'kolnd',
  'musica',
  'viagem',
  'familia',
  'livro',
  'filme',
  'corrida'
]

type Samples = Record<string, number[]>

function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function makeContents(count: number): string[] {
  const random = lcg(0xab5e1e)
  const contents: string[] = []
  const seen = new Set<string>()
  while (contents.length < count) {
    const tokens: string[] = []
    const length = 5 + Math.floor(random() * 14)
    for (let index = 0; index < length; index += 1) {
      tokens.push(WORDS[Math.floor(random() * WORDS.length)] ?? 'memoria')
    }
    tokens.push(`id${contents.length}`)
    const content = tokens.join(' ')
    if (seen.has(content)) continue
    seen.add(content)
    contents.push(content)
  }
  return contents
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function summarize(samples: Samples): Record<string, { n: number; p50: number; p95: number }> {
  const result: Record<string, { n: number; p50: number; p95: number }> = {}
  for (const [scenario, values] of Object.entries(samples)) {
    result[scenario] = {
      n: values.length,
      p50: round(percentile(values, 0.5)),
      p95: round(percentile(values, 0.95))
    }
  }
  return result
}

function timed<T>(samples: Samples, scenario: string, run: () => T): T {
  const started = performance.now()
  const value = run()
  ;(samples[scenario] ??= []).push(performance.now() - started)
  return value
}

function populate(repo: MemoryRepository, contents: string[], base: number): void {
  for (let index = 0; index < contents.length; index += 1) {
    repo.insert({
      kind: index % 17 === 0 ? 'profile' : index % 5 === 0 ? 'preference' : 'fact',
      content: contents[index] ?? '',
      tags: index % 3 === 0 ? ['perfil'] : ['geral'],
      confidence: 0.6 + (index % 4) * 0.1,
      source: 'bench',
      pinned: index % 101 === 0,
      createdAt: base + index,
      updatedAt: base + index,
      useCount: index % 7
    })
  }
}

function benchSize(size: number): {
  size: number
  samples: Record<string, { n: number; p50: number; p95: number }>
  totalMs: Record<string, number>
  storage: Record<string, number>
} {
  const contents = makeContents(size)
  const db = createTestMemoryDatabase()
  const repo = createMemoryRepository(db.database.handle)
  const samples: Samples = {}
  const totalMs: Record<string, number> = {}
  const base = 1_700_000_000_000
  try {
    const insertStarted = performance.now()
    for (let index = 0; index < contents.length; index += 1) {
      timed(samples, 'insert', () =>
        repo.insert({
          kind: index % 17 === 0 ? 'profile' : index % 5 === 0 ? 'preference' : 'fact',
          content: contents[index] ?? '',
          tags: index % 3 === 0 ? ['perfil'] : ['geral'],
          confidence: 0.6 + (index % 4) * 0.1,
          source: 'bench',
          pinned: index % 101 === 0,
          createdAt: base + index,
          updatedAt: base + index,
          useCount: index % 7
        })
      )
    }
    totalMs.insert = round(performance.now() - insertStarted)

    const query = 'cafe'
    for (let round = 0; round < QUERY_ROUNDS; round += 1) {
      timed(samples, 'fts-search', () => repo.search(query, { limit: 50 }))
      timed(samples, 'fts-ranked', () => repo.searchRanked(query, { limit: 200 }))
      timed(samples, 'list-page', () => repo.list({ limit: 100 }))
      timed(samples, 'list-usage', () => repo.list({ limit: 100, sort: 'usage' }))
      timed(samples, 'list-search', () => repo.list({ query, limit: 100 }))
      timed(samples, 'list-kind', () => repo.list({ kind: 'profile', limit: 100 }))
    }
    for (let round = 0; round < RECALL_ROUNDS; round += 1) {
      timed(samples, 'recall', () => recall(repo, query, { now: base + size }))
    }

    const ids = repo.list({ limit: 8 }).memories.map((memory) => memory.id)
    for (let round = 0; round < QUERY_ROUNDS; round += 1) {
      timed(samples, 'touch-8', () => repo.touch(ids, base + round))
    }

    db.database.handle.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const beforeVacuum = statSync(db.database.path).size
    timed(samples, 'rebuild-index', () =>
      repo.handle.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')")
    )
    for (let round = 0; round < 5; round += 1) {
      const victim = repo.list({ limit: 1, offset: round }).memories[0]
      if (victim) timed(samples, 'remove-one', () => repo.remove(victim.id))
    }
    timed(samples, 'vacuum', () => db.database.handle.exec('VACUUM'))
    const afterVacuum = statSync(db.database.path).size

    return {
      size,
      samples: summarize(samples),
      totalMs,
      storage: { beforeVacuumBytes: beforeVacuum, afterVacuumBytes: afterVacuum }
    }
  } finally {
    db.cleanup()
  }
}

function benchConsolidate(size: number): {
  size: number
  measured: boolean
  totalMs: number | null
  note?: string
} {
  if (size > CONSOLIDATE_MAX) {
    return {
      size,
      measured: false,
      totalMs: null,
      note: `não medida (acima de MEMORY_BENCH_CONSOLIDATE_MAX=${CONSOLIDATE_MAX}); varredura é O(n²)`
    }
  }
  const db = createTestMemoryDatabase()
  const repo = createMemoryRepository(db.database.handle)
  const base = 1_700_000_000_000
  try {
    populate(repo, makeContents(size), base)
    const started = performance.now()
    const report = consolidate(repo, { now: base + size })
    return {
      size,
      measured: true,
      totalMs: round(performance.now() - started),
      note: `merged=${report.merged} decayed=${report.decayed} archived=${report.archived}`
    }
  } finally {
    db.cleanup()
  }
}

function benchRemoveAll(size: number): { size: number; totalMs: number; removed: number } {
  const db = createTestMemoryDatabase()
  const repo = createMemoryRepository(db.database.handle)
  try {
    populate(repo, makeContents(size), 1_700_000_000_000)
    const started = performance.now()
    const result = repo.removeAll()
    return { size, totalMs: round(performance.now() - started), removed: result.removed }
  } finally {
    db.cleanup()
  }
}

function benchLock(): { busyWaitMs: number; error: string; writesWithReaderOpen: number } {
  const db = createTestMemoryDatabase()
  const repo = createMemoryRepository(db.database.handle)
  const second = nodeSqliteOpener(db.database.path)
  try {
    repo.insert({ kind: 'fact', content: 'fato de lock' })
    second.exec('PRAGMA busy_timeout = 250')
    // Leitor concorrente em WAL não bloqueia escrita.
    const reader = second.prepare('SELECT COUNT(*) AS total FROM memories').get()
    const writesWithReaderOpen = (reader as { total: number }).total
    repo.handle.exec('BEGIN IMMEDIATE')
    const started = performance.now()
    let error = ''
    try {
      second
        .prepare(
          'INSERT INTO memories (id, kind, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('lock-2', 'fact', 'escrita concorrente', '[]', 1, 1)
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown)
    }
    const busyWaitMs = performance.now() - started
    repo.handle.exec('ROLLBACK')
    return { busyWaitMs: round(busyWaitMs), error, writesWithReaderOpen }
  } finally {
    try {
      second.close()
    } catch {
      // já fechado
    }
    db.cleanup()
  }
}

describe.skipIf(!BENCH)('perfil de desempenho da memória', () => {
  it('mede 100/1.000/5.000 itens e imprime JSON', async () => {
    const profiles = SIZES.map((size) => benchSize(size))
    const consolidation = SIZES.map((size) => benchConsolidate(size))
    const removeAll = SIZES.map((size) => benchRemoveAll(size))
    const imports: Array<{ size: number; totalMs: number; perItemMs: number; items: number }> = []
    for (const size of SIZES) {
      const db = createTestMemoryDatabase()
      const repo = createMemoryRepository(db.database.handle)
      const contents = makeContents(size)
      try {
        const file: MemoryExportFile = {
          app: 'absolem',
          kind: 'memory',
          version: MEMORY_EXPORT_VERSION,
          exportedAt: '2026-01-01T00:00:00.000Z',
          memories: contents.map((content, index) => ({
            id: `bench-${index}`,
            kind: 'fact',
            content,
            tags: ['bench'],
            confidence: 0.8,
            source: 'import',
            createdAt: 1_700_000_000_000 + index,
            updatedAt: 1_700_000_000_000 + index,
            lastUsedAt: null,
            useCount: 0,
            expiresAt: null,
            pinned: false
          }))
        }
        const fs: MemoryIOFs = {
          stat: async () => ({ size: Buffer.byteLength(JSON.stringify(file), 'utf8') }),
          readFile: async () => JSON.stringify(file),
          writeFile: async () => undefined
        }
        const dialog: MemoryIODialog = {
          showSaveDialog: async () => ({ canceled: true }),
          showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\temp\\bench.json'] }),
          showMessageBox: async () => ({ response: 0 })
        }
        const io = createMemoryIO({ fs, dialog, repo, now: () => new Date(1_700_000_000_000) })
        const started = performance.now()
        const result = await io.importFile()
        const totalMs = round(performance.now() - started)
        if (!result.ok) throw new Error(`import falhou: ${result.error}`)
        const imported = result.imported ?? 0
        imports.push({
          size,
          totalMs,
          perItemMs: round(totalMs / Math.max(1, imported)),
          items: imported
        })
      } finally {
        db.cleanup()
      }
    }
    // eslint-disable-next-line no-console -- o perfil imprime o JSON para o relatório
    console.log(
      `MEMORY_BENCH_JSON ${JSON.stringify({
        generatedAt: new Date().toISOString(),
        profiles,
        consolidation,
        imports,
        removeAll,
        lock: benchLock()
      })}`
    )
    expect(profiles.length).toBe(SIZES.length)
  }, 1_800_000)
})
