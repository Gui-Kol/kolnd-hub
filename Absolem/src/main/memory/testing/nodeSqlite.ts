import { createRequire } from 'module'
import type { DatabaseOpener, SqlDatabase, SqlValue } from '../db'

/**
 * Driver `node:sqlite` para os testes unitários.
 *
 * O binário do `better-sqlite3` é baixado para a ABI do Electron 28 e não
 * carrega no Node do sistema (ABI diferente). O Node moderno embute SQLite com
 * FTS5, então os testes exercitam SQL real (WAL, triggers, bm25, VACUUM) sem
 * precisar do módulo nativo. O app empacotado é validado no smoke da T11.
 *
 * `createRequire` evita o resolvedor do Vite, que ainda não conhece
 * `node:sqlite` como builtin e tentaria abrir um arquivo `sqlite`.
 */

const nodeRequire = createRequire(import.meta.url)
const sqliteModule = nodeRequire('node:sqlite') as typeof import('node:sqlite')

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value
}

export const nodeSqliteOpener: DatabaseOpener = (path) => {
  const raw = new sqliteModule.DatabaseSync(path)
  const wrapped: SqlDatabase = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const statement = raw.prepare(sql)
      return {
        run: (...params: SqlValue[]) => {
          const result = statement.run(...params)
          return {
            changes: toNumber(result.changes),
            lastInsertRowid: toNumber(result.lastInsertRowid)
          }
        },
        get: (...params: SqlValue[]) => statement.get(...params),
        all: (...params: SqlValue[]) => statement.all(...params)
      }
    },
    close: () => raw.close()
  }
  return wrapped
}
