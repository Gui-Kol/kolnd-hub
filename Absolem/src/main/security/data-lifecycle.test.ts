import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createActionAuditWriter } from '../audit/actions'
import { openMemoryDatabase } from '../memory/db'
import { removeAllAndVacuum, vacuumDatabase } from '../memory/privacy'
import { createMemoryRepository } from '../memory/repository'
import { nodeSqliteOpener } from '../memory/testing/nodeSqlite'
import {
  FULL_BACKUP_KIND,
  FULL_BACKUP_VERSION,
  PURGE_CONFIRM,
  buildFullBackup,
  purgeAppData
} from './dataLifecycle'

/**
 * Ciclo de vida dos dados (task 13/T11).
 *
 * Usa só diretórios temporários; nunca toca em `%APPDATA%` real. O banco é
 * aberto com `node:sqlite` (mesmo SQL/FTS/VACUUM do app) para o teste rodar sem
 * o binário do Electron.
 */

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function write(path: string, content = 'x'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows pode manter o arquivo aberto por alguns ms.
    }
  }
})

describe('ciclo de vida dos dados', () => {
  it('apagar tudo remove banco, logs, auditoria, cache e configuração', () => {
    const dir = tempDir('absolem-purge-')
    const dbPath = join(dir, 'memory.sqlite')
    const opened = openMemoryDatabase({ path: dbPath, opener: nodeSqliteOpener })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const repo = createMemoryRepository(opened.database.handle)
    repo.insert({ kind: 'fact', content: 'Fato que deve sumir no purge' })

    write(join(dir, 'logs', 'absolem.log'), 'log antigo')
    write(join(dir, 'audit', 'actions.jsonl'), '{"op":"old"}')
    write(join(dir, 'audit', 'memory.jsonl'), '{"op":"old"}')
    write(join(dir, 'Cache', 'cache.bin'), 'cache')
    write(join(dir, 'captures', 'frame.png'), 'png')
    write(join(dir, 'config.json'), '{}')
    write(join(dir, 'secrets.bin'), 'blob')

    const result = purgeAppData({
      userDataDir: dir,
      confirm: PURGE_CONFIRM,
      close: () => opened.database.close()
    })

    expect(result.ok).toBe(true)
    expect(result.removed).toEqual(
      expect.arrayContaining(['memory.sqlite', 'logs', 'audit', 'cache', 'captures'])
    )
    expect(existsSync(dbPath)).toBe(false)
    expect(existsSync(join(dir, 'logs'))).toBe(false)
    expect(existsSync(join(dir, 'audit'))).toBe(false)
    expect(existsSync(join(dir, 'Cache'))).toBe(false)
    expect(existsSync(join(dir, 'captures'))).toBe(false)
    expect(existsSync(join(dir, 'config.json'))).toBe(false)
    expect(existsSync(join(dir, 'secrets.bin'))).toBe(false)
  })

  it('confirmação errada não apaga nada', () => {
    const dir = tempDir('absolem-purge-no-')
    write(join(dir, 'logs', 'absolem.log'), 'log')
    const result = purgeAppData({ userDataDir: dir, confirm: 'apagar' })
    expect(result.ok).toBe(false)
    expect(result.removed).toEqual([])
    expect(existsSync(join(dir, 'logs', 'absolem.log'))).toBe(true)
  })

  it('VACUUM reduz o arquivo depois de apagar tudo', () => {
    const dir = tempDir('absolem-vacuum-')
    const dbPath = join(dir, 'memory.sqlite')
    const opened = openMemoryDatabase({ path: dbPath, opener: nodeSqliteOpener })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const repo = createMemoryRepository(opened.database.handle)
    const filler = 'conteudo '.repeat(40)
    for (let index = 0; index < 300; index += 1) {
      repo.insert({ kind: 'fact', content: `${index} ${filler}` })
    }
    opened.database.handle.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const before = statSync(dbPath).size
    expect(before).toBeGreaterThan(0)

    const result = removeAllAndVacuum(repo, { includeTurns: true })
    expect(result.removed).toBe(300)
    opened.database.handle.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const after = statSync(dbPath).size
    expect(after).toBeLessThan(before)
    expect(vacuumDatabase(opened.database.handle)).toBe(true)
    opened.database.close()
  })

  it('retenção de auditoria remove evento com mais de 90 dias', () => {
    const dir = tempDir('absolem-audit-retention-')
    const oldWriter = createActionAuditWriter({
      dir,
      now: () => new Date('2026-02-01T00:00:00.000Z')
    })
    oldWriter.write({
      at: '2026-02-01T00:00:00.000Z',
      tool: 'ler_arquivo',
      category: 'files.read',
      argsHash: 'abc',
      safeArgs: {},
      decision: 'allow',
      ok: true,
      durationMs: 1
    })

    const newWriter = createActionAuditWriter({
      dir,
      now: () => new Date('2026-11-26T00:00:00.000Z')
    })
    newWriter.write({
      tool: 'ler_arquivo',
      category: 'files.read',
      argsHash: 'def',
      safeArgs: {},
      decision: 'allow',
      ok: true,
      durationMs: 1
    })

    const text = readFileSync(newWriter.path, 'utf8')
    expect(text).toContain('"argsHash":"def"')
    expect(text).not.toContain('"argsHash":"abc"')
  })

  it('reinício não ressuscita dados antigos', () => {
    const dir = tempDir('absolem-restart-')
    const dbPath = join(dir, 'memory.sqlite')
    const first = openMemoryDatabase({ path: dbPath, opener: nodeSqliteOpener })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    createMemoryRepository(first.database.handle).insert({
      kind: 'fact',
      content: 'Este fato não pode voltar depois do purge'
    })
    const purged = purgeAppData({
      userDataDir: dir,
      confirm: PURGE_CONFIRM,
      close: () => first.database.close()
    })
    expect(purged.ok).toBe(true)
    expect(existsSync(dbPath)).toBe(false)

    // O app reabre o caminho do zero; o schema é recriado vazio.
    const second = openMemoryDatabase({ path: dbPath, opener: nodeSqliteOpener })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const repo = createMemoryRepository(second.database.handle)
    expect(repo.list().total).toBe(0)
    expect(repo.search('purge')).toHaveLength(0)
    expect(existsSync(join(dir, 'logs'))).toBe(false)
    expect(existsSync(join(dir, 'audit'))).toBe(false)
    second.database.close()
  })

  it('exportação completa inclui memória, config e tema', () => {
    const backup = buildFullBackup({
      theme: { presetId: 'jade' },
      config: { memory: { enabled: true } },
      memory: { memories: [{ content: 'fato' }] },
      now: new Date('2026-11-26T12:00:00.000Z')
    })
    expect(backup.app).toBe('absolem')
    expect(backup.kind).toBe(FULL_BACKUP_KIND)
    expect(backup.version).toBe(FULL_BACKUP_VERSION)
    expect(backup.exportedAt).toBe('2026-11-26T12:00:00.000Z')
    expect(backup.theme).toEqual({ presetId: 'jade' })
    expect(backup.config).toEqual({ memory: { enabled: true } })
    expect(backup.memory).toEqual({ memories: [{ content: 'fato' }] })
  })
})
