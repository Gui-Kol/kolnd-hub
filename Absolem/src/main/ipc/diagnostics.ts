import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { DiagnosticsGeminiResult, IpcError } from '../../shared/ipc'
import type { GeminiDiagnostics, GeminiStatusInfo } from '../../shared/gemini'
import { GEMINI_SDK_PACKAGE, GEMINI_SDK_VERSION } from '../gemini/sdk'

/**
 * Diagnóstico do motor Gemini (`diagnostics:gemini`).
 *
 * Metadados apenas: versão do SDK, modelo, promptVersion, último erro
 * classificado, tokens do dia/mês, teto e se a chave está configurada. A chave
 * nunca entra no payload (nem o texto de prompts/respostas).
 */

export interface DiagnosticsSource {
  status: () => GeminiStatusInfo
  getPromptVersion: () => string
}

export function buildGeminiDiagnostics(
  engine: DiagnosticsSource,
  sdk: { packageName: string; version: string } = {
    packageName: GEMINI_SDK_PACKAGE,
    version: GEMINI_SDK_VERSION
  }
): GeminiDiagnostics {
  const status = engine.status()
  return {
    sdkPackage: sdk.packageName,
    sdkVersion: sdk.version,
    model: status.model,
    promptVersion: engine.getPromptVersion(),
    configured: status.configured,
    lastError: status.lastError,
    usage: status.usage
  }
}

function failure(error: string): IpcError {
  return { ok: false, error }
}

export function registerDiagnosticsIpc(engine: DiagnosticsSource): void {
  ipcMain.handle(IPC.diagnosticsGemini, (_event, payload: unknown): DiagnosticsGeminiResult => {
    if (payload !== undefined && payload !== null) {
      return failure(`Payload inválido para ${IPC.diagnosticsGemini}.`)
    }
    try {
      return { ok: true, diagnostics: buildGeminiDiagnostics(engine) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao montar o diagnóstico do Gemini: ${message}`)
    }
  })
}
