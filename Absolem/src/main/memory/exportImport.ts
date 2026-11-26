import {
  MEMORY_APP_ID,
  MEMORY_CONTENT_MAX,
  MEMORY_DEFAULT_CONFIDENCE,
  MEMORY_EXPORT_MAX_BYTES,
  MEMORY_EXPORT_VERSION,
  MEMORY_FILE_KIND,
  isMemoryKind,
  type MemoryExportFile,
  type MemoryExportItem,
  type MemoryExportSession,
  type MemoryKind,
  type MemoryRecord,
  type MemorySession,
  type MemoryTurn
} from '../../shared/memory'
import type { MemoryExportResult, MemoryImportResult } from '../../shared/ipc'
import { rebuildMemoryIndex, type MemoryRepository } from './repository'
import { normalizeForCompare } from './similarity'

/**
 * Exportação e importação em JSON (task 09/T8).
 *
 * `fs` e `dialog` são injetados (mesmo padrão de `theme-io.ts`), então os
 * caminhos de sucesso, cancelamento e arquivo inválido são testáveis em Node.
 *
 * Export: `{ app:'absolem', kind:'memory', version, exportedAt, memories,
 * sessions? }`; transcrições só entram quando o usuário marca a opção.
 * Import: valida versão/cada linha, mostra prévia e só aplica após confirmação;
 * deduplica por conteúdo e NUNCA sobrescreve memória existente por `id`.
 */

export interface MemoryIOFs {
  stat: (path: string) => Promise<{ size: number }>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, data: string, encoding: 'utf8') => Promise<void>
}

export interface MemoryFileFilter {
  name: string
  extensions: string[]
}

export interface MemorySaveDialogOptions {
  title: string
  defaultPath: string
  filters: MemoryFileFilter[]
}

export interface MemoryOpenDialogOptions {
  title: string
  properties: Array<'openFile'>
  filters: MemoryFileFilter[]
}

export interface MemoryConfirmOptions {
  type: 'question'
  buttons: string[]
  defaultId: number
  cancelId: number
  title: string
  message: string
  detail: string
}

export interface MemoryIODialog {
  showSaveDialog: (
    options: MemorySaveDialogOptions
  ) => Promise<{ canceled: boolean; filePath?: string }>
  showOpenDialog: (
    options: MemoryOpenDialogOptions
  ) => Promise<{ canceled: boolean; filePaths?: string[] }>
  showMessageBox: (options: MemoryConfirmOptions) => Promise<{ response: number }>
}

export interface MemoryIOOptions {
  fs: MemoryIOFs
  dialog: MemoryIODialog
  repo: MemoryRepository
  now?: () => Date
}

export interface MemoryImportPreview {
  wouldImport: number
  duplicates: number
  invalid: number
  sessions: number
  turns: number
}

export interface MemoryIO {
  buildExportFile: (includeTranscripts: boolean) => MemoryExportFile
  exportFile: (includeTranscripts: boolean) => Promise<MemoryExportResult>
  importFile: () => Promise<MemoryImportResult>
}

const FILE_FILTERS: MemoryFileFilter[] = [
  { name: 'Memória do Absolem (JSON)', extensions: ['json'] }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null
}

function toExportItem(memory: MemoryRecord): MemoryExportItem {
  return {
    id: memory.id,
    kind: memory.kind,
    content: memory.content,
    tags: [...memory.tags],
    confidence: memory.confidence,
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    lastUsedAt: memory.lastUsedAt,
    useCount: memory.useCount,
    expiresAt: memory.expiresAt,
    pinned: memory.pinned
  }
}

function toExportTurns(turns: MemoryTurn[]): MemoryExportSession['turns'] {
  return turns.map((turn) => ({
    role: turn.role,
    content: turn.content,
    at: turn.at,
    interrupted: turn.interrupted
  }))
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const tag = item.trim().slice(0, 30)
    if (!tag) continue
    const key = tag.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= 8) break
  }
  return tags
}

/** Valida uma linha importada; null = inválida (entra na contagem da prévia). */
function validateImportItem(raw: unknown, now: number): MemoryExportItem | null {
  if (!isRecord(raw)) return null
  if (!isMemoryKind(raw.kind)) return null
  if (typeof raw.content !== 'string') return null
  const content = raw.content.trim()
  if (!content || content.length > MEMORY_CONTENT_MAX) return null
  const confidence = finiteNumber(raw.confidence, MEMORY_DEFAULT_CONFIDENCE)
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 100) : '',
    kind: raw.kind,
    content,
    tags: cleanTags(raw.tags),
    confidence: Math.min(1, Math.max(0, confidence)),
    source: typeof raw.source === 'string' ? raw.source.slice(0, 30) : 'import',
    createdAt: Math.max(0, Math.floor(finiteNumber(raw.createdAt, now))),
    updatedAt: Math.max(0, Math.floor(finiteNumber(raw.updatedAt, now))),
    lastUsedAt: optionalNumber(raw.lastUsedAt),
    useCount: Math.max(0, Math.floor(finiteNumber(raw.useCount, 0))),
    expiresAt: optionalNumber(raw.expiresAt),
    pinned: raw.pinned === true
  }
}

