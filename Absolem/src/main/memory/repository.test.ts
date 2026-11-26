import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { openMemoryDatabase } from './db'
import {
  assertAllowedPatchKeys,
  createMemoryRepository,
  MemoryValidationError,
  type MemoryRepository
} from './repository'
import { nodeSqliteOpener } from './testing/nodeSqlite'
import { createTestMemoryDatabase, type TestMemoryDatabase } from './testing/tempDatabase'

const open: TestMemoryDatabase[] = []

function setup(): { repo: MemoryRepository; path: string; db: TestMemoryDatabase } {
  const db = createTestMemoryDatabase()
  open.push(db)
  return { repo: createMemoryRepository(db.database.handle), path: db.database.path, db }
}

afterEach(() => {
  for (const db of open.splice(0)) db.cleanup()
})

describe('repositório de memória', () => {
  it('insere e busca', () => {
    const { repo } = setup()
    const created = repo.insert({
      kind: 'fact',
      content: 'Trabalho na Kolnd desde 2024',
      tags: ['trabalho', 'Kolnd'],
      source: 'manual'
    })

    expect(created.kind).toBe('fact')
    expect(created.tags).toEqual(['trabalho', 'Kolnd'])
    expect(created.confidence).toBe(0.8)
    expect(repo.get(created.id)?.content).toBe('Trabalho na Kolnd desde 2024')
    expect(repo.search('Kolnd').map((memory) => memory.id)).toEqual([created.id])
    expect(repo.list().total).toBe(1)
  })

  it('update preserva created_at', () => {
    const { repo } = setup()
    const created = repo.insert({
      kind: 'preference',
      content: 'Prefere café',
      tags: ['bebida'],
      createdAt: 1000
    })

    const updated = repo.update(created.id, {
      content: 'Prefere café sem açúcar',
      tags: ['bebida', 'café'],
      pinned: true
    })

    expect(updated).not.toBeNull()
    expect(updated?.createdAt).toBe(1000)
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(1000)
    expect(updated?.content).toBe('Prefere café sem açúcar')
    expect(updated?.tags).toEqual(['bebida', 'café'])
    expect(updated?.pinned).toBe(true)
    expect(repo.search('açúcar').map((memory) => memory.id)).toEqual([created.id])
  })

  it('remove atualiza FTS', () => {
    const { repo } = setup()
    const created = repo.insert({ kind: 'fact', content: 'Mora em São Paulo' })
    expect(repo.search('Paulo')).toHaveLength(1)

    expect(repo.remove(created.id)).toBe(true)
    expect(repo.search('Paulo')).toHaveLength(0)
    expect(repo.get(created.id)).toBeNull()
    expect(repo.remove(created.id)).toBe(false)
  })

  it('kind inválido é recusado', () => {
    const { repo } = setup()
    expect(() => repo.insert({ kind: 'segredo', content: 'algo' })).toThrow(MemoryValidationError)
    const created = repo.insert({ kind: 'fact', content: 'algo válido' })
    expect(() => repo.update(created.id, { kind: 'segredo' })).toThrow(MemoryValidationError)
    expect(() => repo.insert({ kind: 'fact', content: '   ' })).toThrow(MemoryValidationError)
    expect(() => assertAllowedPatchKeys({ createdAt: 1 })).toThrow(MemoryValidationError)
  })

  it('migração 1 -> 2 preserva linhas', () => {
    const first = createTestMemoryDatabase({ targetVersion: 1 })
    const path = join(first.dir, 'memory.sqlite')
    first.database.handle
      .prepare(
        'INSERT INTO memories (id, kind, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('v1', 'fact', 'linha criada na versão 1', '["migração"]', 10, 10)
    first.database.close()

    const reopened = openMemoryDatabase({ path, opener: nodeSqliteOpener })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    const repo = createMemoryRepository(reopened.database.handle)

    expect(reopened.database.version).toBe(2)
    expect(repo.list().total).toBe(1)
    expect(repo.list().memories[0]?.content).toBe('linha criada na versão 1')
    expect(repo.search('migração').map((memory) => memory.id)).toEqual(['v1'])
    reopened.database.close()
    first.cleanup()
  })
})
