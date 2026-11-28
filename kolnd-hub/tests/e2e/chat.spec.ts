import { test, expect, _electron as electron } from '@playwright/test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'
import { CHAT_PARTITION, CHAT_URL } from '../../src/shared/chat'

/**
 * Chat: o Go Live roda DENTRO do Hub em um `<webview>` de sessão própria.
 *
 * Cobre o caminho real (Electron de produção em `out/`): a página monta o
 * webview com a URL fixa, o main anexa um WebContents do tipo `webview` e o
 * guest termina de carregar. Sair da página desmonta o webview (D4), provado
 * pela ausência de WebContents `webview` depois da troca.
 *
 * Electron REAL, `userData` isolado e stubs no PATH — mesmo padrão de
 * navigation/smoke (o site depende de rede; tolerância de 45 s no carregamento).
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

test('chat: carrega o Go Live no webview e destrói o guest ao sair', async () => {
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

    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })

    const nav = (label: string) =>
      window.locator('nav[aria-label="Navegação principal"] button', { hasText: label })

    // 1) Topbar → Chat: página, item ativo e webview com a URL fixa.
    await nav('Chat').click()
    await expect(window.getByTestId('chat-root')).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible()
    await expect(nav('Chat')).toHaveAttribute('aria-current', 'page')

    const webview = window.getByTestId('chat-webview')
    await expect(webview).toHaveAttribute('src', CHAT_URL)
    await expect(webview).toHaveAttribute('partition', CHAT_PARTITION)

    // 2) Main confirma um WebContents do tipo `webview` com o host do site,
    //    esperando o carregamento terminar (rede real, até 45 s).
    const guestUrl = await electronApp.evaluate(async ({ webContents }) => {
      const deadline = Date.now() + 45_000
      while (Date.now() < deadline) {
        const guest = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview')
        if (guest && !guest.isLoading()) return guest.getURL()
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return null
    })
    expect(guestUrl).not.toBeNull()
    expect(new URL(guestUrl as string).hostname).toBe('golive.nemtudo.me')

    // 3) Sair da página desmonta o webview: nenhum guest restante.
    await nav('Ferramentas').click()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible()
    const remainingGuests = await electronApp.evaluate(async ({ webContents }) => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (
          webContents.getAllWebContents().filter((wc) => wc.getType() === 'webview').length === 0
        ) {
          return 0
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return webContents.getAllWebContents().filter((wc) => wc.getType() === 'webview').length
    })
    expect(remainingGuests).toBe(0)
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
