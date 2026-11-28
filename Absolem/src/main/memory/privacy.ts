import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { MemoryConfig } from '../../shared/config'
import type { SqlDatabase } from './db'
import type { MemoryRepository, RemoveAllOptions, RemoveAllResult } from './repository'

/**
 * Privacidade da memória (task 09/T9).
 *
 * - pausar (`enabled:false`) interrompe extração e recuperação sem apagar nada;
 * - apagar remove a linha e reconstrói o FTS na mesma transação (repository);
 * - apagar tudo pode limpar `turns`/`sessions` e roda `VACUUM` depois;
 * - auditoria em `userData/audit/memory.jsonl` grava só `{ at, op, id, kind }`,
 *   nunca o conteúdo da memória.
 *
 * O banco NÃO é cifrado na v1: a proteção é a ACL do perfil do Windows. Isso
 * está documentado em `docs/memory.md` e foi aceito no gate de privacidade.
 */

export const MEMORY_AUDIT_MAX_BYTES = 5 * 1024 * 1024
export const MEMORY_AUDIT_KEEP = 2

export interface MemoryAuditEvent {
  at: string
  op: string
  id: string | null
  kind: string | null
}

export interface MemoryAuditWriter {
  write: (event: { op: string; id?: string | null; kind?: string | null; at?: string }) => boolean
  path: string
}

export interface MemoryAuditOptions {
  dir: string
  now?: () => Date
  maxBytes?: number
  keep?: number
}

function numberedPath(path: string, index: number): string {
  const ext = extname(path)
  return join(dirname(path), `${basename(path, ext)}.${index}${ext}`)
}

/** Writer JSONL append-only, rotação por tamanho e sem conteúdo de memória. */
export function createMemoryAuditWriter(options: MemoryAuditOptions): MemoryAuditWriter {
  const maxBytes = options.maxBytes ?? MEMORY_AUDIT_MAX_BYTES
  const keep = options.keep ?? MEMORY_AUDIT_KEEP
  const now = options.now ?? (() => new Date())
  const filePath = join(options.dir, 'memory.jsonl')

  function rotate(): void {
    let size: number
    try {
      size = statSync(filePath).size
    } catch {
      return
    }
    if (size < maxBytes) return
    try {
      const oldest = numberedPath(filePath, keep)
      if (existsSync(oldest)) unlinkSync(oldest)
    } catch {
      // best-effort
    }
    for (let index = keep - 1; index >= 1; index -= 1) {
      try {
        const from = numberedPath(filePath, index)
        if (existsSync(from)) renameSync(from, numberedPath(filePath, index + 1))
      } catch {
        // best-effort
      }
    }
    try {
      renameSync(filePath, numberedPath(filePath, 1))
    } catch {
      // a próxima escrita recria o arquivo
    }
  }

  function write(event: {
    op: string
    id?: string | null
    kind?: string | null
    at?: string
  }): boolean {
    try {
      mkdirSync(options.dir, { recursive: true })
      rotate()
      const line: MemoryAuditEvent = {
        at: typeof event.at === 'string' ? event.at : now().toISOString(),
        op: String(event.op ?? '').slice(0, 40),
        id: typeof event.id === 'string' ? event.id.slice(0, 100) : null,
        kind: typeof event.kind === 'string' ? event.kind.slice(0, 30) : null
      }
      appendFileSync(filePath, `${JSON.stringify(line)}\n`, 'utf8')
      return true
    } catch {
      return false
    }
  }

  return { write, path: filePath }
}

/** Store mínimo da pausa (testável sem Electron). */
export interface MemoryConfigStore {
  read: () => MemoryConfig
  write: (next: MemoryConfig) => { success: boolean; error?: string }
}

/**
 * Liga/desliga a memória sem tocar no banco. Pausar nunca apaga; retomar
 * devolve exatamente o que existia.
 */
export function setMemoryEnabled(
  store: MemoryConfigStore,
  audit: MemoryAuditWriter,
  enabled: boolean
): { ok: boolean; error?: string } {
  let current: MemoryConfig
  try {
    current = store.read()
  } catch {
    return { ok: false, error: 'Não foi possível ler a configuração da memória.' }
  }
  if (current.enabled === enabled) return { ok: true }
  const result = store.write({ ...current, enabled })
  if (!result.success) {
    return { ok: false, error: result.error ?? 'Falha ao salvar a configuração da memória.' }
  }
  audit.write({ op: enabled ? 'resume' : 'pause', id: null, kind: null })
  return { ok: true }
}

/** `VACUUM` devolve páginas livres ao SO (após apagar tudo/import em massa). */
export function vacuumDatabase(handle: SqlDatabase): boolean {
  try {
    handle.exec('VACUUM')
    return true
  } catch {
    return false
  }
}

/**
 * Apaga todas as memórias (e opcionalmente turnos/sessões), reconstrói o FTS
 * (feito pelo repository) e roda `VACUUM`. A auditoria fica a cargo do IPC,
 * que registra os mesmos metadados sem conteúdo.
 */
export function removeAllAndVacuum(
  repo: MemoryRepository,
  options: RemoveAllOptions = {}
): RemoveAllResult {
  const result = repo.removeAll(options)
  vacuumDatabase(repo.handle)
  return result
}
