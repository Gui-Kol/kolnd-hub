import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryConfig } from '../../shared/config'
import { createMemoryAuditWriter, removeAllAndVacuum, setMemoryEnabled } from './privacy'
import { createMemoryRepository, type MemoryRepository } from './repository'
import { createTestMemoryDatabase } from './testing/tempDatabase'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows pode manter o arquivo aberto por alguns ms
    }
  }
})

function auditDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'absolem-audit-'))
  dirs.push(dir)
  return dir
}

function setup(): { repo: MemoryRepository; cleanup: () => void } {
  const db = createTestMemoryDatabase()
  return { repo: createMemoryRepository(db.database.handle), cleanup: db.cleanup }
}

function configStore(initial: MemoryConfig): {
  read: () => MemoryConfig
  write: (next: MemoryConfig) => { success: boolean }
  current: () => MemoryConfig
} {
  let current = initial
  return {
    read: () => current,
    write: (next) => {
      current = next
      return { success: true }
    },
    current: () => current
  }
}

describe('privacidade da memória', () => {
  it('pausar não apaga', () => {
    const { repo, cleanup } = setup()
    const dir = auditDir()
    try {
      const store = configStore({ enabled: true, autoExtract: true, lastConsolidationAt: null })
      const audit = createMemoryAuditWriter({ dir })
      repo.insert({ kind: 'fact', content: 'Fato que deve sobreviver à pausa' })

      const result = setMemoryEnabled(store, audit, false)

      expect(result.ok).toBe(true)
      expect(store.current().enabled).toBe(false)
      expect(repo.list().total).toBe(1)
      expect(readFileSync(audit.path, 'utf8')).toContain('"op":"pause"')
    } finally {
      cleanup()
    }
  })

  it('apagar remove do FTS', () => {
    const { repo, cleanup } = setup()
    try {
      const memory = repo.insert({ kind: 'fact', content: 'Conteúdo pesquisável exclusivo' })
      expect(repo.search('pesquisável')).toHaveLength(1)

      expect(repo.remove(memory.id)).toBe(true)

      expect(repo.search('pesquisável')).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it('apagar tudo limpa turns quando pedido', () => {
    const { repo, cleanup } = setup()
    try {
      repo.insert({ kind: 'fact', content: 'Fato qualquer' })
      repo.turns.startSession('s1', 1000)
      repo.turns.insert({ sessionId: 's1', role: 'user', content: 'olá', at: 1100 })
      repo.turns.insert({ sessionId: 's1', role: 'model', content: 'oi', at: 1200 })
      expect(repo.turns.countAll()).toBe(2)

      const result = removeAllAndVacuum(repo, { includeTurns: true })

      expect(result.removed).toBe(1)
      expect(result.turns).toBe(2)
      expect(repo.list().total).toBe(0)
      expect(repo.turns.countAll()).toBe(0)
      expect(repo.turns.listSessions()).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  it('auditoria não tem conteúdo', () => {
    const dir = auditDir()
    const audit = createMemoryAuditWriter({ dir })
    const event: { op: string; id?: string | null; kind?: string | null; content: string } = {
      op: 'remove',
      id: 'mem-1',
      kind: 'fact',
      content: 'SEGREDO-UNICO-DA-MEMORIA'
    }

    expect(audit.write(event)).toBe(true)

    const text = readFileSync(audit.path, 'utf8')
    expect(text).not.toContain('SEGREDO-UNICO-DA-MEMORIA')
    const parsed = JSON.parse(text.trim()) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(['at', 'id', 'kind', 'op'])
  })
})
