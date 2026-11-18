/**
 * Barrel fino da desinstalação + `registerUninstallIpc`.
 *
 * Este arquivo NÃO implementa lógica de domínio: apenas reexporta a superfície
 * pública histórica (importada por `src/main/index.ts`, `src/main/ipc/*` e
 * testes) a partir dos módulos de `./uninstall/*` e de `./uninstallDetection`,
 * e registra os canais IPC do fluxo de desinstalação (T5).
 *
 * Os blocos de reexport abaixo estão agrupados por domínio de origem; não
 * ampliar a superfície sem necessidade (nada de `export *`).
 */
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { cpSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import {
  detectKloudGames,
  findHubUninstaller,
  type KloudGamesDetection
} from './uninstallDetection'
import { getKloudGamesUninstallLogPath } from './kloudGames'
import {
  isAnyUninstallInProgress,
  isHubUninstallInProgress,
  lockMainWindowForUninstall,
  setUninstallWindowGetter,
  unlockMainWindowForUninstall,
  type UninstallLogLine,
  type UninstallProgress,
  type UninstallReport
} from './uninstall/shared'
import { isHubUninstallComplete, isKloudSubstepEvent } from './uninstall/hub'
import { removeKloudGamesService, uninstaller } from './uninstall/kloud'

// ── uninstall/shared ───────────────────────────────────────────────────
export {
  attachLaudo,
  lockMainWindowForUninstall,
  unlockMainWindowForUninstall
} from './uninstall/shared'
export type { UninstallLogLine, UninstallProgress, UninstallReport } from './uninstall/shared'
export type { HubWipeItemError, HubWipeResult } from './uninstall/shared'
export { isHubUninstallInProgress, isAnyUninstallInProgress } from './uninstall/shared'

// ── uninstall/hub ──────────────────────────────────────────────────────
export {
  HUB_UNINSTALL_STEPS,
  isKloudSubstepEvent,
  normalizeHubUninstallArgs,
  wipeKolndHubUserData,
  spawnHubUninstaller,
  runHubUninstallSteps,
  isHubUninstallComplete
} from './uninstall/hub'
export type { HubUninstallArgs, HubUninstallResult, HubUninstallComplete } from './uninstall/hub'

// ── uninstall/kloud ────────────────────────────────────────────────────
export {
  KLOUD_PROCESS_NAME,
  KLOUD_TEMP_DIR_NAME,
  POWERSHELL_BLOCKED_MESSAGE,
  KLOUD_KILL_FAILED_MESSAGE,
  looksLikePowerShellBlocked,
  isProgramFilesKloudGamesDir,
  deleteKloudGamesOrphanFolder,
  Uninstaller,
  uninstaller,
  uninstallKloudGames,
  uninstallKloudGamesOrphanFiles,
  removeKloudGamesService
} from './uninstall/kloud'

// ── uninstallDetection (tabela pura de códigos do msiexec, T1) ─────────
/** Reexporta a tabela pura de códigos do msiexec (T1) para uso/testes da T2/T6. */
export { mapMsiexecExitCode } from './uninstallDetection'
export type { MsiexecExitCodeResult } from './uninstallDetection'

/**
 * Registra os canais IPC de desinstalação do Kloud Games e do Kolnd Hub (T5).
 * O canal `uninstall:hub` em si é registrado em `ipc/uninstall.ts`
 * (`registerUninstallHubIpc`, junto a `shutdownHub`); aqui ficam os ouvintes
 * que reenviam os eventos.
 */
export function registerUninstallIpc(getWindow: () => BrowserWindow | null): void {
  // Guardada para os helpers de trava de janela (lock/unlockMainWindowForUninstall).
  setUninstallWindowGetter(getWindow)

  // Reencaminha eventos do Uninstaller para o renderer.
  // Durante o fluxo do Hub (T5), os eventos crus do subfluxo do Kloud Games
  // (check/kill/msiexec/… e o laudo final) são ignorados: o Hub reemite seus
  // próprios eventos de progresso/complete com os steps do Hub.
  uninstaller.on('progress', (data: UninstallProgress) => {
    if (isHubUninstallInProgress() && isKloudSubstepEvent(data.stepId)) return
    getWindow()?.webContents.send('uninstall:progress', data)
  })

  uninstaller.on('log', (line: UninstallLogLine) => {
    getWindow()?.webContents.send('uninstall:log', line)
  })

  uninstaller.on('complete', (result: UninstallReport) => {
    if (isHubUninstallInProgress() && !isHubUninstallComplete(result)) return
    getWindow()?.webContents.send('uninstall:complete', result)
  })

  // ── Status do Kloud Games (síncrono) ───────────────────────────────
  ipcMain.handle('uninstall:kloud-status', () => {
    try {
      const detection: KloudGamesDetection = detectKloudGames()
      return { ok: true, detection }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // ── Inicia a desinstalação do Kloud Games (retorna imediatamente) ────
  ipcMain.handle('uninstall:kloud-games', async () => {
    if (isAnyUninstallInProgress()) {
      return {
        success: false,
        error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
      }
    }

    // Trava a janela durante os passos destrutivos (reinstaurada na saída do fluxo).
    lockMainWindowForUninstall()
    void uninstaller
      .uninstall(() => {
        // Reencaminhado via this.emit → listener acima (fonte única de eventos).
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        getWindow()?.webContents.send('uninstall:log', `[uninstall] Erro inesperado: ${message}\n`)
        getWindow()?.webContents.send('uninstall:complete', { success: false, error: message })
      })
      .finally(() => {
        unlockMainWindowForUninstall()
      })

    return { success: true }
  })

  // ── Remoção manual parcial (órfãos: exe sem registro e sem serviço) ───
  ipcMain.handle('uninstall:kloud-orphan', async () => {
    if (isAnyUninstallInProgress()) {
      return {
        success: false,
        error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
      }
    }

    lockMainWindowForUninstall()
    void uninstaller
      .uninstallOrphan(() => {
        // Reencaminhado via this.emit → listener acima.
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        getWindow()?.webContents.send('uninstall:log', `[uninstall] Erro inesperado: ${message}\n`)
        getWindow()?.webContents.send('uninstall:complete', {
          success: false,
          error: message,
          orphanManual: true
        })
      })
      .finally(() => {
        unlockMainWindowForUninstall()
      })

    return { success: true }
  })

  // ── Remover o serviço KLOUD_GAMESsvc (órfão de serviço; elevado) ─────
  ipcMain.handle('uninstall:remove-kloud-service', async () => {
    if (isAnyUninstallInProgress()) {
      return {
        success: false,
        error: 'Desinstalação já em andamento. Aguarde o término e tente de novo.'
      }
    }

    lockMainWindowForUninstall()
    try {
      return await removeKloudGamesService()
    } finally {
      unlockMainWindowForUninstall()
    }
  })

  // ── Disponibilidade do desinstalador do Kolnd Hub (T1) ───────────────
  ipcMain.handle('uninstall:hub-status', () => {
    const detection = findHubUninstaller()
    return {
      available: detection.available,
      uninstallerPath: detection.uninstallerPath,
      isPackaged: app.isPackaged
    }
  })

  // ── Backup opcional de %APPDATA%\kolnd-hub ───────────────────────────
  ipcMain.handle('uninstall:backup-data', () => {
    try {
      const source = join(app.getPath('appData'), 'kolnd-hub')
      if (!existsSync(source)) {
        return {
          success: false,
          error: 'A pasta %APPDATA%\\kolnd-hub não existe — nada para fazer backup.'
        }
      }

      const documents = app.getPath('documents')
      const now = new Date()
      const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-') // AAAAMMDD-HHmmss
      const baseName = `KolndHub-Backup-${stamp}`

      // Nunca sobrescreve um backup existente: adiciona -2, -3, …
      let target = join(documents, baseName)
      let suffix = 2
      while (existsSync(target)) {
        target = join(documents, `${baseName}-${suffix}`)
        suffix += 1
      }

      mkdirSync(documents, { recursive: true })
      cpSync(source, target, { recursive: true })

      return { success: true, path: target }
    } catch (err) {
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'Não foi possível fazer o backup dos dados do Hub.'
      }
    }
  })

  // ── Abre a pasta de logs do Kolnd Hub ────────────────────────────────
  ipcMain.handle('uninstall:open-logs', () => {
    const logDir = dirname(getKloudGamesUninstallLogPath())
    void shell.openPath(logDir)
  })
}
