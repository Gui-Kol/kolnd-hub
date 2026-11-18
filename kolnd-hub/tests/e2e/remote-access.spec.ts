import { test, expect, _electron as electron } from '@playwright/test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Acesso remoto (Configurações): a seção renderiza com o estado REAL do main.
 *
 * A lista de passos só aparece depois de `remote:status` responder, então
 * encontrá-la prova o caminho IPC → detecção de Tailscale/interfaces → probes
 * TCP → renderer. Nenhuma ação externa é clicada aqui (nem winget, nem IP
 * público, nem abrir navegador).
 */
const CONTEXT_FILE =
  process.env.KOLDND_HUB_E2E_CONTEXT ?? join(tmpdir(), 'kolnd-hub-e2e-context.json')

function loadContext(): E2eContext {
  return JSON.parse(readFileSync(CONTEXT_FILE, 'utf8')) as E2eContext
}

test('configurações: seção de acesso remoto renderiza com status do main', async () => {
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

    await window.getByRole('button', { name: 'Mais' }).click()
    await window
      .locator('#topbar-mais-menu')
      .getByRole('button', { name: /Configurações/ })
      .click()

    await expect(window.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Acesso remoto', exact: true })).toBeVisible()
    await expect(window.getByText('Jogar de qualquer lugar')).toBeVisible()

    // Ações principais presentes e com nome acessível.
    await expect(window.getByRole('button', { name: /Descobrir meu IP público/ })).toBeVisible()
    await expect(window.getByRole('button', { name: /Abrir painel do Kloud Games/ })).toBeVisible()

    // Prova de que o IPC respondeu: os passos só existem com `status` carregado.
    await expect(window.getByText(/Jogue de qualquer rede/)).toBeVisible({ timeout: 30_000 })
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
