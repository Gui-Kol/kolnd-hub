import { test, expect, _electron as electron } from '@playwright/test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Navegação pelo novo shell "Estação" (task frontend-modelo-03).
 *
 * Cobre o que a sidebar fazia e que agora vive na topbar/mega menu:
 * mega abre e fecha com Esc (devolvendo o foco), as 5 páginas continuam
 * acessíveis, o item ativo tem `aria-current="page"` e `/` abre a busca global.
 *
 * Electron REAL (build de produção em `out/`), com `userData` isolado e
 * stubs no PATH — mesmo padrão do smoke (tests/e2e/smoke.spec.ts).
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

test('navegação: mega menu, 5 páginas e busca por atalho', async () => {
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

    // 1) Shell abre no Dashboard.
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })

    const nav = (label: string) =>
      window.locator('nav[aria-label="Navegação principal"] button', { hasText: label })
    const menu = window.locator('#topbar-mais-menu')
    const mais = window.getByRole('button', { name: 'Mais' })

    // 2) "Mais" abre o mega; Esc fecha e devolve o foco ao botão.
    await mais.click()
    await expect(menu).toBeVisible()
    await expect(mais).toHaveAttribute('aria-expanded', 'true')
    await window.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(mais).toBeFocused()

    // 3) Mega → Biblioteca.
    await mais.click()
    await menu.getByRole('button', { name: /Biblioteca/ }).click()
    await expect(window.getByRole('heading', { name: 'Biblioteca', exact: true })).toBeVisible()
    await expect(nav('Biblioteca')).toHaveAttribute('aria-current', 'page')

    // 4) Mega → Chat: só a página (o conteúdo do site é do chat.spec para não
    //    acoplar este teste à rede) e o webview começa a carregar em segundo plano.
    await mais.click()
    await menu.getByRole('button', { name: /Chat/ }).click()
    await expect(window.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible()
    await expect(nav('Chat')).toHaveAttribute('aria-current', 'page')

    // 5) Mega → Configurações.
    await mais.click()
    await menu.getByRole('button', { name: /Configurações/ }).click()
    await expect(window.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible()
    await expect(nav('Configurações')).toHaveAttribute('aria-current', 'page')

    // 6) Mega → Meu PC: o heading é o nome real do PC (chip da titlebar).
    const pcName = (await window.locator('.title-bar [title]').first().innerText()).trim()
    expect(pcName.length).toBeGreaterThan(0)
    await mais.click()
    await menu.getByRole('button', { name: pcName }).click()
    await expect(window.getByRole('heading', { name: pcName, exact: true })).toBeVisible()
    await expect(window.getByText('Manutenção e inicialização do seu PC')).toBeVisible()
    await expect(nav('Meu PC')).toHaveAttribute('aria-current', 'page')

    // 7) "/" abre a busca global (mesmo overlay existente) e Esc fecha.
    await window.keyboard.press('/')
    await expect(window.getByRole('combobox', { name: 'Busca global' })).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByRole('combobox', { name: 'Busca global' })).toHaveCount(0)
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
