/**
 * Abertura e migração do banco de memória (`userData/memory.sqlite`).
 *
 * - WAL, `foreign_keys = ON` e `busy_timeout = 3000` em toda abertura;
 * - versão do schema na tabela `schema_version` (uma linha), migrações
 *   aditivas e imutáveis: uma migração lançada nunca é editada;
 * - sem `better-sqlite3`/arquivo inacessível, devolve `{ ok:false }` e o app
 *   segue funcionando com a memória desabilitada (nunca derruba o boot);
 * - o driver SQL é abstraído (`SqlDatabase`) para os testes rodarem no
 *   `node:sqlite` embutido no Node moderno, sem depender do binário do Electron.
 */

export const MEMORY_SCHEMA_VERSION = 2

export type SqlValue = string | number | null

export interface SqlRunResult {
  changes: number
  lastInsertRowid: number
}

export interface SqlStatement {
  run: (...params: SqlValue[]) => SqlRunResult
  get: (...params: SqlValue[]) => unknown
  all: (...params: SqlValue[]) => unknown[]
}

export interface SqlDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => SqlStatement
  close: () => void
}

export type DatabaseOpener = (path: string) => SqlDatabase

export interface MemoryDbLogger {
  warn: (scope: string, message: unknown, ...args: unknown[]) => void
}

export interface OpenMemoryDatabaseOptions {
  path: string
  /** Versão-alvo (default: a mais nova). Usado por testes de migração. */
  targetVersion?: number
  /** Driver SQL. Default: `better-sqlite3` (binário do Electron). */
  opener?: DatabaseOpener
  logger?: MemoryDbLogger
}

export interface MemoryDatabase {
  path: string
  version: number
  handle: SqlDatabase
  close: () => void
}

export type MemoryDbOpenResult =
  { ok: true; database: MemoryDatabase } | { ok: false; error: string }

interface SchemaMigration {
  version: number
  sql: string
}

interface BetterSqliteStatement {
  run: (...params: SqlValue[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
  get: (...params: SqlValue[]) => unknown
  all: (...params: SqlValue[]) => unknown[]
}

interface BetterSqliteDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => BetterSqliteStatement
  close: () => void
}

type BetterSqliteConstructor = new (
  filename: string,
  options?: { timeout?: number }
) => BetterSqliteDatabase

/** Versão inicial: tabela de memórias (task 09/T1). */
const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'profile', 'temporary')),
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0.7,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0
);
`

/**
 * Versão 2: FTS5 external-content com triggers, turnos/sessões da voz,
 * arquivo, metadados e relatório de manutenção. O `rebuild` indexa as linhas
 * que já existiam na v1.
 */
const SCHEMA_V2 = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tags,
  content='memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.rowid, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags)
  VALUES ('delete', old.rowid, old.content, old.tags);
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, new.tags);
END;

CREATE TABLE IF NOT EXISTS memories_archive (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  content TEXT NOT NULL,
  at INTEGER NOT NULL,
  interrupted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS memory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  op TEXT NOT NULL,
  detail TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at);
CREATE INDEX IF NOT EXISTS idx_memories_last_used ON memories(last_used_at);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, at);

INSERT INTO memories_fts(memories_fts) VALUES('rebuild');
`

const MIGRATIONS: readonly SchemaMigration[] = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: SCHEMA_V2 }
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Carrega o binário nativo só quando o driver de produção é usado. */
function loadBetterSqlite(): BetterSqliteConstructor {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded: unknown = require('better-sqlite3')
  if (typeof loaded === 'function') return loaded as BetterSqliteConstructor
  if (loaded && typeof loaded === 'object' && 'default' in loaded) {
    const fallback = (loaded as { default: unknown }).default
    if (typeof fallback === 'function') return fallback as BetterSqliteConstructor
  }
  throw new Error('better-sqlite3 não expõe um construtor.')
}

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value
}

function wrapBetterSqlite(raw: BetterSqliteDatabase): SqlDatabase {
  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const statement = raw.prepare(sql)
      return {
        run: (...params) => {
          const result = statement.run(...params)
          return {
            changes: toNumber(result.changes),
            lastInsertRowid: toNumber(result.lastInsertRowid)
          }
        },
        get: (...params) => statement.get(...params),
        all: (...params) => statement.all(...params)
      }
    },
    close: () => raw.close()
  }
}

/** Driver de produção. Exportado para injeção explícita em smoke/diagnóstico. */
export const betterSqliteOpener: DatabaseOpener = (path) => {
  const Database = loadBetterSqlite()
  return wrapBetterSqlite(new Database(path, { timeout: 3000 }))
}

export function readSchemaVersion(db: SqlDatabase): number {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get()
  if (!row || typeof row !== 'object' || !('version' in row)) return 0
  const value = (row as { version: unknown }).version
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Aplica as migrações pendentes até `targetVersion` (default: a mais nova).
 * Cada migração roda em transação própria; falha faz rollback e propaga.
 */
export function migrateMemoryDatabase(
  db: SqlDatabase,
  targetVersion: number = MEMORY_SCHEMA_VERSION
): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const current = readSchemaVersion(db)
  if (current > MEMORY_SCHEMA_VERSION) {
    throw new Error(
      `banco de memória na versão ${current}; este app conhece até ${MEMORY_SCHEMA_VERSION}`
    )
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current || migration.version > targetVersion) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.exec('DELETE FROM schema_version')
      db.exec(`INSERT INTO schema_version (version) VALUES (${migration.version})`)
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // rollback best-effort: o erro original é o que importa
      }
      throw error
    }
  }
  return readSchemaVersion(db)
}

/**
 * Abre o banco e aplica as migrações. Nunca lança: qualquer falha vira
 * `{ ok:false }` com log `memory`, e o chamador degrada a memória.
 */
export function openMemoryDatabase(options: OpenMemoryDatabaseOptions): MemoryDbOpenResult {
  let raw: SqlDatabase | null = null
  try {
    raw = (options.opener ?? betterSqliteOpener)(options.path)
    raw.prepare('PRAGMA journal_mode = WAL').get()
    raw.exec('PRAGMA foreign_keys = ON')
    raw.exec('PRAGMA busy_timeout = 3000')
    const version = migrateMemoryDatabase(raw, options.targetVersion ?? MEMORY_SCHEMA_VERSION)
    const handle = raw
    return {
      ok: true,
      database: {
        path: options.path,
        version,
        handle,
        close: () => {
          try {
            handle.close()
          } catch {
            // fechar duas vezes não é erro
          }
        }
      }
    }
  } catch (error) {
    try {
      raw?.close()
    } catch {
      // nada a fazer
    }
    const message = errorMessage(error)
    options.logger?.warn('memory', 'banco de memória indisponível; memória desabilitada', message)
    return { ok: false, error: message }
  }
}
