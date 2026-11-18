import { clipboard, ipcMain } from 'electron'
import { buildDiagnosticReport } from '../diagnostic'
import { logger } from '../logger'
import type { IpcContext } from './lifecycle'

export function registerDiagnosticIpc(_ctx: IpcContext): void {
  // ── Diagnóstico (task 06-6.3) ──────────────────
  // Sem argumentos. Monta um relatório sanitizado (versões, contagens do
  // store e últimas linhas dos logs — nunca comandos/cwd/URLs/nomes de
  // jogos) e copia para a área de transferência. O renderer recebe apenas
  // { success, error? }.
  ipcMain.handle('diagnostic:export', () => {
    try {
      const report = buildDiagnosticReport()
      clipboard.writeText(report)
      logger.info('diagnostic', 'Diagnóstico copiado para a área de transferência')
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('diagnostic', 'Falha ao exportar diagnóstico:', err)
      return { success: false, error: message }
    }
  })
}
