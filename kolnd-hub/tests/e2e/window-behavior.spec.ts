import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Comportamento de fechamento da janela (task x-para-bandeja).
 *
 *   X da title bar e close do SO (Alt+F4/BrowserWindow.close) → OCULTA para a
 *   bandeja, sem diálogo e sem encerrar; o app continua vivo.
 *   Sair explícito (Mais → Encerrar Hub → "Sim, encerrar") → encerra de fato.
 *
 * Electron REAL (build de produção em `out/`), com `userData` isolado e stubs
 * no PATH — mesmo padrão do smoke (tests/e2e/smoke.spec.ts). O teardown usa
 * `electronApp.close()` (que dispara `before-quit` → `isQuitting()`), então
 * também prova que o close interceptado não trava a saída.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

async function launchApp(): Promise<ElectronApplication> {
  const ctx = loadContext()
  return electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
      PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
    }
  })
}

/** Estado da janela principal lido no processo main (não do DOM). */
async function windowState(
  electronApp: ElectronApplication
): Promise<{ count: number; visible: boolean; destroyed: boolean }> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows()
    const first = windows[0]
    return {
      count: windows.length,
      visible: first ? first.isVisible() : false,
      destroyed: first ? first.isDestroyed() : true
    }
  })
}

/** Abre o app e espera o Dashboard renderizar (janela visível). */
async function openHub(): Promise<{ electronApp: ElectronApplication; window: Page }> {
  const electronApp = await launchApp()
  const window = await electronApp.firstWindow()
  await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
    timeout: 45_000
  })
  return { electronApp, window }
}

/** Fecha o app pelo caminho do Playwright sem mascarar um teardown travado. */
async function closeApp(electronApp: ElectronApplication): Promise<void> {
  await electronApp.close().catch(() => {
    try {
      electronApp.process().kill()
    } catch {
      // processo já encerrado
    }
  })
}

test('X da title bar oculta para a bandeja e show() restaura', async () => {
  const { electronApp, window } = await openHub()

  try {
    expect(await windowState(electronApp)).toMatchObject({ count: 1, visible: true })

    // 1) Clique no X customizado (title bar) → janela oculta, sem diálogo.
    await window.locator('.title-bar').getByRole('button', { name: 'Fechar' }).click()
    await expect.poll(async () => (await windowState(electronApp)).visible).toBe(false)
    expect(await windowState(electronApp)).toMatchObject({ count: 1, destroyed: false })
    await expect(window.getByRole('dialog')).toHaveCount(0)

    // 2) App continua vivo (o processo main responde) e show() restaura.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.show()
    })
    await expect.poll(async () => (await windowState(electronApp)).visible).toBe(true)
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible()
  } finally {
    // Teardown a partir de janela visível: electronApp.close() não pode travar.
    await closeApp(electronApp)
  }
})

test('close do SO (BrowserWindow.close) oculta e não destrói a janela', async () => {
  const { electronApp } = await openHub()

  try {
    expect(await windowState(electronApp)).toMatchObject({ count: 1, visible: true })

    // Equivalente a Alt+F4 / close do SO: o handler intercepta e oculta.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    })
    await expect.poll(async () => (await windowState(electronApp)).visible).toBe(false)
    expect(await windowState(electronApp)).toMatchObject({ count: 1, destroyed: false })

    // Processo main ainda responde — não encerrou.
    expect(await electronApp.evaluate(({ app }) => app.isReady())).toBe(true)
  } finally {
    // Teardown a partir de janela OCULTA: prova que o close não trava a saída.
    await closeApp(electronApp)
  }
})

test('Mais → Encerrar Hub → "Sim, encerrar" encerra o app de verdade', async () => {
  const { electronApp, window } = await openHub()
  let exited = false

  try {
    const closed = new Promise<void>((resolve) => electronApp.once('close', () => resolve()))

    // Mega menu → Encerrar Hub → modal de confirmação.
    await window.getByRole('button', { name: 'Mais' }).click()
    await window
      .locator('#topbar-mais-menu')
      .getByRole('button', { name: /Encerrar Hub/ })
      .click()

    const dialog = window.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Encerrar Kolnd Hub?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Sim, encerrar' }).click()

    // O app precisa encerrar de fato (não pode só ocultar na bandeja).
    await Promise.race([
      closed.then(() => {
        exited = true
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('o app não encerrou após "Sim, encerrar"')), 30_000)
      )
    ])
    // `close` do ElectronApplication só dispara quando o processo realmente sai.
    expect(exited).toBe(true)
  } finally {
    if (!exited) await closeApp(electronApp)
  }
})
