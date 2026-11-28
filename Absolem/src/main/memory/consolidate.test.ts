import { describe, expect, it } from 'vitest'
import { consolidate } from './consolidate'
import { createMemoryRepository, type MemoryRepository } from './repository'
import { createTestMemoryDatabase } from './testing/tempDatabase'

const DAY = 24 * 60 * 60 * 1000

function setup(): { repo: MemoryRepository; cleanup: () => void } {
  const db = createTestMemoryDatabase()
  return { repo: createMemoryRepository(db.database.handle), cleanup: db.cleanup }
}

describe('consolidação de memórias', () => {
  it('temporary expirada sai', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      repo.insert({
        kind: 'temporary',
        content: 'Lembrete que já venceu',
        expiresAt: now - 1000
      })
      repo.insert({ kind: 'fact', content: 'Fato permanente' })

      const report = consolidate(repo, { now })

      expect(report.expiredRemoved).toBe(1)
      expect(repo.list().total).toBe(1)
      expect(repo.list().memories[0]?.content).toBe('Fato permanente')
    } finally {
      cleanup()
    }
  })

  it('duplicata é mesclada', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      repo.insert({
        kind: 'fact',
        content: 'Trabalha na Kolnd',
        tags: ['trabalho'],
        confidence: 0.8,
        useCount: 1,
        updatedAt: now
      })
      repo.insert({
        kind: 'fact',
        content: 'Trabalha na Kolnd.',
        tags: ['carreira'],
        confidence: 0.8,
        useCount: 2,
        updatedAt: now
      })

      const report = consolidate(repo, { now })

      expect(report.merged).toBe(1)
      expect(repo.list().total).toBe(1)
      const merged = repo.list().memories[0]
      expect(merged?.useCount).toBe(3)
      expect(merged?.tags).toEqual(['carreira', 'trabalho'])
    } finally {
      cleanup()
    }
  })

  it('confiança decai após 90 dias', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      const old = now - 100 * DAY
      const memory = repo.insert({
        kind: 'fact',
        content: 'Fato antigo e não usado',
        confidence: 0.7,
        updatedAt: old,
        createdAt: old,
        lastUsedAt: old
      })

      const report = consolidate(repo, { now })

      expect(report.decayed).toBe(1)
      expect(repo.get(memory.id)?.confidence).toBe(0.6)
    } finally {
      cleanup()
    }
  })

  it('arquivo preserva conteúdo', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      const memory = repo.insert({
        kind: 'fact',
        content: 'Fato de baixa confiança que vai ao arquivo',
        confidence: 0.1
      })

      const report = consolidate(repo, { now })

      expect(report.archived).toBe(1)
      expect(repo.list().total).toBe(0)
      const archived = repo.listArchived()
      expect(archived).toHaveLength(1)
      expect(archived[0]?.id).toBe(memory.id)
      expect(archived[0]?.content).toBe('Fato de baixa confiança que vai ao arquivo')
      expect(archived[0]?.reason).toBe('confidence')
    } finally {
      cleanup()
    }
  })

  it('limite de 5.000', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      const contents = [
        'Usa Windows 11 no notebook',
        'Mora em Curitiba com dois gatos',
        'Estuda japonês nas terças',
        'Prefere reuniões pela manhã',
        'Corre no parque aos domingos',
        'Evita açúcar no café'
      ]
      contents.forEach((content, index) => {
        repo.insert({
          kind: 'fact',
          content,
          createdAt: now + index,
          updatedAt: now + index
        })
      })

      const report = consolidate(repo, { now, limit: 5 })

      expect(report.trimmed).toBe(1)
      expect(repo.list().total).toBe(5)
      expect(repo.listArchived()).toHaveLength(1)
      expect(repo.listArchived()[0]?.reason).toBe('limit')
    } finally {
      cleanup()
    }
  })
})