interface ImportPlan {
  preview: MemoryImportPreview
  accepted: MemoryExportItem[]
  sessions: MemoryExportSession[]
}

function planImport(file: MemoryExportFile, repo: MemoryRepository, now: number): ImportPlan {
  const existing = new Set(
    repo.list({ limit: 5000 }).memories.map((memory) => normalizeForCompare(memory.content))
  )
  const seen = new Set<string>()
  const accepted: MemoryExportItem[] = []
  const preview: MemoryImportPreview = {
    wouldImport: 0,
    duplicates: 0,
    invalid: 0,
    sessions: 0,
    turns: 0
  }

  const items = Array.isArray(file.memories) ? file.memories : []
  for (const raw of items) {
    const item = validateImportItem(raw, now)
    if (!item) {
      preview.invalid += 1
      continue
    }
    const key = normalizeForCompare(item.content)
    if (existing.has(key) || seen.has(key)) {
      preview.duplicates += 1
      continue
    }
    seen.add(key)
    accepted.push(item)
    preview.wouldImport += 1
  }

  const sessions: MemoryExportSession[] = []
  if (Array.isArray(file.sessions)) {
    const knownSessions = new Set(repo.turns.listSessions().map((session) => session.id))
    for (const raw of file.sessions) {
      if (!isRecord(raw)) continue
      if (typeof raw.id !== 'string' || !raw.id.trim()) continue
      if (knownSessions.has(raw.id)) continue
      const turns = Array.isArray(raw.turns) ? raw.turns : []
      const validTurns = turns.flatMap((turn): MemoryExportSession['turns'] => {
        if (!isRecord(turn)) return []
        if (turn.role !== 'user' && turn.role !== 'model') return []
        if (typeof turn.content !== 'string' || !turn.content.trim()) return []
        return [
          {
            role: turn.role,
            content: turn.content.trim().slice(0, 8000),
            at: Math.max(0, Math.floor(finiteNumber(turn.at, now))),
            interrupted: turn.interrupted === true
          }
        ]
      })
      if (validTurns.length === 0) continue
      const session: MemoryExportSession = {
        id: raw.id,
        startedAt: Math.max(0, Math.floor(finiteNumber(raw.startedAt, now))),
        endedAt: optionalNumber(raw.endedAt),
        summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 2000) : null,
        turns: validTurns
      }
      sessions.push(session)
      knownSessions.add(raw.id)
      preview.sessions += 1
      preview.turns += validTurns.length
    }
  }

  return { preview, accepted, sessions }
}

export function buildMemoryExportFile(
  repo: MemoryRepository,
  includeTranscripts: boolean,
  now: Date = new Date()
): MemoryExportFile {
  const memories = repo.list({ limit: 5000 }).memories.map(toExportItem)
  const file: MemoryExportFile = {
    app: MEMORY_APP_ID,
    kind: MEMORY_FILE_KIND,
    version: MEMORY_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    memories
  }
  if (includeTranscripts) {
    file.sessions = repo.turns
      .listSessions()
      .map((session: MemorySession) => ({
        ...session,
        turns: toExportTurns(repo.turns.list(session.id, 1000))
      }))
      .filter((session) => session.turns.length > 0)
  }
  return file
}

