import { existsSync, rmSync } from 'fs'
import { join } from 'path'

/**
 * Ciclo de vida dos dados (task 13/T11).
 *
 * `purgeAppData` apaga o pacote local com confirmação literal; `buildFullBackup`
 * monta o envelope de exportação completa (memória, config e tema). O módulo é
 * puro: recebe o diretório `userData` e um `close` opcional (para fechar o banco
 * antes de remover o arquivo). Não apaga o diretório raiz, só os alvos
 * conhecidos, para nunca tocar em algo fora do `userData` do Absolem.
 */

export const PURGE_CONFIRM = 'APAGAR TUDO'

/** Alvos conhecidos dentro de `userData`. Capturas não são persistidas na v1. */
export const PURGE_TARGETS = [
  'memory.sqlite',
  'memory.sqlite-wal',
  'memory.sqlite-shm',
  'logs',
  'audit',
  'captures',
  'cache',
  'Cache',
  'GPUCache',
  'Code Cache',
  'DawnCache',
  'ShaderCache',
  'Local Storage',
  'Session Storage',
  'Network',
  'Cookies',
  'Preferences',
  'secrets.bin',
  'config.json',
  'scripts',
  'Crashpad',
  'blob_storage'
] as const

export interface PurgeOptions {
  userDataDir: string
  /** Texto literal; qualquer outra coisa recusa a operação. */
  confirm: string
  /** Fecha o banco/store antes de remover os arquivos. */
  close?: () => void
}

export interface PurgeResult {
  ok: boolean
  removed: string[]
  error?: string
}

/**
 * Apaga banco, logs, auditoria, caches, capturas temporárias, config e chave.
 * Não usa `rm -rf` no diretório raiz; só nos nomes conhecidos. A operação é
 * idempotente e nunca lança.
 */
export function purgeAppData(options: PurgeOptions): PurgeResult {
  if (options.confirm !== PURGE_CONFIRM) {
    return {
      ok: false,
      removed: [],
      error: `Confirmação inválida. Escreva exatamente "${PURGE_CONFIRM}".`
    }
  }
  if (!options.userDataDir || typeof options.userDataDir !== 'string') {
    return { ok: false, removed: [], error: 'Diretório de dados inválido.' }
  }
  try {
    options.close?.()
  } catch (error) {
    return {
      ok: false,
      removed: [],
      error: `Falha ao fechar o banco antes de apagar: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }

  const removed: string[] = []
  for (const target of PURGE_TARGETS) {
    const full = join(options.userDataDir, target)
    if (!existsSync(full)) continue
    try {
      rmSync(full, { recursive: true, force: true })
      removed.push(target)
    } catch (error) {
      return {
        ok: false,
        removed,
        error: `Falha ao apagar ${target}: ${
          error instanceof Error ? error.message : String(error)
        }`
      }
    }
  }
  return { ok: true, removed }
}

export const FULL_BACKUP_KIND = 'absolem-backup'
export const FULL_BACKUP_VERSION = 1

export interface FullBackup {
  app: 'absolem'
  kind: typeof FULL_BACKUP_KIND
  version: number
  exportedAt: string
  theme: unknown
  config: unknown
  memory: unknown
}

/**
 * Envelope único de exportação. O chamador passa o resultado de
 * `memory:export` (sem transcrições, salvo escolha explícita), o snapshot do
 * `config.json` e o tema. Não escreve em disco; a UI decide o destino.
 */
export function buildFullBackup(input: {
  theme: unknown
  config: unknown
  memory: unknown
  now?: Date
}): FullBackup {
  return {
    app: 'absolem',
    kind: FULL_BACKUP_KIND,
    version: FULL_BACKUP_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    theme: input.theme ?? null,
    config: input.config ?? null,
    memory: input.memory ?? null
  }
}
