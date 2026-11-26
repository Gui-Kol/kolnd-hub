import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../../shared/memory'
import { createMemoryRepository, type MemoryRepository } from './repository'
import { recall } from './retrieve'
import { createTestMemoryDatabase } from './testing/tempDatabase'

const DAY = 24 * 60 * 60 * 1000

function setup(): { repo: MemoryRepository; cleanup: () => void } {
  const db = createTestMemoryDatabase()
  return { repo: createMemoryRepository(db.database.handle), cleanup: db.cleanup }
}

function contents(memories: MemoryRecord[]): string[] {
  return memories.map((memory) => memory.content)
}

describe('recuperação de memórias', () => {
  it('query vazia devolve só pinned/perfil', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      repo.insert({ kind: 'fact', content: 'Fato comum sobre a rotina', updatedAt: now })
      repo.insert({ kind: 'preference', content: 'Prefere chá', updatedAt: now })
      repo.insert({ kind: 'profile', content: 'Perfil: designer em Curitiba', updatedAt: now })
      repo.insert({
        kind: 'fact',
        content: 'Fato fixado sobre o projeto',
        updatedAt: now,
        pinned: true
      })

      const result = recall(repo, '', { touch: false, now })

      expect(contents(result.memories)).toEqual([
        'Fato fixado sobre o projeto',
        'Perfil: designer em Curitiba'
      ])
      expect(result.text).toContain('[memória]')
      expect(result.text.length).toBeLessThanOrEqual(1200)
    } finally {
      cleanup()
    }
  })

  it('memória antiga perde para recente', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      repo.insert({
        kind: 'fact',
        content: 'Trabalho antigo na empresa Alfa',
        updatedAt: now - 180 * DAY,
        createdAt: now - 180 * DAY
      })
      repo.insert({
        kind: 'fact',
        content: 'Trabalho atual na empresa Beta',
        updatedAt: now,
        createdAt: now
      })

      const result = recall(repo, 'trabalho', { touch: false, now })

      expect(result.memories).toHaveLength(2)
      expect(result.memories[0]?.content).toBe('Trabalho atual na empresa Beta')
    } finally {
      cleanup()
    }
  })

  it('orçamento corta o excedente', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      for (let index = 0; index < 8; index += 1) {
        repo.insert({
          kind: 'profile',
          content: `Perfil ${index}: ${'detalhe '.repeat(40)}`,
          updatedAt: now - index * DAY
        })
      }

      const result = recall(repo, '', { budgetChars: 1200, touch: false, now })

      expect(result.memories.length).toBeLessThan(8)
      expect(result.memories.length).toBeGreaterThan(0)
      expect(result.text.length).toBeLessThanOrEqual(1200)
    } finally {
      cleanup()
    }
  })

  it('formato não excede o orçamento', () => {
    const { repo, cleanup } = setup()
    try {
      const now = Date.now()
      for (let index = 0; index < 5; index += 1) {
        repo.insert({
          kind: 'fact',
          content: `Projeto Atlas fase ${index} ${'andamento '.repeat(12)}`,
          updatedAt: now
        })
      }

      const result = recall(repo, 'projeto', { budgetChars: 300, touch: false, now })

      expect(result.text.length).toBeLessThanOrEqual(300)
      expect(result.text.startsWith('Memórias registradas')).toBe(true)
      expect(result.memories.every((memory) => result.text.includes(memory.content))).toBe(true)
    } finally {
      cleanup()
    }
  })
})
