import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEMORY_EXPORT_VERSION, type MemoryExportFile } from '../../shared/memory'
import { consolidate, ConsolidationCancelled } from './consolidate'
import { openMemoryDatabase } from './db'
import type { MemoryIODialog, MemoryIOFs } from './exportImport'
import { createMemoryIO } from './exportImport'
import { createMemoryRepository, MemoryValidationError } from './repository'
import { isDuplicateContent, isDuplicateProfile, buildCompareProfile } from './similarity'
import { nodeSqliteOpener } from './testing/nodeSqlite'
import { createTestMemoryDatabase, type TestMemoryDatabase } from './testing/tempDatabase'

/**
 * Persistência sob falha (task 06/T3): busy/lock, arquivo inválido,
 * interrupção de manutenção, importação atômica, `removeAll`, paginação e
 * ausência de conteúdo em logs/diagnóstico.
 */

const open: TestMemoryDatabase[] = []
const dirs: string[] = []

afterEach(() => {
  for (const db of open.splice(0)) db.cleanup()
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // arquivo ainda aberto no Windows: o próximo teste usa outro diretório
    }
  }
})

function setup(): { repo: ReturnType<typeof createMemoryRepository>; db: TestMemoryDatabase } {
  const db = createTestMemoryDatabase()
  open.push(db)
  return { repo: createMemoryRepository(db.database.handle), db }
}

function exportFile(
  memories: Array<{ id?: string; content: string }>,
  sessions?: MemoryExportFile['sessions']
): MemoryExportFile {
  return {
    app: 'absolem',
    kind: 'memory',
    version: MEMORY_EXPORT_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    memories: memories.map((memory, index) => ({
      id: memory.id ?? `imp-${index}`,
      kind: 'fact',
      content: memory.content,
      tags: ['import'],
      confidence: 0.8,
      source: 'import',
      createdAt: 1000 + index,
      updatedAt: 1000 + index,
      lastUsedAt: null,
      useCount: 0,
      expiresAt: null,
      pinned: false
    })),
    ...(sessions ? { sessions } : {})
  }
}

function memoryIO(repo: ReturnType<typeof createMemoryRepository>, file: MemoryExportFile) {
  const text = JSON.stringify(file)
  const fs: MemoryIOFs = {
    stat: async () => ({ size: Buffer.byteLength(text, 'utf8') }),
    readFile: async () => text,
    writeFile: async () => undefined
  }
  const dialog: MemoryIODialog = {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\temp\\import.json'] }),
    showMessageBox: async () => ({ response: 0 })
  }
  return createMemoryIO({ fs, dialog, repo, now: () => new Date(2000) })
}

