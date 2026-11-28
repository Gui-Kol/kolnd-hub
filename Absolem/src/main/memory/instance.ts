import { app, dialog } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { MemoryConfig } from '../../shared/config'
import {
  MEMORY_EXTRACTION_TURN_INTERVAL,
  MEMORY_PROMPT_BUDGET,
  emptyMemoryStats,
  type MemoryStats,
  type MemoryTurn
} from '../../shared/memory'
import { logger } from '../logger'
import { getStoreSnapshot, setStoreValue } from '../store'
import { registerShutdownHook } from '../shutdown'
import type { IpcContext } from '../ipc/lifecycle'
import type { MemoryService } from '../ipc/memory'
import { consolidate, ConsolidationCancelled, needsConsolidation } from './consolidate'
import { openMemoryDatabase, type MemoryDatabase } from './db'
import { runExtraction, type ExtractionGenerator } from './extract'
import { createMemoryIO, type MemoryIODialog, type MemoryIOFs } from './exportImport'
import { composeSystemMemory } from './format'
import { createMemoryAuditWriter, removeAllAndVacuum, type MemoryAuditWriter } from './privacy'
import { recall } from './retrieve'
import {
  createMemoryRepository,
  setMeta,
  type MemoryRepository,
  type RemoveAllOptions,
  type RemoveAllResult,
  type TurnInput
} from './repository'
import { getMemoryStats } from './stats'

/**
 * Composição de produção da memória.
 *
 * Só este arquivo liga o banco ao Electron (userData, diálogos), ao store
 * (`memory.enabled`/`autoExtract`) e ao medidor de custo (a extração usa o
 * motor Gemini configurado em `gemini/instance.ts`).
 *
 * Se o banco não abrir (binário nativo ausente, arquivo corrompido), o app
 * continua: o serviço IPC responde erro, a recuperação devolve vazio e a voz
 * segue sem gravar turnos.
 */

export interface MemoryRuntime {
  available: boolean
  service: MemoryService
  getBlock: (query: string) => string
  beginSession: (sessionId: string, at: number) => void
  recordTurn: (turn: TurnInput) => void
  endSession: (sessionId: string, at: number) => void
  /** Últimos turnos de todas as sessões (histórico recente, task 11). */
  recentTurns: (limit?: number) => MemoryTurn[]
  auditConfigChange: (before: MemoryConfig, after: MemoryConfig) => void
  stats: () => MemoryStats
  close: () => void
}

let extractionGenerator: ExtractionGenerator | null = null

/** Chamado por `gemini/instance.ts` quando o motor é criado. */
export function configureMemoryExtraction(generator: ExtractionGenerator | null): void {
  extractionGenerator = generator
}

function createFsAdapter(): MemoryIOFs {
  return {
    stat: (path) => stat(path),
    readFile: (path, encoding) => readFile(path, encoding),
    writeFile: (path, data, encoding) => writeFile(path, data, encoding)
  }
}

function createDialogAdapter(ctx: IpcContext): MemoryIODialog {
  const parent = () => {
    const window = ctx.getMainWindow()
    return window && !window.isDestroyed() ? window : null
  }
  return {
    showSaveDialog: (options) => {
      const window = parent()
      return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
    },
    showOpenDialog: (options) => {
      const window = parent()
      return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
    },
    showMessageBox: (options) => {
      const window = parent()
      return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
    }
  }
}

function unavailable(error: string): MemoryService {
  const fail = (): never => {
    throw new Error(`Memória indisponível: ${error}`)
  }
  return {
    list: fail,
    archived: fail,
    maintenance: fail,
    search: fail,
    create: fail,
    update: fail,
    remove: fail,
    removeAll: fail,
    stats: fail,
    exportFile: async () => ({ ok: false, error: `Memória indisponível: ${error}` }),
    importFile: async () => ({ ok: false, error: `Memória indisponível: ${error}` }),
    recordAudit: () => undefined
  }
}

