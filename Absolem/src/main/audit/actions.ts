import { createHash } from 'crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { basename, dirname, extname, join } from 'path'
import {
  ACTION_LIMITS,
  effectivePermission,
  type PermissionDecision,
  type PermissionsState
} from '../../shared/permissions'

/**
 * Auditoria das ações (task 08, T10).
 *
 * JSONL append-only em `userData/audit/actions.jsonl`, rotação 5 MB x 2 e poda
 * de 90 dias na escrita. Campos: `{ at, tool, category, argsHash, safeArgs,
 * decision, ok, durationMs }`. `safeArgs` pode ter caminho, nunca conteúdo de
 * arquivo, chave ou transcrição. A escrita é síncrona e best-effort: falha de
 * disco não derruba a ação, mas o registro nunca é "esquecido" em background.
 */

export const AUDIT_MAX_BYTES = 5 * 1024 * 1024
export const AUDIT_KEEP = 2
export const AUDIT_RETENTION_DAYS = 90
const PRUNE_INTERVAL_MS = 60 * 60 * 1000
const MAX_SAFE_STRING = 200
const MAX_SAFE_ARRAY = 20
const MAX_SAFE_DEPTH = 4

/** Chaves aceitas em `safeArgs`; conteúdo/pergunta/transcrição ficam de fora. */
export const SAFE_ARG_KEYS = [
  'path',
  'paths',
  'from',
  'to',
  'kind',
  'name',
  'query',
  'roots',
  'pid',
  'level',
  'role',
  'windowTitle',
  'maxResults',
  'category',
  'id',
  'seconds'
] as const

export interface ActionAuditEvent {
  at: string
  tool: string
  category: string
  argsHash: string
  safeArgs: Record<string, unknown>
  decision: string
  ok: boolean
  durationMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Converte o valor para o subconjunto seguro da auditoria. Limita profundidade
 * e ignora ciclos: um array circular não pode estourar a pilha nem perder o
 * evento de auditoria.
 */
function sanitizeValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0
): unknown {
  if (typeof value === 'string') return value.slice(0, MAX_SAFE_STRING)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= MAX_SAFE_DEPTH || seen.has(value)) return undefined
    seen.add(value)
    return value
      .slice(0, MAX_SAFE_ARRAY)
      .map((item) => sanitizeValue(item, seen, depth + 1))
      .filter((item) => item !== undefined)
  }
  return undefined
}

/** Mantém só as chaves de caminho/alvo; nunca conteúdo, chave ou transcrição. */
export function sanitizeSafeArgs(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) return {}
  const safe: Record<string, unknown> = {}
  for (const key of SAFE_ARG_KEYS) {
    if (!(key in args)) continue
    const sanitized = sanitizeValue(args[key])
    if (sanitized !== undefined) safe[key] = sanitized
  }
  return safe
}

