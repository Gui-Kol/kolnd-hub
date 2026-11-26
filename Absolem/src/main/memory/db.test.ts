import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openMemoryDatabase, MEMORY_SCHEMA_VERSION, readSchemaVersion } from './db'
import { nodeSqliteOpener } from './testing/nodeSqlite'

const dirs: string[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'absolem-memoria-'))
  dirs.push(dir)
  return join(dir, 'memory.sqlite')
}

function pragma(handle: Parameters<typeof readSchemaVersion>[0], name: string): unknown {
  const row = handle.prepare(`PRAGMA ${name}`).get()
  if (!row || typeof row !== 'object') return undefined
  const record = row as Record<string, unknown>
  // `node:sqlite` expõe busy_timeout como `timeout`; better-sqlite3 usa
  // `busy_timeout`. Ambos são o mesmo PRAGMA.
  return record[name] ?? (name === 'busy_timeout' ? record.timeout : undefined)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // arquivo ainda aberto no Windows: o próximo teste usa outro diretório
    }
  }
})

describe('banco de memória', () => {
  it('cria banco e versão 1', () => {
    const path = tempDbPath()
    const result = openMemoryDatabase({ path, opener: nodeSqliteOpener, targetVersion: 1 })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(readSchemaVersion(result.database.handle)).toBe(1)
    const table = result.database.handle
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'")
      .get()
    expect(table).toEqual({ name: 'memories' })
    result.database.close()
  })

  it('reabrir preserva dados', () => {
    const path = tempDbPath()
    const first = openMemoryDatabase({ path, opener: nodeSqliteOpener })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.database.version).toBe(MEMORY_SCHEMA_VERSION)
    first.database.handle
      .prepare(
        'INSERT INTO memories (id, kind, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('m1', 'fact', 'gosta de café sem açúcar', '["café"]', 1000, 1000)
    first.database.close()

    const second = openMemoryDatabase({ path, opener: nodeSqliteOpener })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const row = second.database.handle
      .prepare('SELECT content FROM memories WHERE id = ?')
      .get('m1')
    expect(row).toEqual({ content: 'gosta de café sem açúcar' })
    second.database.close()
  })

  it('WAL ativo, foreign_keys e busy_timeout aplicados', () => {
    const path = tempDbPath()
    const result = openMemoryDatabase({ path, opener: nodeSqliteOpener })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(pragma(result.database.handle, 'journal_mode')).toBe('wal')
    expect(pragma(result.database.handle, 'foreign_keys')).toBe(1)
    expect(pragma(result.database.handle, 'busy_timeout')).toBe(3000)
    result.database.close()
  })

  it('erro de abertura degrada para memória desabilitada sem derrubar o app', () => {
    const logger = { warn: vi.fn() }
    const result = openMemoryDatabase({
      path: 'X:\\inexistente\\memory.sqlite',
      opener: () => {
        throw new Error('não foi possível abrir o arquivo')
      },
      logger
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('não foi possível abrir')
    expect(logger.warn).toHaveBeenCalledWith(
      'memory',
      expect.stringContaining('memória desabilitada'),
      expect.stringContaining('não foi possível abrir')
    )
  })
})