describe('persistência sob falha', () => {
  it('segundo escritor respeita busy_timeout e leitor WAL continua lendo', () => {
    const { repo, db } = setup()
    const second = nodeSqliteOpener(db.database.path)
    try {
      repo.insert({ kind: 'fact', content: 'fato anterior' })
      second.exec('PRAGMA busy_timeout = 100')
      repo.handle.exec('BEGIN IMMEDIATE')
      repo.handle
        .prepare(
          'INSERT INTO memories (id, kind, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('pendente', 'fact', 'linha não confirmada', '[]', 1, 1)

      // Leitor concorrente vê o último estado confirmado, não a transação aberta.
      const reader = second.prepare('SELECT COUNT(*) AS total FROM memories').get() as {
        total: number
      }
      expect(reader.total).toBe(1)

      expect(() =>
        second
          .prepare(
            'INSERT INTO memories (id, kind, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run('concorrente', 'fact', 'escrita concorrente', '[]', 2, 2)
      ).toThrow(/locked|busy/i)
    } finally {
      try {
        repo.handle.exec('ROLLBACK')
      } catch {
        // transação já encerrada
      }
      second.close()
    }

    // Após liberar o lock, a escrita concorrente funciona.
    const again = nodeSqliteOpener(db.database.path)
    try {
      again.exec('PRAGMA busy_timeout = 500')
      again
        .prepare(
          'INSERT INTO memories (id, kind, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('depois', 'fact', 'escrita depois do lock', '[]', 3, 3)
      expect(repo.get('depois')?.content).toBe('escrita depois do lock')
    } finally {
      again.close()
    }
  })

  it('arquivo inválido degrada sem derrubar e sem ecoar conteúdo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'absolem-invalido-'))
    dirs.push(dir)
    const path = join(dir, 'memory.sqlite')
    const sentinel = 'CONTEUDO-QUE-NAO-PODE-VAZAR'
    writeFileSync(path, Buffer.from(sentinel.repeat(64), 'utf8'))
    const logger = { warn: vi.fn() }

    const result = openMemoryDatabase({ path, opener: nodeSqliteOpener, logger })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain(sentinel)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(sentinel)
    expect(logger.warn).toHaveBeenCalled()
  })

  it('interrupção no meio da manutenção desfaz a transação ao reabrir', () => {
    const first = createTestMemoryDatabase()
    const path = first.database.path
    try {
      createMemoryRepository(first.database.handle).insert({
        kind: 'fact',
        content: 'Fato que precisa sobreviver ao reinício'
      })
    } finally {
      first.database.close()
    }

    // Simula uma manutenção que apaga tudo e é interrompida antes do COMMIT.
    const second = openMemoryDatabase({ path, opener: nodeSqliteOpener })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    second.database.handle.exec('BEGIN IMMEDIATE')
    second.database.handle.exec('DELETE FROM memories')
    second.database.handle
      .prepare(
        'INSERT INTO memories (id, kind, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run('lixo', 'fact', 'resto de manutenção interrompida', '[]', 9, 9)
    second.database.close() // sem COMMIT: SQLite desfaz a transação

    const third = openMemoryDatabase({ path, opener: nodeSqliteOpener })
    expect(third.ok).toBe(true)
    if (!third.ok) return
    const repo = createMemoryRepository(third.database.handle)
    expect(repo.list().total).toBe(1)
    expect(repo.search('sobreviver')).toHaveLength(1)
    expect(repo.get('lixo')).toBeNull()
    third.database.close()
    first.cleanup()
  })

  it('insertMany e transação aninhada desfazem tudo na falha', () => {
    const { repo } = setup()
    expect(() =>
      repo.insertMany([
        { kind: 'fact', content: 'primeira válida' },
        { kind: 'fact', content: '   ' }
      ])
    ).toThrow(MemoryValidationError)
    expect(repo.list().total).toBe(0)

    expect(() =>
      repo.transaction(() => {
        repo.insert({ kind: 'fact', content: 'dentro da transação' })
        repo.insert({ kind: 'segredo', content: 'tipo inválido' })
      })
    ).toThrow(MemoryValidationError)
    expect(repo.list().total).toBe(0)
    expect(repo.search('transação')).toHaveLength(0)
  })

  it('importação é atômica: falha no meio não grava memória nem sessão', async () => {
    const { repo } = setup()
    const sentinel = 'IMP-ATOMICO-SENTINELA'
    // Um gatilho de falha real no meio da inserção (equivalente a disco cheio).
    repo.handle.exec(`
      CREATE TRIGGER falha_import BEFORE INSERT ON memories
      WHEN new.content = '${sentinel}'
      BEGIN SELECT RAISE(ABORT, 'falha proposital de importacao'); END;
    `)
    const file = exportFile(
      [
        { content: 'memória importada antes da falha' },
        { content: sentinel },
        { content: 'memória importada depois da falha' }
      ],
      [
        {
          id: 'sessao-import',
          startedAt: 1000,
          endedAt: 2000,
          summary: null,
          turns: [{ role: 'user', content: 'turno importado', at: 1500, interrupted: false }]
        }
      ]
    )

    const result = await memoryIO(repo, file).importFile()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain(sentinel)
    expect(repo.list().total).toBe(0)
    expect(repo.turns.countAll()).toBe(0)
    expect(repo.turns.listSessions()).toHaveLength(0)
    expect(repo.search('importada')).toHaveLength(0)
  })

  it('removeAll sem includeTurns preserva turnos e limpa o arquivo', () => {
    const { repo } = setup()
    repo.insert({ kind: 'fact', content: 'ativa' })
    const archived = repo.insert({ kind: 'fact', content: 'arquivada' })
    repo.handle
      .prepare(
        `INSERT INTO memories_archive
          (id, kind, content, tags, confidence, source, created_at, updated_at, last_used_at, use_count, expires_at, pinned, archived_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        archived.id,
        'fact',
        archived.content,
        '[]',
        0.1,
        'manual',
        1,
        1,
        null,
        0,
        null,
        0,
        2,
        'confidence'
      )
    repo.turns.startSession('s1', 1000)
    repo.turns.insert({ sessionId: 's1', role: 'user', content: 'turno preservado', at: 1100 })

    const result = repo.removeAll()

    expect(result.removed).toBe(2)
    expect(result.turns).toBe(0)
    expect(repo.list().total).toBe(0)
    expect(repo.listArchived()).toHaveLength(0)
    expect(repo.turns.countAll()).toBe(1)
    expect(repo.turns.listSessions()).toHaveLength(1)
  })

  it('paginação e ordenação não repetem nem perdem itens', () => {
    const { repo } = setup()
    const created = Array.from({ length: 25 }, (_, index) =>
      repo.insert({
        kind: 'fact',
        content: `memória paginada ${index} sobre cafe`,
        confidence: (index % 5) / 4,
        useCount: index % 7,
        createdAt: 1000 + index,
        updatedAt: 1000 + index
      })
    )

    const pages = [0, 10, 20].map((offset) => repo.list({ limit: 10, offset }).memories)
    const ids = pages.flat().map((memory) => memory.id)
    expect(new Set(ids).size).toBe(25)
    expect(repo.list({ limit: 10, offset: 20 }).total).toBe(25)
    // Ordenação padrão: updated_at DESC, id DESC.
    expect(ids).toEqual(
      [...created]
        .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id))
        .map((memory) => memory.id)
    )

    for (const sort of ['date', 'usage', 'confidence'] as const) {
      const all = repo.list({ limit: 25, sort }).memories.map((memory) => memory.id)
      const paged = [0, 7, 14, 21].flatMap((offset) =>
        repo.list({ limit: 7, offset, sort }).memories.map((memory) => memory.id)
      )
      expect(new Set(paged).size).toBe(25)
      expect(paged).toEqual(all)
    }

    const searchIds = [0, 5, 15].flatMap((offset) =>
      repo.list({ query: 'cafe', limit: 10, offset }).memories.map((memory) => memory.id)
    )
    expect(new Set(searchIds).size).toBe(25)
    expect(repo.list({ query: 'cafe', limit: 10, offset: 20 }).total).toBe(25)
  })

  it('consolidação cancelada não grava nada', () => {
    const { repo } = setup()
    const now = Date.now()
    repo.insert({ kind: 'fact', content: 'Trabalha na Kolnd' })
    repo.insert({ kind: 'fact', content: 'Trabalha na Kolnd.' })
    repo.insert({
      kind: 'temporary',
      content: 'temporária já vencida',
      expiresAt: now - 1000
    })
    expect(repo.list().total).toBe(2)
    const rawCount = repo.handle.prepare('SELECT COUNT(*) AS total FROM memories').get() as {
      total: number
    }
    expect(rawCount.total).toBe(3)

    expect(() => consolidate(repo, { now, shouldCancel: () => true })).toThrow(
      ConsolidationCancelled
    )

    expect(repo.list().total).toBe(2)
    const afterCancel = repo.handle.prepare('SELECT COUNT(*) AS total FROM memories').get() as {
      total: number
    }
    expect(afterCancel.total).toBe(3)
    expect(repo.listArchived()).toHaveLength(0)
    expect(repo.maintenance()).toHaveLength(0)
  })

  it('perfil de comparação mantém a mesma decisão de duplicata', () => {
    const pairs: Array<[string, string]> = [
      ['Trabalha na Kolnd', 'Trabalha na Kolnd.'],
      ['Mora em Curitiba', 'Mora em Curitiba com dois gatos'],
      ['Prefere café sem açúcar', 'Prefere cafe sem acucar'],
      ['Usa Windows 11', 'Usa Windows 10'],
      ['Texto completamente diferente', 'Outra frase sem relação alguma']
    ]
    for (const [a, b] of pairs) {
      expect(isDuplicateProfile(buildCompareProfile(a), buildCompareProfile(b))).toBe(
        isDuplicateContent(a, b)
      )
    }
  })
})
