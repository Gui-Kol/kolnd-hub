import { dialog, ipcMain } from 'electron'
import { writeFile } from 'fs'
import { IPC } from '../../shared/ipc'
import type {
  DiagnosticsExportResult,
  DiagnosticsGeminiResult,
  DiagnosticsOverlayResult,
  IpcError
} from '../../shared/ipc'
import {
  buildDiagnosticsReport,
  exportDiagnosticsReport,
  limitDiagnosticErrors,
  type DiagnosticErrorEntry,
  type DiagnosticsExportDeps
} from '../../shared/diagnostics'
import type { GeminiDiagnostics, GeminiErrorSummary, GeminiStatusInfo } from '../../shared/gemini'
import { GEMINI_SDK_PACKAGE, GEMINI_SDK_VERSION } from '../gemini/sdk'

/**
 * Diagnóstico do motor Gemini e do app (tasks 05/11).
 *
 * Metadados apenas: versão do SDK, modelo, promptVersion, último erro
 * classificado, tokens do dia/mês, teto e se a chave está configurada. A chave
 * nunca entra no payload (nem o texto de prompts/respostas). O export grava um
 * JSON redigido via diálogo nativo; nada é enviado automaticamente.
 */

export interface DiagnosticsSource {
  status: () => GeminiStatusInfo
  getPromptVersion: () => string
}

export const MAX_DIAGNOSTIC_ERRORS = 5

const recentErrors: DiagnosticErrorEntry[] = []

/** Guarda os últimos erros classificados; nunca recebe texto de prompt. */
export function recordDiagnosticError(error: GeminiErrorSummary, at = Date.now()): void {
  if (!error || typeof error.kind !== 'string' || typeof error.message !== 'string') return
  recentErrors.push({ kind: error.kind, message: error.message.slice(0, 300), at })
  if (recentErrors.length > MAX_DIAGNOSTIC_ERRORS) recentErrors.shift()
}

export function getRecentDiagnosticErrors(): DiagnosticErrorEntry[] {
  return recentErrors.map((entry) => ({ ...entry }))
}

export function resetDiagnosticErrorsForTests(): void {
  recentErrors.length = 0
}

export function buildGeminiDiagnostics(
  engine: DiagnosticsSource,
  sdk: { packageName: string; version: string } = {
    packageName: GEMINI_SDK_PACKAGE,
    version: GEMINI_SDK_VERSION
  },
  errors: readonly DiagnosticErrorEntry[] = getRecentDiagnosticErrors()
): GeminiDiagnostics {
  const status = engine.status()
  const limited = limitDiagnosticErrors(errors)
  return {
    sdkPackage: sdk.packageName,
    sdkVersion: sdk.version,
    model: status.model,
    promptVersion: engine.getPromptVersion(),
    configured: status.configured,
    lastError: status.lastError,
    usage: status.usage,
    ...(limited.length > 0 ? { recentErrors: limited } : {})
  }
}

function failure(error: string): IpcError {
  return { ok: false, error }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface DiagnosticsIpcOptions {
  getAppInfo?: () => { name: string; version: string; platform: string }
  getRuntimeVersions?: () => { electron: string; chromium: string; node: string }
  getLiveModel?: () => string
  getOverlayFps?: () => Promise<number | null>
  getMicrophone?: () => { state: string; consentGranted: boolean }
  getMemory?: () => { total: number; approxBytes: number } | null
  exportDeps?: DiagnosticsExportDeps
  now?: () => Date
}

export function registerDiagnosticsIpc(
  engine: DiagnosticsSource,
  options: DiagnosticsIpcOptions = {}
): void {
  ipcMain.handle(IPC.diagnosticsGemini, (_event, payload: unknown): DiagnosticsGeminiResult => {
    if (payload !== undefined && payload !== null) {
      return failure(`Payload inválido para ${IPC.diagnosticsGemini}.`)
    }
    try {
      return { ok: true, diagnostics: buildGeminiDiagnostics(engine) }
    } catch (err) {
      return failure(`Falha ao montar o diagnóstico do Gemini: ${errorMessage(err)}`)
    }
  })

  ipcMain.handle(IPC.diagnosticsOverlay, async (): Promise<DiagnosticsOverlayResult> => {
    try {
      const fps = options.getOverlayFps ? await options.getOverlayFps() : null
      return { ok: true, fps: typeof fps === 'number' && Number.isFinite(fps) ? fps : null }
    } catch (err) {
      return failure(`Falha ao ler a métrica do overlay: ${errorMessage(err)}`)
    }
  })

  ipcMain.handle(IPC.diagnosticsExport, async (): Promise<DiagnosticsExportResult> => {
    try {
      const appInfo = options.getAppInfo?.() ?? {
        name: 'Absolem',
        version: '0.0.0',
        platform: process.platform
      }
      const runtime = options.getRuntimeVersions?.() ?? {
        electron: process.versions.electron ?? '',
        chromium: process.versions.chrome ?? '',
        node: process.versions.node ?? ''
      }
      const report = buildDiagnosticsReport({
        app: appInfo,
        runtime,
        liveModel: options.getLiveModel?.() ?? '',
        gemini: buildGeminiDiagnostics(engine),
        fps: options.getOverlayFps ? await options.getOverlayFps() : null,
        microphone: options.getMicrophone?.() ?? { state: 'off', consentGranted: false },
        memory: options.getMemory?.() ?? null,
        errors: getRecentDiagnosticErrors(),
        ...(options.now ? { now: options.now() } : {})
      })
      return await exportDiagnosticsReport(report, options.exportDeps ?? defaultExportDeps())
    } catch (err) {
      return failure(`Falha ao exportar o diagnóstico: ${errorMessage(err)}`)
    }
  })
}

function defaultExportDeps(): DiagnosticsExportDeps {
  return {
    showSaveDialog: (dialogOptions) =>
      dialog.showSaveDialog(dialogOptions) as Promise<{
        canceled: boolean
        filePath?: string
      }>,
    writeFile: (path, data) =>
      new Promise((resolve, reject) => {
        writeFile(path, data, 'utf8', (err) => (err ? reject(err) : resolve()))
      })
  }
}
