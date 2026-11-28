/**
 * Tipos e limites da memória de longo prazo (task 09).
 *
 * O renderer conhece estas formas para montar a tela e o contrato IPC; a
 * persistência e as regras de escrita vivem no main (`src/main/memory`).
 */

export const MEMORY_KINDS = ['fact', 'preference', 'profile', 'temporary'] as const

export type MemoryKind = (typeof MEMORY_KINDS)[number]

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  fact: 'Fato',
  preference: 'Preferência',
  profile: 'Perfil',
  temporary: 'Temporária'
}

/** Conteúdo máximo de uma memória (caracteres). */
export const MEMORY_CONTENT_MAX = 400
/** Memória em texto livre (Configurações → Memória), sempre enviada ao prompt. */
export const MEMORY_NOTE_MAX = 16_000
export const MEMORY_TAGS_MAX = 8
export const MEMORY_TAG_MAX = 30
/** Confiança mínima para a extração automática gravar um candidato. */
export const MEMORY_MIN_CONFIDENCE = 0.6
export const MEMORY_DEFAULT_CONFIDENCE = 0.8
/** Memórias temporárias expiram em 7 dias por padrão. */
export const MEMORY_TEMPORARY_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Orçamento do bloco de memória no prompt de sistema. */
export const MEMORY_PROMPT_BUDGET = 1200
export const MEMORY_PROMPT_MAX_ITEMS = 8
/** Meia-vida do decaimento de recência. */
export const MEMORY_RECENCY_HALF_LIFE_DAYS = 30
/** Abaixo disto a memória vai para o arquivo (nunca é apagada). */
export const MEMORY_ARCHIVE_CONFIDENCE = 0.2
export const MEMORY_DECAY_AFTER_DAYS = 90
export const MEMORY_ACTIVE_LIMIT = 5000
/** Extração no máximo a cada 6 turnos e no fim da sessão. */
export const MEMORY_EXTRACTION_TURN_INTERVAL = 6
/** Texto literal exigido por `memory:remove-all`. */
export const MEMORY_REMOVE_ALL_CONFIRM = 'APAGAR TUDO'

export const MEMORY_APP_ID = 'absolem'
export const MEMORY_FILE_KIND = 'memory'
export const MEMORY_EXPORT_VERSION = 1
export const MEMORY_EXPORT_MAX_BYTES = 16 * 1024 * 1024

export type MemorySort = 'date' | 'usage' | 'confidence'

export interface MemoryRecord {
  id: string
  kind: MemoryKind
  content: string
  tags: string[]
  confidence: number
  source: string
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  useCount: number
  expiresAt: number | null
  pinned: boolean
}

export interface MemoryArchiveRecord extends MemoryRecord {
  archivedAt: number
  reason: string
}

export interface MemoryTurn {
  id: number
  sessionId: string
  role: 'user' | 'model'
  content: string
  at: number
  interrupted: boolean
}

export interface MemorySession {
  id: string
  startedAt: number
  endedAt: number | null
  summary: string | null
}

export interface MemoryMaintenanceEntry {
  at: number
  op: string
  detail: string
}

export interface MemoryStats {
  total: number
  byKind: Record<MemoryKind, number>
  /** Epoch ms da memória mais antiga/mais nova; null com banco vazio. */
  oldest: number | null
  newest: number | null
  pinned: number
  approxBytes: number
  lastExtractionAt: number | null
  lastConsolidationAt: number | null
  maintenance: MemoryMaintenanceEntry[]
}

export interface MemoryListQuery {
  query?: string
  kind?: MemoryKind
  sort?: MemorySort
  offset?: number
  limit?: number
}

export interface MemoryListPage {
  memories: MemoryRecord[]
  total: number
}

/** Memória exportada: mesmos campos, sem estado interno do app. */
export interface MemoryExportItem {
  id: string
  kind: MemoryKind
  content: string
  tags: string[]
  confidence: number
  source: string
  createdAt: number
  updatedAt: number
  lastUsedAt: number | null
  useCount: number
  expiresAt: number | null
  pinned: boolean
}

export interface MemoryExportSession extends MemorySession {
  turns: Array<{
    role: 'user' | 'model'
    content: string
    at: number
    interrupted: boolean
  }>
}

/** Arquivo `{ app:'absolem', kind:'memory', ... }` do export. */
export interface MemoryExportFile {
  app: typeof MEMORY_APP_ID
  kind: typeof MEMORY_FILE_KIND
  version: number
  exportedAt: string
  memories: MemoryExportItem[]
  /** Só existe quando o usuário marcou incluir transcrições. */
  sessions?: MemoryExportSession[]
}

export function emptyMemoryStats(): MemoryStats {
  return {
    total: 0,
    byKind: { fact: 0, preference: 0, profile: 0, temporary: 0 },
    oldest: null,
    newest: null,
    pinned: 0,
    approxBytes: 0,
    lastExtractionAt: null,
    lastConsolidationAt: null,
    maintenance: []
  }
}
