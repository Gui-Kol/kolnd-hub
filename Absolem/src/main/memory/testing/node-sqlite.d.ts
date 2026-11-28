/**
 * Tipagem mínima de `node:sqlite` (Node 22.5+), usada apenas pelos testes.
 *
 * O @types/node do Electron 28 é o 18 e não conhece o módulo; o driver de
 * produção é `better-sqlite3`, então esta declaração fica restrita ao helper de
 * teste e não vaza para o código do app.
 */
declare module 'node:sqlite' {
  export type SQLInputValue = string | number | bigint | null | Uint8Array

  export interface StatementSync {
    run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint }
    get(...params: SQLInputValue[]): unknown
    all(...params: SQLInputValue[]): unknown[]
  }

  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}
