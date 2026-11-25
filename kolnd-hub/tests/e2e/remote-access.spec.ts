import { test, expect, _electron as electron } from '@playwright/test'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import type { E2eContext } from './global-setup'

/**
 * Acesso remoto (Configurações): a seção renderiza com o estado REAL do main.
 *
 * A lista de passos só aparece depois de `remote:status` responder, então
 * encontrá-la prova o caminho IPC → detecção de ZeroTier/interfaces → probes
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
      ZEROTIER_CLI: join(ctx.stubsDir, 'zerotier-cli.exe'),
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
    await expect(window.getByRole('button', { name: /Abrir ZeroTier/ })).toBeVisible()
    await expect(window.getByRole('button', { name: /Fechar ZeroTier/ })).toBeVisible()

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

test('dashboard: modo remoto e ajuda de conexão do Moonlight', async () => {
  const ctx = loadContext()

  const electronApp = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      KOLDND_HUB_TEST_USERDATA: ctx.userDataDir,
      ZEROTIER_CLI: join(ctx.stubsDir, 'zerotier-cli.exe'),
      PATH: `${ctx.stubsDir}${delimiter}${process.env.PATH ?? ''}`
    }
  })

  try {
    const window = await electronApp.firstWindow()
    await expect(window.getByRole('heading', { name: 'Ferramentas' })).toBeVisible({
      timeout: 45_000
    })

    const kloudCard = window.locator('[data-testid="app-card"]').filter({ hasText: 'Kloud Games' })
    await expect(kloudCard).toBeVisible()

    // Começa desligado; com o `zerotier-cli.exe` stubado (online, rede OK, IP
    // fixo) o modo liga de verdade e o card mostra o endereço para o Moonlight.
    const offButton = kloudCard.getByRole('button', { name: 'Modo remoto' })
    await expect(offButton).toHaveAttribute('aria-pressed', 'false')
    await offButton.click()

    const onButton = kloudCard.getByRole('button', { name: 'Remoto ativo' })
    await expect(onButton).toBeVisible()
    await expect(onButton).toHaveAttribute('aria-pressed', 'true')
    await expect(kloudCard.getByText('10.147.20.5')).toBeVisible()

    // Desligar não derruba o ZeroTier — só o modo do Hub.
    await onButton.click()
    await expect(kloudCard.getByRole('button', { name: 'Modo remoto' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await expect(kloudCard.getByText('10.147.20.5')).toHaveCount(0)

    // Ajuda: tutorial com abas PC/celular e bloco de endereços (sem clicar em
    // instalar/abrir/fechar — isso abriria winget/UAC de verdade).
    await kloudCard
      .getByRole('button', { name: 'Como conectar no Moonlight (local e remoto)' })
      .click()
    const dialog = window.getByRole('dialog', { name: 'Como conectar no Moonlight' })
    await expect(dialog).toBeVisible()

    const pcTab = dialog.getByRole('tab', { name: 'No PC (este computador)' })
    const mobileTab = dialog.getByRole('tab', { name: 'No celular' })
    await expect(pcTab).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('tabpanel')).toContainText('Join Network')

    await mobileTab.click()
    await expect(mobileTab).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('tabpanel')).toContainText('ZeroTier One')
    await expect(dialog.getByRole('tabpanel')).toContainText('Adicionar rede')

    // Endereços reais da rede stub (IP 10.147.20.5 e o ID da rede).
    await expect(dialog.getByText('Endereços', { exact: true })).toBeVisible()
    await expect(dialog.getByText('10.147.20.5').first()).toBeVisible()
    await expect(dialog.getByText('8056c2e21c000001').first()).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Copiar tudo' })).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /Copiar IP do ZeroTier/i }).first()
    ).toBeVisible()

    // O atalho leva para a seção completa em Configurações.
    await dialog.getByRole('button', { name: /Abrir Acesso remoto/ }).click()
    await expect(dialog).toHaveCount(0)
    await expect(window.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible()
    await expect(window.getByRole('heading', { name: 'Acesso remoto', exact: true })).toBeVisible()
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
