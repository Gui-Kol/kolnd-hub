import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Smoke E2E (task 04-4.1): o caminho mínimo do Hub ponta a ponta.
 *
 *   app abre → Dashboard renderiza → clique no 1º card abre o modal → Esc fecha
 *
 * Roda o Electron REAL (build de produção em `out/`), com `userData` isolado
 * (flag de first-run semeada no global setup — nada é lido/gravado em
 * %APPDATA%\kolnd-hub) e winget/msiexec stubados no PATH (compilados para PE
 * pelo global setup; qualquer invocação cai em `stubs.log`, que este teste
 * exige VAZIO/inexistente ao final).
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

test('smoke: app abre, dashboard renderiza, card abre modal e Esc fecha', async () => {
  const ctx = loadContext()

  const electronApp = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
      PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
    }
  })

  try {
    const window = await electronApp.firstWindow()

    // 1) App abre + Dashboard renderiza (estado inicial do Hub fora de first-run).
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })

    // 2) Cards dos apps default visíveis; guarda o nome do 1º card para o modal.
    const firstCard = window.locator('[data-testid="app-card"]').first()
    await expect(firstCard).toBeVisible()
    const cardName = (await firstCard.locator('h3').innerText()).trim()
    expect(cardName.length).toBeGreaterThan(0)

    // 3) Clique no nome do app dentro do 1º card → modal de detalhe abre.
    await firstCard.locator('h3').click()
    const modal = window.locator('[data-testid="app-detail-modal"]')
    await expect(modal).toBeVisible()
    await expect(modal.locator('h3').first()).toHaveText(cardName)

    // 4) Esc fecha o modal.
    await window.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)

    // 5) winget/msiexec NÃO foram invocados no caminho do smoke.
    if (existsSync(ctx.stubsLog)) {
      const log = readFileSync(ctx.stubsLog, 'utf8').trim()
      expect(log).toBe('')
    }
  } finally {
    await electronApp.close().catch(() => {
      try {
        electronApp.process().kill()
      } catch {
        // processo já encerrado
      }
    })
  }
})
