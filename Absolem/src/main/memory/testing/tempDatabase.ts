import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openMemoryDatabase, type MemoryDatabase } from '../db'
import { nodeSqliteOpener } from './nodeSqlite'

export interface TestMemoryDatabase {
  database: MemoryDatabase
  dir: string
  cleanup: () => void
}

/** Banco real de teste (node:sqlite) em diretório temporário isolado. */
export function createTestMemoryDatabase(
  options: { targetVersion?: number } = {}
): TestMemoryDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'absolem-memoria-'))
  const result = openMemoryDatabase({
    path: join(dir, 'memory.sqlite'),
    opener: nodeSqliteOpener,
    ...(options.targetVersion === undefined ? {} : { targetVersion: options.targetVersion })
  })
  if (!result.ok) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`falha ao abrir banco de teste: ${result.error}`)
  }
  let closed = false
  return {
    database: result.database,
    dir,
    cleanup: () => {
      if (!closed) {
        closed = true
        result.database.close()
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Windows pode manter o arquivo aberto por alguns ms
      }
    }
  }
}