export function createMemoryIO(options: MemoryIOOptions): MemoryIO {
  const { fs, dialog, repo } = options
  const now = options.now ?? (() => new Date())

  function buildExportFile(includeTranscripts: boolean): MemoryExportFile {
    return buildMemoryExportFile(repo, includeTranscripts, now())
  }

  async function exportFile(includeTranscripts: boolean): Promise<MemoryExportResult> {
    try {
      const picked = await dialog.showSaveDialog({
        title: 'Exportar memória do Absolem',
        defaultPath: 'absolem-memoria.json',
        filters: FILE_FILTERS
      })
      if (picked.canceled) return { ok: true, canceled: true }
      if (!picked.filePath) return { ok: false, error: 'Nenhum arquivo de destino foi escolhido.' }

      const file = buildExportFile(includeTranscripts)
      const text = JSON.stringify(file, null, 2)
      await fs.writeFile(picked.filePath, text, 'utf8')
      const bytes = Buffer.byteLength(text, 'utf8')
      return {
        ok: true,
        canceled: false,
        filePath: picked.filePath,
        count: file.memories.length,
        bytes,
        ...(file.sessions ? { sessions: file.sessions.length } : {})
      }
    } catch (error) {
      return { ok: false, error: `Falha ao exportar a memória: ${errorMessage(error)}` }
    }
  }

  async function importFile(): Promise<MemoryImportResult> {
    try {
      const picked = await dialog.showOpenDialog({
        title: 'Importar memória do Absolem',
        properties: ['openFile'],
        filters: FILE_FILTERS
      })
      if (picked.canceled) return { ok: true, canceled: true }
      const filePath = picked.filePaths?.[0]
      if (!filePath) return { ok: false, error: 'Nenhum arquivo de memória foi escolhido.' }

      const info = await fs.stat(filePath)
      if (info.size > MEMORY_EXPORT_MAX_BYTES) {
        return { ok: false, error: 'O arquivo de memória passa de 16 MB e não foi importado.' }
      }
      const text = await fs.readFile(filePath, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MEMORY_EXPORT_MAX_BYTES) {
        return { ok: false, error: 'O arquivo de memória passa de 16 MB e não foi importado.' }
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        return { ok: false, error: 'O arquivo não contém JSON válido.' }
      }
      if (!isRecord(parsed))
        return { ok: false, error: 'O arquivo não contém um objeto de memória.' }
      if (parsed.app !== MEMORY_APP_ID || parsed.kind !== MEMORY_FILE_KIND) {
        return { ok: false, error: 'O arquivo não é uma memória do Absolem.' }
      }
      if (typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) {
        return { ok: false, error: 'O arquivo não informa uma versão válida.' }
      }
      if (parsed.version > MEMORY_EXPORT_VERSION) {
        return {
          ok: false,
          error: `Arquivo de uma versão mais nova (${parsed.version}); este app importa até a ${MEMORY_EXPORT_VERSION}.`
        }
      }
      if (parsed.version < 1) {
        return { ok: false, error: 'Versão de arquivo de memória desconhecida.' }
      }

      const file: MemoryExportFile = {
        app: MEMORY_APP_ID,
        kind: MEMORY_FILE_KIND,
        version: parsed.version,
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
        memories: Array.isArray(parsed.memories) ? (parsed.memories as MemoryExportItem[]) : [],
        ...(Array.isArray(parsed.sessions)
          ? { sessions: parsed.sessions as MemoryExportSession[] }
          : {})
      }
      const nowMs = now().getTime()
      const plan = planImport(file, repo, nowMs)

      if (plan.preview.wouldImport === 0 && plan.preview.sessions === 0) {
        return {
          ok: true,
          canceled: false,
          imported: 0,
          duplicates: plan.preview.duplicates,
          invalid: plan.preview.invalid
        }
      }

      const confirmation = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Importar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        title: 'Importar memória',
        message: `Importar ${plan.preview.wouldImport} memória(s)?`,
        detail:
          `${plan.preview.wouldImport} nova(s), ${plan.preview.duplicates} duplicada(s) ignorada(s), ` +
          `${plan.preview.invalid} inválida(s).` +
          (plan.preview.sessions > 0
            ? ` Também ${plan.preview.sessions} sessão(ões) e ${plan.preview.turns} turno(s).`
            : '') +
          ' Memórias existentes não são sobrescritas.'
      })
      if (confirmation.response !== 0) {
        return {
          ok: true,
          canceled: true,
          duplicates: plan.preview.duplicates,
          invalid: plan.preview.invalid
        }
      }

      let imported = 0
      for (const item of plan.accepted) {
        repo.insert({
          kind: item.kind,
          content: item.content,
          tags: item.tags,
          confidence: item.confidence,
          source: item.source === 'import' ? 'import' : item.source,
          pinned: item.pinned,
          expiresAt: item.expiresAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          lastUsedAt: item.lastUsedAt,
          useCount: item.useCount
        })
        imported += 1
      }
      for (const session of plan.sessions) {
        repo.turns.startSession(session.id, session.startedAt)
        for (const turn of session.turns) {
          repo.turns.insert({
            sessionId: session.id,
            role: turn.role,
            content: turn.content,
            at: turn.at,
            interrupted: turn.interrupted
          })
        }
        repo.turns.endSession(session.id, session.endedAt ?? nowMs, session.summary)
      }

      // Import em massa: índice reconstruído e páginas livres devolvidas ao SO.
      if (imported > 0) rebuildMemoryIndex(repo.handle)
      try {
        repo.handle.exec('VACUUM')
      } catch {
        // VACUUM é best-effort; o import já está gravado
      }

      return {
        ok: true,
        canceled: false,
        imported,
        duplicates: plan.preview.duplicates,
        invalid: plan.preview.invalid
      }
    } catch (error) {
      return { ok: false, error: `Falha ao importar a memória: ${errorMessage(error)}` }
    }
  }

  return { buildExportFile, exportFile, importFile }
}

export type { MemoryKind }
