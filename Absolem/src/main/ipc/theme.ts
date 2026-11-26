import { dialog, ipcMain } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'
import { IPC } from '../../shared/ipc'
import type {
  IpcError,
  SimpleResult,
  ThemeExportResult,
  ThemeGetResult,
  ThemeImportResult,
  ThemeSetRequest
} from '../../shared/ipc'
import { normalizeTheme, type ThemeConfig } from '../../shared/theme'
import { setStoreValue } from '../store'
import { createThemeIO } from '../theme-io'
import type { ThemeIODialog, ThemeIOFs } from '../theme-io'
import type { IpcContext } from './lifecycle'

/**
 * Canais de tema.
 *
 * `theme:set` normaliza o `unknown`, persiste (quando `persist` não é `false`)
 * e empurra `theme:changed` ao overlay. O push também acontece no caminho
 * `persist:false` usado pelo debounce da UI: a prévia do overlay é imediata e a
 * gravação em disco fica no throttle de 300 ms do renderer.
 *
 * O import usa a mesma persistência; um arquivo inválido nunca chama o
 * `applyTheme` e o tema vigente permanece intacto.
 */

function failure(error: string): IpcError {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function currentTheme(ctx: IpcContext): ThemeConfig {
  return normalizeTheme(ctx.getStoreSnapshot().theme)
}

/** Push main -> overlay; janela ausente ou fechando não é erro. */
export function pushTheme(ctx: IpcContext, theme: ThemeConfig): void {
  const window = ctx.getOverlayWindow()
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send(IPC.themeChanged, theme)
  } catch {
    // Janela fechando entre a checagem e o envio: o mount relê com theme:get.
  }
}

function persistAndPush(ctx: IpcContext, theme: ThemeConfig): { success: boolean; error?: string } {
  const result = setStoreValue('theme', theme)
  if (result.success) pushTheme(ctx, theme)
  return result
}

/**
 * Caminho único de `theme:set` (handler e smoke). Devolve erro legível em
 * payload inválido, sem lançar.
 */
export function setThemeFromRequest(ctx: IpcContext, input: unknown): SimpleResult {
  if (!isRecord(input) || !isRecord(input.theme)) {
    return failure(`Payload inválido para ${IPC.themeSet}: ${describe(input)}`)
  }
  if (input.persist !== undefined && typeof input.persist !== 'boolean') {
    return failure(`Campo persist inválido para ${IPC.themeSet}: ${describe(input.persist)}`)
  }

  const request = input as unknown as ThemeSetRequest
  try {
    const theme = normalizeTheme({ ...currentTheme(ctx), ...request.theme })
    if (request.persist !== false) {
      const result = persistAndPush(ctx, theme)
      return result.success ? { ok: true } : failure(result.error ?? 'Falha ao salvar o tema.')
    }
    pushTheme(ctx, theme)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return failure(`Falha ao aplicar o tema: ${message}`)
  }
}

function createFsAdapter(): ThemeIOFs {
  return {
    stat: (path) => stat(path),
    readFile: (path, encoding) => readFile(path, encoding),
    writeFile: (path, data, encoding) => writeFile(path, data, encoding)
  }
}

function createDialogAdapter(ctx: IpcContext): ThemeIODialog {
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
    }
  }
}

export function registerThemeIpc(ctx: IpcContext): void {
  ipcMain.handle(IPC.themeGet, (): ThemeGetResult => {
    return { ok: true, theme: currentTheme(ctx) }
  })

  ipcMain.handle(IPC.themeSet, (_event, payload: unknown): SimpleResult => {
    return setThemeFromRequest(ctx, payload)
  })

  ipcMain.handle(IPC.themeExport, async (_event, payload: unknown): Promise<ThemeExportResult> => {
    if (payload !== undefined && payload !== null) {
      return failure(`Payload inválido para ${IPC.themeExport}: ${describe(payload)}`)
    }
    const io = createThemeIO({
      fs: createFsAdapter(),
      dialog: createDialogAdapter(ctx),
      getTheme: () => currentTheme(ctx)
    })
    return io.exportTheme()
  })

  ipcMain.handle(IPC.themeImport, async (_event, payload: unknown): Promise<ThemeImportResult> => {
    if (payload !== undefined && payload !== null) {
      return failure(`Payload inválido para ${IPC.themeImport}: ${describe(payload)}`)
    }
    const io = createThemeIO({
      fs: createFsAdapter(),
      dialog: createDialogAdapter(ctx),
      getTheme: () => currentTheme(ctx),
      applyTheme: (theme) => persistAndPush(ctx, theme)
    })
    return io.importTheme()
  })
}
