import { describe, expect, it, vi } from 'vitest'
import type { IpcError } from '../../shared/ipc'
import { IPC } from '../../shared/ipc'
import type { MemoryKind, MemoryRecord, MemoryStats } from '../../shared/memory'
import { emptyMemoryStats } from '../../shared/memory'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { createMemoryHandlers } = await import('./memory')
type MemoryService = import('./memory').MemoryService
type MemoryPayloadHandler = import('./memory').MemoryPayloadHandler

import { createMemoryRepository, type MemoryRepository } from '../memory/repository'
import { createTestMemoryDatabase } from '../memory/testing/tempDatabase'

function statsOf(repo: MemoryRepository): MemoryStats {
  const memories = repo.list({ limit: 5000 }).memories
  const stats = emptyMemoryStats()
  stats.total = memories.length
  stats.byKind = { fact: 0, preference: 0, profile: 0, temporary: 0 }
  let bytes = 0
  for (const memory of memories) {
    stats.byKind[memory.kind] += 1
    bytes += memory.content.length
  }
  stats.approxBytes = bytes
  return stats
}

function setup(): {
  handlers: Record<string, MemoryPayloadHandler>
  repo: MemoryRepository
  audit: ReturnType<typeof vi.fn>
  cleanup: () => void
} {
  const db = createTestMemoryDatabase()
  const repo = createMemoryRepository(db.database.handle)
  const audit = vi.fn()
  const service: MemoryService = {
    list: (query) => repo.list(query),
    archived: (limit) => repo.listArchived(limit),
    maintenance: (limit) => repo.maintenance(limit),
    search: (query, limit) => repo.search(query, { limit }),
    create: (input) => repo.insert(input),
    update: (id, patch) => repo.update(id, patch),
    remove: (id) => repo.remove(id),
    removeAll: (options) => repo.removeAll(options),
    stats: () => statsOf(repo),
    exportFile: async () => ({ ok: true, canceled: true }),
    importFile: async () => ({ ok: true, canceled: true }),
    recordAudit: audit
  }
  return { handlers: createMemoryHandlers(service), repo, audit, cleanup: db.cleanup }
}

function handler(
  handlers: Record<string, MemoryPayloadHandler>,
  channel: string
): (payload: unknown) => unknown {
  const found = handlers[channel]
  if (!found) throw new Error(`handler ausente: ${channel}`)
  return found
}

function seed(repo: MemoryRepository, kind: MemoryKind, content: string): MemoryRecord {
  return repo.insert({ kind, content })
}

describe('IPC de memória', () => {
  it('list pagina', () => {
    const { handlers, repo, cleanup } = setup()
    try {
      seed(repo, 'fact', 'Fato um')
      seed(repo, 'fact', 'Fato dois')
      seed(repo, 'preference', 'Preferência três')

      const first = handler(handlers, IPC.memoryList)({ limit: 2, offset: 0 }) as {
        ok: true
        memories: unknown[]
        total: number
        hasMore: boolean
      }
      expect(first.ok).toBe(true)
      expect(first.memories).toHaveLength(2)
      expect(first.total).toBe(3)
      expect(first.hasMore).toBe(true)

      const second = handler(handlers, IPC.memoryList)({ limit: 2, offset: 2 }) as {
        ok: true
        memories: unknown[]
        total: number
        hasMore: boolean
      }
      expect(second.memories).toHaveLength(1)
      expect(second.hasMore).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('update com campo proibido é recusado', () => {
    const { handlers, repo, cleanup } = setup()
    try {
      const memory = seed(repo, 'fact', 'Fato original')
      const result = handler(
        handlers,
        IPC.memoryUpdate
      )({
        id: memory.id,
        patch: { createdAt: 1 }
      }) as IpcError

      expect(result.ok).toBe(false)
      expect(result.error).toContain('createdAt')
      expect(repo.get(memory.id)?.createdAt).toBe(memory.createdAt)
    } finally {
      cleanup()
    }
  })

  it('remove-all sem confirmação literal é recusado', () => {
    const { handlers, repo, audit, cleanup } = setup()
    try {
      seed(repo, 'fact', 'Fato um')
      seed(repo, 'fact', 'Fato dois')

      const denied = handler(handlers, IPC.memoryRemoveAll)({ confirm: 'APAGAR' }) as IpcError
      expect(denied.ok).toBe(false)
      expect(repo.list().total).toBe(2)

      const accepted = handler(
        handlers,
        IPC.memoryRemoveAll
      )({
        confirm: 'APAGAR TUDO',
        includeTurns: true
      }) as { ok: true; removed: number; turns: number }
      expect(accepted.ok).toBe(true)
      expect(accepted.removed).toBe(2)
      expect(repo.list().total).toBe(0)
      expect(audit).toHaveBeenCalledWith('remove-all', null, null)
    } finally {
      cleanup()
    }
  })

  it('stats conta por kind', () => {
    const { handlers, repo, cleanup } = setup()
    try {
      seed(repo, 'fact', 'Fato um')
      seed(repo, 'fact', 'Fato dois')
      seed(repo, 'preference', 'Prefere café')

      const result = handler(handlers, IPC.memoryStats)(undefined) as {
        ok: true
        stats: MemoryStats
      }

      expect(result.ok).toBe(true)
      expect(result.stats.total).toBe(3)
      expect(result.stats.byKind.fact).toBe(2)
      expect(result.stats.byKind.preference).toBe(1)
    } finally {
      cleanup()
    }
  })
})