function buildService(options: {
  repo: MemoryRepository
  audit: MemoryAuditWriter
  ctx: IpcContext
}): MemoryService {
  const { repo, audit, ctx } = options
  const io = createMemoryIO({
    fs: createFsAdapter(),
    dialog: createDialogAdapter(ctx),
    repo
  })
  return {
    list: (query) => repo.list(query),
    archived: (limit) => repo.listArchived(limit),
    maintenance: (limit) => repo.maintenance(limit),
    search: (query, limit) => repo.search(query, { limit }),
    create: (input) => repo.insert(input),
    update: (id, patch) => repo.update(id, patch),
    remove: (id) => repo.remove(id),
    removeAll: (removeOptions?: RemoveAllOptions): RemoveAllResult =>
      removeAllAndVacuum(repo, removeOptions),
    stats: () =>
      getMemoryStats(repo.handle, {
        lastConsolidationAt: getStoreSnapshot().memory.lastConsolidationAt
      }),
    exportFile: (exportOptions) => io.exportFile(exportOptions.includeTranscripts),
    importFile: () => io.importFile(),
    recordAudit: (op, id, kind) => {
      audit.write({ op, id, kind })
    }
  }
}

function createMemoryRuntime(ctx: IpcContext): MemoryRuntime {
  const userData = app.getPath('userData')
  const audit = createMemoryAuditWriter({ dir: join(userData, 'audit') })
  const opened = openMemoryDatabase({
    path: join(userData, 'memory.sqlite'),
    logger
  })

  if (!opened.ok) {
    logger.warn('memory', 'memória desabilitada nesta execução', opened.error)
    return {
      available: false,
      service: unavailable(opened.error),
      getBlock: () => '',
      beginSession: () => undefined,
      recordTurn: () => undefined,
      endSession: () => undefined,
      recentTurns: () => [],
      auditConfigChange: () => undefined,
      stats: () => ({
        ...emptyMemoryStats(),
        lastConsolidationAt: (() => {
          try {
            return getStoreSnapshot().memory.lastConsolidationAt
          } catch {
            return null
          }
        })()
      }),
      close: () => undefined
    }
  }

  const database: MemoryDatabase = opened.database
  const repo = createMemoryRepository(database.handle)
  const service = buildService({ repo, audit, ctx })
  const sessionTurns = new Map<string, number>()
  let extracting = false
  let queuedSession: string | null = null

  function memoryEnabled(): boolean {
    try {
      return getStoreSnapshot().memory.enabled
    } catch {
      return false
    }
  }

  function autoExtractEnabled(): boolean {
    try {
      return getStoreSnapshot().memory.autoExtract
    } catch {
      return false
    }
  }

  async function extractSession(sessionId: string): Promise<void> {
    if (!extractionGenerator || !memoryEnabled() || !autoExtractEnabled()) return
    if (extracting) {
      queuedSession = sessionId
      return
    }
    extracting = true
    try {
      const turns: MemoryTurn[] = repo.turns.list(sessionId, 200)
      const report = await runExtraction({
        repo,
        turns,
        generator: extractionGenerator,
        logger
      })
      if (report.ok && !report.skipped) {
        setMeta(repo.handle, 'last_extraction_at', String(Date.now()))
      }
    } catch (error) {
      logger.warn('memory', 'extração automática falhou', error)
    } finally {
      extracting = false
      const next = queuedSession
      queuedSession = null
      if (next) void extractSession(next)
    }
  }

  function recordTurn(turn: TurnInput): void {
    if (!memoryEnabled()) return
    try {
      repo.turns.insert(turn)
    } catch (error) {
      logger.warn('memory', 'falha ao gravar turno', error)
      return
    }
    if (turn.interrupted) return
    const count = (sessionTurns.get(turn.sessionId) ?? 0) + 1
    sessionTurns.set(turn.sessionId, count)
    if (count % MEMORY_EXTRACTION_TURN_INTERVAL === 0) {
      void extractSession(turn.sessionId)
    }
  }

  function beginSession(sessionId: string, at: number): void {
    if (!memoryEnabled()) return
    try {
      repo.turns.startSession(sessionId, at)
      sessionTurns.set(sessionId, 0)
    } catch (error) {
      logger.warn('memory', 'falha ao abrir sessão de memória', error)
    }
  }

  function endSession(sessionId: string, at: number): void {
    if (!memoryEnabled()) return
    try {
      repo.turns.endSession(sessionId, at)
    } catch (error) {
      logger.warn('memory', 'falha ao encerrar sessão de memória', error)
    }
    sessionTurns.delete(sessionId)
    void extractSession(sessionId)
  }

  function recentTurns(limit = 20): MemoryTurn[] {
    if (!memoryEnabled()) return []
    try {
      return repo.turns.recent(limit)
    } catch (error) {
      logger.warn('memory', 'falha ao ler o histórico recente', error)
      return []
    }
  }

  function getBlock(query: string): string {
    const note = getStoreSnapshot().memory.note
    if (!memoryEnabled()) return composeSystemMemory(note, '')
    try {
      const recalled = recall(repo, query, { budgetChars: MEMORY_PROMPT_BUDGET }).text
      return composeSystemMemory(note, recalled)
    } catch (error) {
      logger.warn('memory', 'falha ao recuperar memórias', error)
      return composeSystemMemory(note, '')
    }
  }

  function auditConfigChange(before: MemoryConfig, after: MemoryConfig): void {
    if (before.enabled === after.enabled) return
    audit.write({ op: after.enabled ? 'resume' : 'pause', id: null, kind: null })
  }

  // Consolidação na abertura, se atrasada. Fica fora do boot (task 06/T2):
  // agenda depois dos canais IPC e cancela no encerramento, para não segurar a
  // primeira janela. Pausada não apaga nada.
  let shuttingDown = false
  let consolidationTimer: ReturnType<typeof setTimeout> | null = null
  const CONSOLIDATION_START_DELAY_MS = 1500

  function runDeferredConsolidation(): void {
    consolidationTimer = null
    if (shuttingDown) return
    try {
      if (!memoryEnabled() || !needsConsolidation(getStoreSnapshot().memory.lastConsolidationAt)) {
        return
      }
      const report = consolidate(repo, {
        shouldCancel: () => shuttingDown,
        persistLastConsolidationAt: (at) => {
          setStoreValue('memory', { ...getStoreSnapshot().memory, lastConsolidationAt: at })
        }
      })
      logger.info('memory', 'consolidação na abertura', {
        expiredRemoved: report.expiredRemoved,
        merged: report.merged,
        decayed: report.decayed,
        archived: report.archived,
        trimmed: report.trimmed
      })
    } catch (error) {
      if (error instanceof ConsolidationCancelled) {
        logger.info('memory', 'consolidação interrompida no encerramento')
        return
      }
      logger.warn('memory', 'consolidação inicial falhou', error)
    }
  }

  consolidationTimer = setTimeout(runDeferredConsolidation, CONSOLIDATION_START_DELAY_MS)
  consolidationTimer.unref?.()

  registerShutdownHook('memory', () => {
    shuttingDown = true
    if (consolidationTimer) {
      clearTimeout(consolidationTimer)
      consolidationTimer = null
    }
    database.close()
  })

  return {
    available: true,
    service,
    getBlock,
    beginSession,
    recordTurn,
    endSession,
    recentTurns,
    auditConfigChange,
    stats: () =>
      getMemoryStats(repo.handle, {
        lastConsolidationAt: getStoreSnapshot().memory.lastConsolidationAt
      }),
    close: () => database.close()
  }
}

/**
 * Placeholder inerte para o caso de banco indisponível: `memory:stats` ainda
 * devolve zeros em vez de derrubar a tela (o serviço real responde erro nos
 * canais de escrita).
 */
let runtime: MemoryRuntime | null = null

export function ensureMemoryRuntime(ctx: IpcContext): MemoryRuntime {
  if (!runtime) runtime = createMemoryRuntime(ctx)
  return runtime
}

export function getMemoryRuntime(): MemoryRuntime | null {
  return runtime
}

/** Bloco de memória para o prompt de sistema (nota sempre, automática se ativa). */
export function getMemoryBlock(query: string): string {
  if (runtime) return runtime.getBlock(query)
  // Banco indisponível: a memória em texto do usuário continua valendo.
  return composeSystemMemory(getStoreSnapshot().memory.note, '')
}

/** Hook de teste/smoke: substitui a instância compartilhada. */
export function setMemoryRuntimeForTests(next: MemoryRuntime | null): void {
  runtime = next
}
