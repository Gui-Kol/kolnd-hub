import { dialog, ipcMain } from 'electron'
import { writeFileSync } from 'fs'
import { logger } from '../logger'
import {
  appendUsageEvent,
  buildUsageEvent,
  clearUsageFiles,
  readUsageEvents,
  summarizeUsage,
  usageToCsv,
  USAGE_READ_MAX_LIMIT
} from '../usageLog'
import {
  USAGE_EVENT_TYPES,
  USAGE_PAGES,
  type ClearUsageResult,
  type UsageEventType,
  type UsageExportResult,
  type UsagePage,
  type UsageReadOptions,
  type UsageReadResult,
  type UsageSummaryResult
} from '../../shared/usage'
import type { IpcContext } from './lifecycle'

/**
 * IPC do registro de uso local (task logs-uso-detalhados).
 *
 * Tudo recebe `unknown` e é validado aqui: o renderer pode estar comprometido.
 * Nenhum caminho de arquivo vem do renderer — `usage:export` escolhe o destino
 * pelo diálogo nativo do main e `usage:clear` só apaga `usage-*.jsonl`.
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function isUsageEventType(value: unknown): value is UsageEventType {
  return typeof value === 'string' && USAGE_EVENT_TYPES.includes(value as UsageEventType)
}

function isUsagePage(value: unknown): value is UsagePage {
  return typeof value === 'string' && USAGE_PAGES.includes(value as UsagePage)
}

/** Whitelist dos filtros aceitos; qualquer campo inválido é descartado. */
function safeReadOptions(payload: unknown): UsageReadOptions {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const raw = payload as Record<string, unknown>
  const options: UsageReadOptions = {}
  if (typeof raw.from === 'string' && DATE_KEY_RE.test(raw.from)) options.from = raw.from
  if (typeof raw.to === 'string' && DATE_KEY_RE.test(raw.to)) options.to = raw.to
  if (isUsageEventType(raw.type)) options.type = raw.type
  if (isUsagePage(raw.page)) options.page = raw.page
  if (typeof raw.limit === 'number' && Number.isFinite(raw.limit)) options.limit = raw.limit
  return options
}

/** Nome sugerido do arquivo exportado (`kolnd-hub-uso-AAAAMMDD.json|csv`). */
function defaultExportName(format: 'json' | 'csv'): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `kolnd-hub-uso-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.${format}`
}

export function registerUsageIpc(ctx: IpcContext): void {
  // ── Ler eventos (com filtros validados) ────────────────────────
  ipcMain.handle('usage:read', (_event, payload: unknown): UsageReadResult => {
    try {
      return { ok: true, events: readUsageEvents(safeReadOptions(payload)) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('usage', 'Falha ao ler o registro de uso:', message)
      return { ok: false, events: [], error: message }
    }
  })

  // ── Resumo agregado (respeita os mesmos filtros) ───────────────
  ipcMain.handle('usage:summary', (_event, payload: unknown): UsageSummaryResult => {
    try {
      const events = readUsageEvents(safeReadOptions(payload))
      return { ok: true, summary: summarizeUsage(events) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('usage', 'Falha ao resumir o registro de uso:', message)
      return {
        ok: false,
        summary: {
          totalSessions: 0,
          totalSeconds: 0,
          byDay: [],
          topApps: [],
          topGames: [],
          pageViews: {
            dashboard: 0,
            settings: 0,
            inicializacao: 0,
            biblioteca: 0,
            chat: 0
          }
        },
        error: message
      }
    }
  })

  // ── Exportar JSON/CSV (diálogo "salvar como" no main) ──────────
  ipcMain.handle('usage:export', async (_event, payload: unknown): Promise<UsageExportResult> => {
    const format =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).format
        : undefined
    if (format !== 'json' && format !== 'csv') {
      return { success: false, error: 'Formato de exportação inválido.' }
    }
    try {
      const events = readUsageEvents({ limit: USAGE_READ_MAX_LIMIT })
      const options: Electron.SaveDialogOptions = {
        title: 'Exportar registro de uso do Kolnd Hub',
        defaultPath: defaultExportName(format),
        filters: [
          format === 'json'
            ? { name: 'JSON', extensions: ['json'] }
            : { name: 'CSV', extensions: ['csv'] }
        ]
      }
      const win = ctx.getMainWindow()
      const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return { success: false, canceled: true }

      const content =
        format === 'json' ? `${JSON.stringify(events, null, 2)}\n` : usageToCsv(events)
      writeFileSync(filePath, content, 'utf8')
      logger.info('usage', `Registro de uso exportado em ${format.toUpperCase()}`)
      return { success: true, path: filePath }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('usage', 'Falha ao exportar o registro de uso:', message)
      return { success: false, error: message }
    }
  })

  // ── Limpar histórico (só usage-*.jsonl) ────────────────────────
  ipcMain.handle('usage:clear', (): ClearUsageResult => {
    const result = clearUsageFiles()
    if (result.success) {
      logger.info('usage', `Registro de uso apagado (${result.removed} arquivo(s))`)
    } else {
      logger.error('usage', 'Falha ao limpar o registro de uso:', result.error)
    }
    return result
  })

  // ── Page view (whitelist de páginas do Hub) ────────────────────
  ipcMain.handle(
    'usage:page-view',
    (_event, page: unknown): { success: boolean; error?: string } => {
      if (!isUsagePage(page)) {
        return { success: false, error: 'Página inválida.' }
      }
      appendUsageEvent(buildUsageEvent('page-view', { page }))
      return { success: true }
    }
  )
}