export function hashActionArgs(args: unknown): string {
  let text: string
  try {
    text = JSON.stringify(args ?? {})
  } catch {
    text = '{}'
  }
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function numberedPath(path: string, index: number): string {
  const ext = extname(path)
  return join(dirname(path), `${basename(path, ext)}.${index}${ext}`)
}

export interface AuditWriterOptions {
  dir: string
  maxBytes?: number
  keep?: number
  retentionDays?: number
  now?: () => Date
}

export interface ActionAuditWriter {
  write: (event: Omit<ActionAuditEvent, 'at'> & { at?: string }) => boolean
  path: string
}

export function createActionAuditWriter(options: AuditWriterOptions): ActionAuditWriter {
  const maxBytes = options.maxBytes ?? AUDIT_MAX_BYTES
  const keep = options.keep ?? AUDIT_KEEP
  const retentionMs = (options.retentionDays ?? AUDIT_RETENTION_DAYS) * 24 * 60 * 60 * 1000
  const now = options.now ?? (() => new Date())
  const filePath = join(options.dir, 'actions.jsonl')
  let lastPruneAt = 0

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
      // best-effort: a escrita seguinte recria o arquivo
    }
  }

  function prune(): void {
    const instant = now().getTime()
    if (instant - lastPruneAt < PRUNE_INTERVAL_MS) return
    lastPruneAt = instant
    let text: string
    try {
      text = readFileSync(filePath, 'utf8')
    } catch {
      return
    }
    const cutoff = instant - retentionMs
    const kept: string[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as { at?: unknown }
        if (typeof parsed.at === 'string' && Date.parse(parsed.at) >= cutoff) kept.push(line)
      } catch {
        // linha corrompida é descartada
      }
    }
    try {
      writeFileSync(filePath, kept.length > 0 ? `${kept.join('\n')}\n` : '', 'utf8')
    } catch {
      // best-effort
    }
  }

  function write(event: Omit<ActionAuditEvent, 'at'> & { at?: string }): boolean {
    try {
      const at = event.at ?? now().toISOString()
      mkdirSync(options.dir, { recursive: true })
      rotate()
      prune()
      const line: ActionAuditEvent = {
        at,
        tool: String(event.tool ?? '').slice(0, 100),
        category: String(event.category ?? '').slice(0, 100),
        argsHash: String(event.argsHash ?? '').slice(0, 32),
        safeArgs: sanitizeSafeArgs(event.safeArgs),
        decision: String(event.decision ?? '').slice(0, 40),
        ok: event.ok === true,
        durationMs: Number.isFinite(event.durationMs) ? Math.max(0, event.durationMs) : 0
      }
      appendFileSync(filePath, `${JSON.stringify(line)}\n`, 'utf8')
      return true
    } catch {
      return false
    }
  }

  return { write, path: filePath }
}

/** Limites de taxa (task 08, T10): 5 apps/min, 10 ops/pedido, 1 UIA/2 s. */
export interface ActionLimiter {
  checkAppLaunch: () => boolean
  checkFileOps: (count: number) => boolean
  checkUia: () => boolean
  snapshot: () => { appLaunchesLastMinute: number }
}

export function createActionLimiter(options: { now?: () => number } = {}): ActionLimiter {
  const now = options.now ?? (() => Date.now())
  const launches: number[] = []
  let lastUiaAt: number | null = null

  return {
    checkAppLaunch: () => {
      const instant = now()
      while (launches.length > 0 && instant - (launches[0] as number) >= 60_000) {
        launches.shift()
      }
      if (launches.length >= ACTION_LIMITS.appLaunchesPerMinute) return false
      launches.push(instant)
      return true
    },
    checkFileOps: (count) =>
      Number.isInteger(count) && count > 0 && count <= ACTION_LIMITS.fileOpsPerRequest,
    checkUia: () => {
      const instant = now()
      if (
        lastUiaAt !== null &&
        instant - lastUiaAt < ACTION_LIMITS.uiaActionsPerTwoSeconds * 2_000
      ) {
        return false
      }
      lastUiaAt = instant
      return true
    },
    snapshot: () => ({ appLaunchesLastMinute: launches.length })
  }
}

/** Store mínimo da pausa/permissões (testável sem Electron). */
export interface PermissionStoreLike {
  read: () => PermissionsState
  write: (next: PermissionsState) => { success: boolean; error?: string }
}

export function readPermissionState(store: PermissionStoreLike): PermissionsState {
  return store.read()
}

export function setPaused(
  store: PermissionStoreLike,
  paused: boolean
): { ok: boolean; error?: string } {
  let current: PermissionsState
  try {
    current = store.read()
  } catch {
    return { ok: false, error: 'Não foi possível ler as permissões.' }
  }
  const result = store.write({ ...current, paused })
  if (!result.success) return { ok: false, error: result.error ?? 'Falha ao salvar a pausa.' }
  return { ok: true }
}

/** Gate consultado pelo roteador: pausa global vira `deny` para tudo. */
export function createActionPermissionGate(
  store: PermissionStoreLike
): (category: string) => PermissionDecision {
  return (category) => {
    try {
      return effectivePermission(store.read(), category)
    } catch {
      return 'deny'
    }
  }
}
