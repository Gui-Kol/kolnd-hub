import { test, expect, _electron as electron } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'
import type { GamepadConfig } from '../../src/shared/gamepad'

/**
 * Big Picture pelo botão PS/Guide (índice 16) com gate de foco.
 *
 * Electron REAL de `out/` com userData ISOLADO PRÓPRIO (`mkdtemp`). O gamepad
 * é INJETADO no renderer — nenhum hardware é necessário:
 * - `navigator.getGamepads()` devolve um pad sintético com 17 botões;
 * - `document.hasFocus()` vira um booleano controlado pelo teste (o foco real
 *   da janela não é determinístico sob o Playwright).
 *
 * Cobre:
 * (a) sem foco, o botão 16 NÃO abre o Big Picture;
 * (b) com foco, o botão 0 (A) NÃO abre (só o Guide é atalho);
 * (c) com foco, o botão 16 abre (transição + home do Big Picture).
 *
 * A biblioteca é semeada VAZIA (`games: []`): a home mostra o estado vazio em
 * vez do listbox de jogos — o marco de "modo aberto" é o rail ("Sair do Big
 * Picture"), que só monta após a transição.
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

/** Config de gamepad válida (shape canônico de src/shared/gamepad.ts). */
function seededGamepad(): GamepadConfig {
  return {
    profile: 'xbox',
    controllerId: 'e2e-controller',
    controllerName: 'Controle E2E',
    mapping: {
      confirm: 0,
      back: 1,
      up: 12,
      down: 13,
      left: 14,
      right: 15,
      menu: 9,
      options: 8,
      tab_prev: 4,
      tab_next: 5,
      stick_left: 10,
      stick_right: 11
    },
    autoMapped: true,
    configuredAt: '2026-01-01T00:00:00.000Z'
  }
}

/**
 * Env do Electron: userData isolado + stubs no PATH.
 * `ELECTRON_RENDERER_URL` é removido para o E2E usar o build de `out/`.
 */
function launchEnv(userDataDir: string, stubsDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KOLDND_HUB_TEST_USERDATA: userDataDir,
    PATH: `${stubsDir}${delimiter}${process.env.PATH ?? ''}`
  }
  delete env.ELECTRON_RENDERER_URL
  return env
}

/** Instala o pad sintético e o foco controlável no renderer. */
async function installFakeGamepad(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface E2eWindow {
      __e2eSetFocus: (focused: boolean) => void
      __e2eSetButton: (index: number, pressed: boolean) => void
    }
    const w = window as unknown as E2eWindow
    let focused = false
    const pad = {
      id: 'e2e-controller',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    }

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad]
    })
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => focused
    })
    w.__e2eSetFocus = (value: boolean): void => {
      focused = value
    }
    w.__e2eSetButton = (index: number, pressed: boolean): void => {
      pad.buttons[index] = { pressed, value: pressed ? 1 : 0 }
    }
  })
}

async function setFocus(page: Page, focused: boolean): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __e2eSetFocus: (focused: boolean) => void }).__e2eSetFocus(value)
  }, focused)
}

async function setButton(page: Page, index: number, pressed: boolean): Promise<void> {
  await page.evaluate(
    ({ index: buttonIndex, pressed: isPressed }) => {
      ;(
        window as unknown as { __e2eSetButton: (index: number, pressed: boolean) => void }
      ).__e2eSetButton(buttonIndex, isPressed)
    },
    { index, pressed }
  )
}

test('big picture: botão PS/Guide abre só com o Hub em foco', async () => {
  const ctx = loadContext()
  const userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-hub-bp-ps-e2e-'))
  writeFileSync(join(userDataDir, 'first-run-complete.flag'), '1', 'utf8')
  // Config semeada: sem jogos e com controle válido (entrada vai direto para a
  // transição, não para o gate de setup). `projectVersion` = versão do app.
  writeFileSync(
    join(userDataDir, 'config.json'),
    JSON.stringify({ projectVersion: '1.4.0', games: [], gamepad: seededGamepad() }, null, 2),
    'utf8'
  )

  const electronApp = await electron.launch({
    args: ['.'],
    env: launchEnv(userDataDir, ctx.stubsDir)
  })

  try {
    const window = await electronApp.firstWindow()

    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })

    await installFakeGamepad(window)
    // `games: []` → a home do Big Picture mostra o estado vazio (não há listbox
    // de jogos). O rail só fica visível na home pronta, depois da transição —
    // é o marco estável de "modo aberto".
    const rail = window.getByRole('navigation', { name: 'Navegação do Big Picture' })
    const dashboardHeading = window.getByRole('heading', { name: 'Ferramentas' })

    // (a) Sem foco: apertar o PS/Guide não abre nada.
    await setFocus(window, false)
    await setButton(window, 16, true)
    await window.waitForTimeout(1200)
    await expect(rail).toHaveCount(0)
    await expect(dashboardHeading).toBeVisible()
    await setButton(window, 16, false)

    // (b) Com foco: o botão A (0) não é atalho — não abre.
    await setFocus(window, true)
    // Tick de prime do detector com todos os botões soltos.
    await window.waitForTimeout(300)
    await setButton(window, 0, true)
    await window.waitForTimeout(1200)
    await expect(rail).toHaveCount(0)
    await expect(dashboardHeading).toBeVisible()
    await setButton(window, 0, false)

    // (c) Com foco: o PS/Guide abre (transição ~2,9 s) e a home libera o rail.
    await window.waitForTimeout(300)
    await setButton(window, 16, true)
    await expect(rail).toBeVisible({ timeout: 30_000 })
    await expect(window.getByText('Sua biblioteca está vazia')).toBeVisible()
  } finally {
    await electronApp.close().catch(() => {
      try {
        electronApp.process().kill()
      } catch {
        // processo já encerrado
      }
    })
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // arquivo ainda preso (log/crashpad) — o SO limpa o tmp depois
    }
  }
})
