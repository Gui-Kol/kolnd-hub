/// <reference lib="dom" />
import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { AbsolemApi } from '../../src/shared/ipc'

declare global {
  interface Window {
    absolem: AbsolemApi
  }
}

/**
 * Fluxo determinístico do app buildado (task 11, T10).
 *
 * - userData temporário, transporte Gemini fake, nenhuma rede real;
 * - abre Configurações pelo `activate` do main (mesmo caminho da bandeja);
 * - troca o tema, salva um dispositivo fake, confere o overlay e fecha a janela
 *   de Configurações sem encerrar o app.
 */

const APP_ROOT = resolve(__dirname, '../..')

test('configurações, tema, dispositivo e overlay sem encerrar o app', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'absolem-e2e-'))
  const electronApp = await electron.launch({
    args: [APP_ROOT],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      ABSOLEM_TEST_USERDATA: userData,
      ABSOLEM_TEST_TRANSPORT: 'fake'
    }
  })

  try {
    // Primeira execução sem chave abre Configurações em "Chave e custo";
    // `activate` é o mesmo caminho do menu da bandeja. Espera o main ficar
    // pronto antes de emitir: sem isso, o evento pode chegar antes do listener
    // e nenhuma janela abre (flake intermitente observado).
    await electronApp.evaluate(async ({ app }) => {
      if (!app.isReady()) await app.whenReady()
    })
    await electronApp.evaluate(({ app }) => {
      app.emit('activate')
    })
    const settings = await electronApp.firstWindow()
    await settings.waitForLoadState('domcontentloaded')
    await expect(settings).toHaveURL(/#settings/)

    // Sem chave, o primeiro uso abre em "Chave e custo" (T9).
    await expect(settings.locator('main h2').first()).toHaveText('Chave e custo')

    // Tema: a aba Aparência continua a existir e persiste pelo canal real.
    await settings.getByRole('button', { name: 'Aparência' }).click()
    await expect(settings.locator('main h2').first()).toHaveText('Aparência')
    await settings.selectOption('#appearance-preset', 'jade')
    await expect
      .poll(() =>
        settings.evaluate(async () => {
          const result = await window.absolem.themeGet()
          return result.ok ? result.theme.presetId : ''
        })
      )
      .toBe('jade')

    // Dispositivo fake: salva sem microfone real e lê de volta.
    const savedDevice = await settings.evaluate(async () => {
      const result = await window.absolem.voice.setDevice({ inputDeviceId: 'fake-mic-e2e' })
      return result.ok ? result.status.inputDeviceId : null
    })
    expect(savedDevice).toBe('fake-mic-e2e')

    // Overlay: o canal real cria a janela `#overlay`.
    const overlayPromise = electronApp.waitForEvent('window')
    await settings.evaluate(async () => {
      await window.absolem.overlayShow()
    })
    const overlay = await overlayPromise
    await overlay.waitForLoadState('domcontentloaded')
    expect(await overlay.evaluate(() => location.hash)).toContain('overlay')

    const windows = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        url: window.webContents.getURL(),
        visible: window.isVisible()
      }))
    )
    expect(windows.some((window) => window.url.includes('#overlay'))).toBe(true)

    // X da janela de Configurações oculta, não encerra o app.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((item) =>
        item.webContents.getURL().includes('#settings')
      )
      window?.close()
    })
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows().find((item) =>
            item.webContents.getURL().includes('#settings')
          )
          return window ? window.isVisible() : null
        })
      )
      .toBe(false)

    expect(await electronApp.evaluate(({ app }) => app.isReady())).toBe(true)
  } finally {
    await electronApp.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
