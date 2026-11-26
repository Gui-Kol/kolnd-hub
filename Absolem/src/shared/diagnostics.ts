import type { GeminiDiagnostics, GeminiErrorSummary } from './gemini'
import type { DiagnosticsExportResult } from './ipc'

/**
 * Relatório de diagnóstico (task 11, T8): funções puras compartilhadas entre o
 * main (export via diálogo nativo) e o renderer (tela). Nada aqui toca Electron,
 * disco, rede ou segredo; o JSON é redigido por construção.
 */

export interface DiagnosticErrorEntry extends GeminiErrorSummary {
  at: number
}

export const MAX_DIAGNOSTIC_ERRORS = 5

/** Mantém no máximo 5 erros, na ordem em que chegaram. */
export function limitDiagnosticErrors(
  errors: readonly DiagnosticErrorEntry[],
  limit = MAX_DIAGNOSTIC_ERRORS
): DiagnosticErrorEntry[] {
  return errors.slice(-limit).map((entry) => ({
    kind: entry.kind,
    message: entry.message.slice(0, 300),
    at: entry.at
  }))
}

export interface DiagnosticsReport {
  generatedAt: string
  app: { name: string; version: string; platform: string }
  runtime: { electron: string; chromium: string; node: string }
  models: { text: string; live: string }
  gemini: GeminiDiagnostics
  overlay: { fps: number | null }
  microphone: { state: string; consentGranted: boolean }
  memory: { total: number; approxBytes: number } | null
  recentErrors: DiagnosticErrorEntry[]
}

export interface DiagnosticsReportInput {
  app: { name: string; version: string; platform: string }
  runtime: { electron: string; chromium: string; node: string }
  liveModel: string
  gemini: GeminiDiagnostics
  fps: number | null
  microphone: { state: string; consentGranted: boolean }
  memory: { total: number; approxBytes: number } | null
  errors: readonly DiagnosticErrorEntry[]
  now?: Date
}

/**
 * Monta o JSON exportado. Por construção não há chave, transcrição nem
 * caminho pessoal: apenas nomes, versões, contadores e erros classificados.
 */
export function buildDiagnosticsReport(input: DiagnosticsReportInput): DiagnosticsReport {
  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    app: {
      name: input.app.name,
      version: input.app.version,
      platform: input.app.platform
    },
    runtime: {
      electron: input.runtime.electron,
      chromium: input.runtime.chromium,
      node: input.runtime.node
    },
    models: {
      text: input.gemini.model,
      live: input.liveModel
    },
    gemini: input.gemini,
    overlay: { fps: input.fps },
    microphone: input.microphone,
    memory: input.memory,
    recentErrors: limitDiagnosticErrors(input.errors)
  }
}

export interface DiagnosticsExportDeps {
  showSaveDialog: (options: {
    title: string
    defaultPath: string
    filters: Array<{ name: string; extensions: string[] }>
  }) => Promise<{ canceled: boolean; filePath?: string }>
  writeFile: (path: string, data: string) => Promise<void>
}

export const DIAGNOSTICS_FILE_NAME = 'absolem-diagnostico.json'

/** Grava o relatório; cancelar não é erro. */
export async function exportDiagnosticsReport(
  report: DiagnosticsReport,
  deps: DiagnosticsExportDeps
): Promise<DiagnosticsExportResult> {
  let selection: { canceled: boolean; filePath?: string }
  try {
    selection = await deps.showSaveDialog({
      title: 'Exportar diagnóstico do Absolem',
      defaultPath: DIAGNOSTICS_FILE_NAME,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
  } catch (err) {
    return { ok: false, error: `Falha ao abrir o diálogo: ${errorMessage(err)}` }
  }
  if (selection.canceled || !selection.filePath) return { ok: true, canceled: true }
  try {
    await deps.writeFile(selection.filePath, `${JSON.stringify(report, null, 2)}\n`)
  } catch (err) {
    return { ok: false, error: `Falha ao gravar o diagnóstico: ${errorMessage(err)}` }
  }
  return { ok: true, canceled: false, filePath: selection.filePath }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
