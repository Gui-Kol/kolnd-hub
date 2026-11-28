/// <reference lib="dom" />
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { AbsolemApi } from '../../src/shared/ipc'

declare global {
  interface Window {
    absolem: AbsolemApi
  }
}

export const APP_ROOT = resolve(__dirname, '../..')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userData: string
}

export interface LaunchOptions {
  /** Atraso determinístico da resposta fake, usado só nos testes de cancelamento. */
  fakeDelayMs?: number
}

export interface NativeDialogStub {
  savePath?: string
  openPath?: string
  /** Resposta de `showMessageBox`; 0 costuma ser o botão de confirmação. */
  confirmResponse?: number
}

/**
 * Abre o app buildado com userData temporário e transporte fake. O teste nunca
 * herda chave, perfil ou rede autenticada; a pasta é removida no `finally`.
 */
export async function launchApp(prefix: string, options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userData = mkdtempSync(join(tmpdir(), `absolem-e2e-${prefix}-`))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  env.ABSOLEM_TEST_USERDATA = userData
  env.ABSOLEM_TEST_TRANSPORT = 'fake'
  if (options.fakeDelayMs !== undefined) {
    env.ABSOLEM_TEST_FAKE_DELAY_MS = String(options.fakeDelayMs)
  }

  const app = await electron.launch({ args: [APP_ROOT], cwd: APP_ROOT, env })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return { app, page, userData }
  } catch (error) {
    await app.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    throw error
  }
}

/** Encerra o app e remove o perfil temporário, mesmo quando o teste falhou. */
export async function closeApp(launched: LaunchedApp): Promise<void> {
  await launched.app.close().catch(() => undefined)
  rmSync(launched.userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

export async function withApp(
  prefix: string,
  run: (launched: LaunchedApp) => Promise<void>,
  options: LaunchOptions = {}
): Promise<void> {
  const launched = await launchApp(prefix, options)
  try {
    await run(launched)
  } finally {
    await closeApp(launched)
  }
}

/** Mostra o overlay pelo mesmo canal da bandeja e devolve a janela `#overlay`. */
export async function showOverlay(app: ElectronApplication, page: Page): Promise<Page> {
  const windowPromise = app.waitForEvent('window')
  await page.evaluate(() => window.absolem.overlayShow())
  const overlay = await windowPromise
  await overlay.waitForLoadState('domcontentloaded')
  return overlay
}

export interface WindowSnapshot {
  hash: string
  visible: boolean
}

export function windowSnapshots(app: ElectronApplication): Promise<WindowSnapshot[]> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => {
      const url = window.webContents.getURL()
      return {
        hash: url.includes('#') ? url.slice(url.indexOf('#')) : '',
        visible: window.isVisible()
      }
    })
  )
}

/**
 * Substitui só os diálogos nativos do processo de teste. Permite exercitar
 * export/import e confirmações pelo IPC real sem abrir janela nem tocar no SO.
 */
export async function stubNativeDialogs(
  app: ElectronApplication,
  stub: NativeDialogStub
): Promise<void> {
  await app.evaluate(({ dialog }, options) => {
    const target = dialog as unknown as {
      showSaveDialog: () => Promise<{ canceled: boolean; filePath?: string }>
      showOpenDialog: () => Promise<{ canceled: boolean; filePaths?: string[] }>
      showMessageBox: () => Promise<{ response: number }>
    }
    target.showSaveDialog = async () =>
      options.savePath ? { canceled: false, filePath: options.savePath } : { canceled: true }
    target.showOpenDialog = async () =>
      options.openPath ? { canceled: false, filePaths: [options.openPath] } : { canceled: true }
    target.showMessageBox = async () => ({ response: options.confirmResponse ?? 0 })
  }, stub)
}
