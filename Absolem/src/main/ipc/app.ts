import { app, ipcMain, shell } from 'electron'
import { join } from 'path'
import { isSettingsTab } from '../../shared/config'
import { IPC, APP_FOLDER_TARGETS } from '../../shared/ipc'
import { resolveHubVersion } from '../../shared/version'
import type {
  AppFolderTarget,
  AppInfoResult,
  AutostartGetResult,
  IpcError,
  SettingsSection,
  SimpleResult
} from '../../shared/ipc'
import { getAutostart, setAutostart } from '../autostart'
import { showMainWindow } from '../lifecycle'
import { shutdownApp } from './lifecycle'
import type { IpcContext } from './lifecycle'

/** Payload de canal sem argumentos: só `undefined`/`null` são aceitos. */
function isVoidPayload(value: unknown): boolean {
  return value === undefined || value === null
}

function failure(error: string): IpcError {
  return { ok: false, error }
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Canais base do app. Todo handler recebe `unknown` e valida antes de usar:
 * payload inválido vira `{ ok: false, error }` sem lançar.
 */
export function registerAppIpc(ctx: IpcContext): void {
  let relaunchRequested = false

  ipcMain.handle(IPC.appGetInfo, (_event, payload: unknown): AppInfoResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.appGetInfo}: ${describe(payload)}`)
    }
    try {
      return {
        ok: true,
        info: {
          name: app.getName(),
          // Versão do produto = versão da Hub, injetada no launch (task 32).
          version: resolveHubVersion(process.env, app.getVersion()),
          platform: process.platform,
          electron: process.versions.electron ?? '',
          chromium: process.versions.chrome ?? '',
          node: process.versions.node ?? ''
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao ler informações do app: ${message}`)
    }
  })

  ipcMain.handle(IPC.appQuit, (_event, payload: unknown): SimpleResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.appQuit}: ${describe(payload)}`)
    }
    try {
      shutdownApp(ctx)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao encerrar o app: ${message}`)
    }
  })

  ipcMain.handle(IPC.appRelaunch, (_event, payload: unknown): SimpleResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.appRelaunch}: ${describe(payload)}`)
    }
    if (relaunchRequested) return { ok: true }
    try {
      // O Electron relança o mesmo executável com os mesmos argumentos. O
      // encerramento ordenado vem depois, sem shell nem processo externo.
      app.relaunch()
      relaunchRequested = true
      shutdownApp(ctx, 'relaunch')
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return failure(`Falha ao reiniciar o Absolem: ${message}`)
    }
  })

  ipcMain.handle(IPC.appGetAutostart, (_event, payload: unknown): AutostartGetResult => {
    if (!isVoidPayload(payload)) {
      return failure(`Payload inválido para ${IPC.appGetAutostart}: ${describe(payload)}`)
    }
    return { ok: true, state: getAutostart() }
  })

  ipcMain.handle(IPC.appSetAutostart, (_event, payload: unknown): SimpleResult => {
    const enabled =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)['enabled']
        : undefined
    const result = setAutostart(enabled)
    return result.success
      ? { ok: true }
      : failure(result.error ?? 'Falha ao atualizar a inicialização com o Windows.')
  })

  ipcMain.handle(IPC.settingsOpen, (_event, payload: unknown): SimpleResult => {
    const section =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)['section']
        : undefined
    if (section !== undefined && !isSettingsTab(section)) {
      return failure('Aba de configuração desconhecida.')
    }
    try {
      showMainWindow(section as SettingsSection | undefined)
      return { ok: true }
    } catch (err) {
      return failure(
        `Falha ao abrir as configurações: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })

  ipcMain.handle(IPC.appOpenFolder, async (_event, payload: unknown): Promise<SimpleResult> => {
    const target =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)['target']
        : undefined
    if (typeof target !== 'string' || !(APP_FOLDER_TARGETS as readonly string[]).includes(target)) {
      return failure('Pasta inválida para abrir.')
    }
    try {
      const path = folderPath(target as AppFolderTarget)
      const error = await shell.openPath(path)
      return error ? failure(`Não foi possível abrir a pasta: ${error}`) : { ok: true }
    } catch (err) {
      return failure(
        `Não foi possível abrir a pasta: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  })
}

/** Enum fechado: nunca aceita caminho livre vindo do renderer. */
function folderPath(target: AppFolderTarget): string {
  if (target === 'logs') return app.getPath('logs')
  if (target === 'audit') return join(app.getPath('userData'), 'audit')
  return app.getPath('userData')
}
