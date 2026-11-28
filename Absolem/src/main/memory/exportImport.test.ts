import { describe, expect, it, vi } from 'vitest'
import type { MemoryExportFile } from '../../shared/memory'
import { MEMORY_EXPORT_VERSION } from '../../shared/memory'
import { createMemoryIO, type MemoryIODialog, type MemoryIOFs } from './exportImport'
import { createMemoryRepository, type MemoryRepository } from './repository'
import { createTestMemoryDatabase } from './testing/tempDatabase'

function fakeFileSystem(): { fs: MemoryIOFs; files: Map<string, string> } {
  const files = new Map<string, string>()
  const fs: MemoryIOFs = {
    stat: async (path) => ({ size: Buffer.byteLength(files.get(path) ?? '', 'utf8') }),
    readFile: async (path) => files.get(path) ?? '',
    writeFile: async (path, data) => {
      files.set(path, data)
    }
  }
  return { fs, files }
}

function fakeDialog(options: {
  path: string
  confirm?: number
  savePath?: string
  canceledOpen?: boolean
  canceledSave?: boolean
}): { dialog: MemoryIODialog; confirm: ReturnType<typeof vi.fn> } {
  const confirm = vi.fn(async () => ({ response: options.confirm ?? 0 }))
  const dialog: MemoryIODialog = {
    showSaveDialog: async () => ({
      canceled: options.canceledSave === true,
      ...(options.savePath ? { filePath: options.savePath } : {})
    }),
    showOpenDialog: async () => ({
      canceled: options.canceledOpen === true,
      filePaths: [options.path]
    }),
    showMessageBox: confirm
  }
  return { dialog, confirm }
}

function setup(): {
  repo: MemoryRepository
  fs: MemoryIOFs
  files: Map<string, string>
  cleanup: () => void
} {
  const db = createTestMemoryDatabase()
  const { fs, files } = fakeFileSystem()
  return { repo: createMemoryRepository(db.database.handle), fs, files, cleanup: db.cleanup }
}

function exportFile(memories: unknown[], sessions?: unknown[]): MemoryExportFile {
  return {
    app: 'absolem',
    kind: 'memory',
    version: MEMORY_EXPORT_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    memories: memories as MemoryExportFile['memories'],
    ...(sessions ? { sessions: sessions as MemoryExportFile['sessions'] } : {})
  }
}

describe('exportar e importar memória', () => {
  it('export sem sessões quando não marcado', async () => {
    const { repo, fs, files, cleanup } = setup()
    try {
      repo.insert({ kind: 'fact', content: 'Gosta de café' })
      repo.turns.startSession('s1', 1000)
      repo.turns.insert({ sessionId: 's1', role: 'user', content: 'oi', at: 1100 })

      const path = 'C:\\temp\\memoria.json'
      const { dialog } = fakeDialog({ path, savePath: path })
      const io = createMemoryIO({ fs, dialog, repo })

      const file = io.buildExportFile(false)
      expect(file.sessions).toBeUndefined()
      expect(file.memories).toHaveLength(1)

      const withTurns = io.buildExportFile(true)
      expect(withTurns.sessions).toHaveLength(1)
      expect(withTurns.sessions?.[0]?.turns).toHaveLength(1)

      const result = await io.exportFile(false)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.canceled).toBe(false)
      expect(result.count).toBe(1)
      const written = JSON.parse(files.get(path) ?? '{}') as MemoryExportFile
      expect(written.sessions).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it('import com versão futura é recusado', async () => {
    const { repo, fs, files, cleanup } = setup()
    try {
      const path = 'C:\\temp\\futuro.json'
      files.set(path, JSON.stringify({ ...exportFile([]), version: MEMORY_EXPORT_VERSION + 1 }))
      const { dialog } = fakeDialog({ path })
      const io = createMemoryIO({ fs, dialog, repo })

      const result = await io.importFile()

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error).toContain('versão mais nova')
      expect(repo.list().total).toBe(0)
    } finally {
      cleanup()
    }
  })

  it('prévia conta duplicatas', async () => {
    const { repo, fs, files, cleanup } = setup()
    try {
      repo.insert({ kind: 'fact', content: 'Gosta de café' })
      const path = 'C:\\temp\\memoria.json'
      files.set(
        path,
        JSON.stringify(
          exportFile([
            { kind: 'fact', content: 'Gosta de café' },
            { kind: 'fact', content: 'Mora em Curitiba' }
          ])
        )
      )
      const { dialog, confirm } = fakeDialog({ path, confirm: 0 })
      const io = createMemoryIO({ fs, dialog, repo })

      const result = await io.importFile()

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.imported).toBe(1)
      expect(result.duplicates).toBe(1)
      expect(repo.list().total).toBe(2)
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ detail: expect.stringContaining('1 duplicada') })
      )
    } finally {
      cleanup()
    }
  })

  it('import não apaga existentes', async () => {
    const { repo, fs, files, cleanup } = setup()
    try {
      repo.insert({ kind: 'fact', content: 'Fato antigo um' })
      repo.insert({ kind: 'fact', content: 'Fato antigo dois' })
      const path = 'C:\\temp\\memoria.json'
      files.set(
        path,
        JSON.stringify(exportFile([{ kind: 'fact', content: 'Fato importado novo' }]))
      )
      const { dialog } = fakeDialog({ path, confirm: 0 })
      const io = createMemoryIO({ fs, dialog, repo })

      const result = await io.importFile()

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.imported).toBe(1)
      expect(repo.list().total).toBe(3)
      expect(repo.search('antigo')).toHaveLength(2)
    } finally {
      cleanup()
    }
  })
})
