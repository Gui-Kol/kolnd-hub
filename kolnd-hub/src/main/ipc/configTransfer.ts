import { app, dialog, ipcMain } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  applyImport,
  buildExport,
  summarizeImport,
  validateImport,
  type NormalizedImportData
} from '../configTransfer'
import { isStoreAvailable } from '../store'
import { logger } from '../logger'
import type { IpcContext } from './lifecycle'

/**
 * Backup/restauração da configuração do Hub (07-7.6).
 *
 * DOIS passos em UM canal (`config:import` com `{ mode }`):
 *  - `preview`: abre o diálogo, lê e valida o arquivo e guarda o resultado
 *    validado em memória deste processo (`pendingImport`, TTL 5 min). Nada
 *    é aplicado. O renderer mostra a confirmação com a contagem do arquivo.
 *  - `apply`: aplica o `pendingImport` (sem segundo diálogo, sem confiar em
 *    paths vindos do renderer). Sem prévia válida → erro amigável.
 *
 * Antes de aplicar, o estado ATUAL é copiado para
 * `userData/backups/config-backup-<ISO>.json` — se o backup falhar, nada é
 * aplicado (fail-closed).
 */

const PENDING_TTL_MS = 5 * 60 * 1000

let pendingImport: { data: NormalizedImportData; expiresAt: number } | null = null

export type ImportPreviewResult =
  | {
      ok: true
      summary: { apps: number; games: number; sections: string[] }
      rejected: Array<{ section: string; error: string }>
    }
  | { ok: false; canceled: true }
  | { ok: false; errors: string[] }

export type ImportApplyResult =
  | {
      success: true
      applied: string[]
      failed: Array<{ section: string; error: string }>
      backupPath: string
    }
  | { success: false; error: string }

function defaultExportName(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `kolnd-hub-config-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`
}

/** ISO sem `:`/`.` — inválidos em nomes de arquivo no Windows. */
function backupFileName(now: Date): string {
  return `config-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

export function registerConfigTransferIpc(ctx: IpcContext): void {
  // ── Exportar configuração ──────────────────────────────────────
  // Diálogo "salvar como" (default kolnd-hub-config-AAAAMMDD.json) e
  // grava o JSON formatado. Cancelar → { success: false, canceled: true }.
  ipcMain.handle(
    'config:export',
    async (): Promise<{
      success: boolean
      path?: string
      canceled?: boolean
      error?: string
    }> => {
      try {
        const options: Electron.SaveDialogOptions = {
          title: 'Exportar configuração do Kolnd Hub',
          defaultPath: defaultExportName(),
          filters: [{ name: 'JSON', extensions: ['json'] }]
        }
        const win = ctx.getMainWindow()
        const { canceled, filePath } = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (canceled || !filePath) return { success: false, canceled: true }
        writeFileSync(filePath, JSON.stringify(buildExport(), null, 2), 'utf8')
        logger.info('configTransfer', 'Configuração exportada para arquivo JSON')
        return { success: true, path: filePath }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('configTransfer', 'Falha ao exportar configuração:', message)
        return { success: false, error: message }
      }
    }
  )

  // ── Importar configuração (preview → apply) ────────────────────
  ipcMain.handle('config:import', async (_event, payload: unknown) => {
    const mode =
      payload && typeof payload === 'object' ? (payload as { mode?: unknown }).mode : undefined

    if (mode === 'preview') {
      return previewImport(ctx)
    }
    if (mode === 'apply') {
      return applyPendingImport()
    }
    return { success: false, error: 'Modo de importação inválido.' }
  })
}

/** Passo 1: diálogo + leitura + validação. Nada é aplicado. */
async function previewImport(ctx: IpcContext): Promise<ImportPreviewResult> {
  try {
    const options: Electron.OpenDialogOptions = {
      title: 'Importar configuração do Kolnd Hub',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const win = ctx.getMainWindow()
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) {
      return { ok: false, canceled: true }
    }

    let rawText: string
    try {
      rawText = readFileSync(filePaths[0], 'utf8')
    } catch (err) {
      logger.error('configTransfer', 'Falha ao ler o arquivo de importação:', err)
      return { ok: false, errors: ['Não foi possível ler o arquivo selecionado.'] }
    }

    let raw: unknown
    try {
      raw = JSON.parse(rawText)
    } catch {
      return { ok: false, errors: ['O arquivo não contém um JSON válido.'] }
    }

    const validation = validateImport(raw)
    if (!validation.ok) {
      pendingImport = null
      return { ok: false, errors: validation.errors }
    }

    // Guarda o resultado validado para o `apply` (sem segundo diálogo e
    // sem aceitar paths do renderer). Prévia anterior é substituída.
    pendingImport = { data: validation.data, expiresAt: Date.now() + PENDING_TTL_MS }
    const summary = summarizeImport(validation.data)
    logger.info(
      'configTransfer',
      `Prévia de importação: ${summary.apps} app(s), ${summary.games} jogo(s), ` +
        `${validation.rejected.length} seção(ões) recusada(s)`
    )
    return { ok: true, summary, rejected: validation.rejected }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('configTransfer', 'Falha na prévia da importação:', message)
    return { ok: false, errors: [message] }
  }
}

/** Passo 2: backup do estado atual + aplicação por seção. */
function applyPendingImport(): ImportApplyResult {
  if (!pendingImport) {
    return {
      success: false,
      error: 'Nenhuma importação pendente — pré-visualize primeiro.'
    }
  }
  if (Date.now() > pendingImport.expiresAt) {
    pendingImport = null
    return { success: false, error: 'A prévia expirou — pré-visualize o arquivo novamente.' }
  }
  // Store indisponível (modo fallback localStorage): nada muda.
  if (!isStoreAvailable()) {
    return { success: false, error: 'Store persistente indisponível' }
  }

  const { data } = pendingImport

  // Backup do estado ATUAL antes de substituir qualquer seção.
  // Se o backup falhar, a importação é abortada — nada é aplicado.
  const backupsDir = join(app.getPath('userData'), 'backups')
  const backupPath = join(backupsDir, backupFileName(new Date()))
  try {
    mkdirSync(backupsDir, { recursive: true })
    writeFileSync(backupPath, JSON.stringify(buildExport(), null, 2), 'utf8')
  } catch (err) {
    logger.error('configTransfer', 'Backup pré-import falhou — importação abortada:', err)
    return {
      success: false,
      error: 'Não foi possível criar o backup automático. A importação não foi aplicada.'
    }
  }
  logger.info('configTransfer', 'Backup pré-import criado em backups/')

  const report = applyImport(data)
  pendingImport = null
  return { success: true, applied: report.applied, failed: report.failed, backupPath }
}
