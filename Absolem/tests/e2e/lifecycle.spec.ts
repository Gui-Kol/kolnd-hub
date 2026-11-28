/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { existsSync } from 'fs'
import { closeApp, launchApp, showOverlay } from './helpers'

/**
 * Primeira execução e encerramento explícito.
 *
 * A primeira execução sem chave abre Configurações em "Chave e custo" e o
 * overlay mostra o cartão de configuração. `app:quit` percorre os ganchos de
 * encerramento, fecha o processo e o perfil temporário é removido pelo teste.
 */
test('primeira execução, cartão sem chave e shutdown limpo', async () => {
  const launched = await launchApp('shutdown')
  try {
    await test.step('primeira execução abre Chave e custo', async () => {
      await expect(launched.page).toHaveURL(/#settings/)
      await expect(launched.page.locator('main h2').first()).toHaveText('Chave e custo')
      await expect(
        launched.page.locator('header').getByText('Chave do Gemini não configurada')
      ).toBeVisible()
    })

    const overlay = await test.step('cartão de primeira execução no overlay', async () => {
      const window = await showOverlay(launched.app, launched.page)
      await expect(window.getByText('Configure sua chave do Gemini para começar.')).toBeVisible()
      await window.getByRole('button', { name: 'Configurar agora' }).click()
      await expect(launched.page).toHaveURL(/#settings\/key/)
      await expect(launched.page.locator('main h2').first()).toHaveText('Chave e custo')
      await window.getByRole('button', { name: 'Agora não' }).click()
      await expect(window.getByText('Configure sua chave do Gemini para começar.')).toBeHidden()
      return window
    })
    await expect(overlay.getByText('Configure sua chave do Gemini para começar.')).toBeHidden()

    await test.step('quit pelo IPC encerra processo e janelas', async () => {
      const closed = launched.app.waitForEvent('close')
      await launched.page.evaluate(() => {
        void window.absolem.quit()
      })
      await closed
    })
  } finally {
    await closeApp(launched)
  }

  expect(existsSync(launched.userData)).toBe(false)
})
