/// <reference lib="dom" />
import AxeBuilder from '@axe-core/playwright'
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
 * Auditoria de acessibilidade com axe (task 13/T9).
 *
 * - app buildado, userData temporário, transporte Gemini fake, sem rede real;
 * - percorre as sete abas de Configurações e o overlay em modo expandido;
 * - falha em qualquer violação `critical` ou `serious`.
 *
 * A passada manual com Narrador do Windows e teclado fica registrada em
 * `Absolem/docs/a11y-audit.md` como pendência de ambiente humano.
 */

const APP_ROOT = resolve(__dirname, '../..')
const TABS = ['Aparência', 'Voz', 'Permissões', 'Memória', 'Chave e custo', 'Diagnóstico', 'Sobre']

interface AxeNode {
  target: unknown[]
}

interface AxeViolation {
  id: string
  impact?: string | null
  description: string
  nodes: AxeNode[]
}

function summarize(violations: AxeViolation[]) {
  return violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => node.target.join(' '))
    }))
}

test('axe sem violações críticas ou sérias em Configurações e overlay', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'absolem-a11y-'))
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
    await electronApp.evaluate(({ app }) => {
      app.emit('activate')
    })
    const settings = await electronApp.firstWindow()
    await settings.waitForLoadState('domcontentloaded')
    await expect(settings).toHaveURL(/#settings/)

    for (const tab of TABS) {
      await settings.getByRole('button', { name: tab, exact: true }).click()
      await settings.waitForTimeout(150)
      const results = await new AxeBuilder({ page: settings })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Electron não suporta `context.newPage()`; o modo legado roda o axe
        // na própria página, sem abrir uma aba em branco.
        .setLegacyMode(true)
        .analyze()
      expect(summarize(results.violations), `aba ${tab}`).toEqual([])
    }

    const overlayPromise = electronApp.waitForEvent('window')
    await settings.evaluate(async () => {
      await window.absolem.overlayShow()
    })
    const overlay = await overlayPromise
    await overlay.waitForLoadState('domcontentloaded')
    await overlay.getByRole('button', { name: 'Escrever', exact: true }).click()
    await overlay.waitForTimeout(300)
    const overlayResults = await new AxeBuilder({ page: overlay })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .setLegacyMode(true)
      .analyze()
    expect(summarize(overlayResults.violations), 'overlay expandido').toEqual([])
  } finally {
    await electronApp.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
