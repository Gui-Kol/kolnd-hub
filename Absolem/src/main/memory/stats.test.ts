import { describe, expect, it } from 'vitest'
import { createMemoryRepository } from './repository'
import { setMeta } from './repository'
import { getMemoryStats } from './stats'
import { createTestMemoryDatabase } from './testing/tempDatabase'

describe('estatísticas da memória', () => {
  it('conta por kind', () => {
    const db = createTestMemoryDatabase()
    try {
      const repo = createMemoryRepository(db.database.handle)
      repo.insert({ kind: 'fact', content: 'Fato um' })
      repo.insert({ kind: 'fact', content: 'Fato dois' })
      repo.insert({ kind: 'profile', content: 'Perfil um' })

      const stats = getMemoryStats(db.database.handle)

      expect(stats.total).toBe(3)
      expect(stats.byKind).toEqual({ fact: 2, preference: 0, profile: 1, temporary: 0 })
    } finally {
      db.cleanup()
    }
  })

  it('approxBytes > 0 com dados', () => {
    const db = createTestMemoryDatabase()
    try {
      const repo = createMemoryRepository(db.database.handle)
      repo.insert({ kind: 'fact', content: 'Conteúdo com algum tamanho', tags: ['tag'] })

      const stats = getMemoryStats(db.database.handle)

      expect(stats.approxBytes).toBeGreaterThan(0)
      expect(stats.oldest).not.toBeNull()
      expect(stats.newest).not.toBeNull()
    } finally {
      db.cleanup()
    }
  })

  it('sem dados retorna zeros', () => {
    const db = createTestMemoryDatabase()
    try {
      setMeta(db.database.handle, 'last_extraction_at', '1700000000000')
      const stats = getMemoryStats(db.database.handle, { lastConsolidationAt: 1700000000000 })

      expect(stats.total).toBe(0)
      expect(stats.byKind).toEqual({ fact: 0, preference: 0, profile: 0, temporary: 0 })
      expect(stats.oldest).toBeNull()
      expect(stats.newest).toBeNull()
      expect(stats.pinned).toBe(0)
      expect(stats.approxBytes).toBe(0)
      expect(stats.lastExtractionAt).toBe(1700000000000)
      expect(stats.lastConsolidationAt).toBe(1700000000000)
    } finally {
      db.cleanup()
    }
  })
})
