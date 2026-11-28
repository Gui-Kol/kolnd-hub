/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { stubNativeDialogs, withApp } from './helpers'

/**
 * Configurações, memória, permissões, pesquisa e diagnóstico pelo IPC real.
 *
 * Toda escrita ocorre no userData temporário. Export/import usam um stub local
 * dos diálogos nativos, sem abrir janela do SO; o arquivo gerado é lido pelo
 * teste e removido junto com o perfil.
 */
test('rotas, tema, memória, permissões, pesquisa e diagnóstico', async () => {
  await withApp('settings', async ({ app, page, userData }) => {
    const themePath = join(userData, 'tema-exportado.json')
    const memoryPath = join(userData, 'memoria-exportada.json')
    const diagnosticsPath = join(userData, 'diagnostico-exportado.json')

    await test.step('sete rotas e aba persistida', async () => {
      const tabs = [
        ['Aparência', 'Aparência'],
        ['Voz', 'Voz'],
        ['Permissões', 'Permissões'],
        ['Memória', 'Memória'],
        ['Chave e custo', 'Chave e custo'],
        ['Diagnóstico', 'Diagnóstico'],
        ['Sobre', 'Sobre o Absolem']
      ] as const
      for (const [label, heading] of tabs) {
        await page.getByRole('button', { name: label, exact: true }).click()
        await expect(page.locator('main h2').first()).toHaveText(heading)
      }

      await page.evaluate(() => window.absolem.openSettings('appearance'))
      await expect(page).toHaveURL(/#settings\/appearance/)
      await expect(page.locator('main h2').first()).toHaveText('Aparência')
      // `openSettings` só navega; clicar na aba é o caminho que persiste.
      await page.getByRole('button', { name: 'Aparência', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const result = await window.absolem.storeGet('ui')
            if (!result.ok) return ''
            const value = result.value as { lastSettingsTab?: string }
            return value.lastSettingsTab ?? ''
          })
        )
        .toBe('appearance')
    })

    await test.step('tema exporta e importa com diálogo stub', async () => {
      await stubNativeDialogs(app, {
        savePath: themePath,
        openPath: themePath,
        confirmResponse: 0
      })
      expect(
        await page.evaluate(() =>
          window.absolem.themeSet({ presetId: 'jade', primaryColor: '#10b981' })
        )
      ).toEqual({ ok: true })

      const exported = await page.evaluate(() => window.absolem.themeExport())
      expect(exported).toMatchObject({ ok: true, canceled: false })
      const themeFile = JSON.parse(readFileSync(themePath, 'utf8')) as {
        app: string
        kind: string
        theme: { presetId: string }
      }
      expect(themeFile).toMatchObject({ app: 'absolem', kind: 'theme' })
      expect(themeFile.theme.presetId).toBe('jade')

      expect(
        await page.evaluate(() =>
          window.absolem.themeSet({ presetId: 'custom', primaryColor: '#22d3ee' })
        )
      ).toEqual({ ok: true })
      const imported = await page.evaluate(() => window.absolem.themeImport())
      expect(imported).toMatchObject({ ok: true, canceled: false })
      const current = await page.evaluate(() => window.absolem.themeGet())
      expect(current.ok && current.theme.presetId).toBe('jade')
    })

    await test.step('memória CRUD, auditoria, export e import', async () => {
      const created = await page.evaluate(() =>
        window.absolem.memory.create({
          kind: 'fact',
          content: 'fato sintetico E2E sobre o projeto',
          tags: ['e2e'],
          confidence: 0.9
        })
      )
      expect(created.ok).toBe(true)
      if (!created.ok) return
      const firstId = created.memory.id

      const listed = await page.evaluate(() => window.absolem.memory.list({ query: 'sintetico' }))
      expect(listed.ok && listed.total).toBeGreaterThanOrEqual(1)
      const searched = await page.evaluate(() =>
        window.absolem.memory.search({ query: 'sintetico', limit: 10 })
      )
      expect(searched.ok && searched.memories.length).toBeGreaterThanOrEqual(1)

      const updated = await page.evaluate(
        (id) =>
          window.absolem.memory.update({
            id,
            patch: { content: 'fato sintetico E2E atualizado', pinned: true }
          }),
        firstId
      )
      expect(updated.ok).toBe(true)
      if (updated.ok) {
        expect(updated.memory.pinned).toBe(true)
        expect(updated.memory.content).toContain('atualizado')
      }

      const second = await page.evaluate(() =>
        window.absolem.memory.create({
          kind: 'preference',
          content: 'preferencia sintetica E2E',
          confidence: 0.8
        })
      )
      expect(second.ok).toBe(true)
      if (second.ok) {
        expect(
          await page.evaluate((id) => window.absolem.memory.remove({ id }), second.memory.id)
        ).toEqual({ ok: true, removed: true })
      }

      expect(
        await page.evaluate(() => window.absolem.memory.removeAll({ confirm: 'ERrado' }))
      ).toMatchObject({ ok: false })

      await stubNativeDialogs(app, { savePath: memoryPath, confirmResponse: 0 })
      const exported = await page.evaluate(() =>
        window.absolem.memory.export({ includeTranscripts: false })
      )
      expect(exported.ok).toBe(true)
      const memoryFile = JSON.parse(readFileSync(memoryPath, 'utf8')) as {
        app: string
        kind: string
        memories: Array<{ content: string }>
      }
      expect(memoryFile).toMatchObject({ app: 'absolem', kind: 'memory' })
      expect(memoryFile.memories.length).toBeGreaterThanOrEqual(1)

      expect(
        await page.evaluate(() => window.absolem.memory.removeAll({ confirm: 'APAGAR TUDO' }))
      ).toMatchObject({ ok: true })
      expect(await page.evaluate(() => window.absolem.memory.list())).toMatchObject({
        ok: true,
        total: 0
      })

      await stubNativeDialogs(app, { openPath: memoryPath, confirmResponse: 0 })
      const imported = await page.evaluate(() => window.absolem.memory.import())
      expect(imported).toMatchObject({ ok: true, canceled: false })
      if (imported.ok) expect(imported.imported ?? 0).toBeGreaterThanOrEqual(1)
      expect(await page.evaluate(() => window.absolem.memory.list())).toMatchObject({
        ok: true,
        total: 1
      })
      expect(await page.evaluate(() => window.absolem.memory.stats())).toMatchObject({
        ok: true,
        stats: { total: 1 }
      })

      const auditPath = join(userData, 'audit', 'memory.jsonl')
      expect(existsSync(auditPath)).toBe(true)
      const auditText = readFileSync(auditPath, 'utf8')
      expect(auditText).toContain('"op"')
      expect(auditText).not.toContain('fato sintetico')
      expect(auditText).not.toContain('preferencia sintetica')
      expect(existsSync(join(userData, 'audit', 'actions.jsonl'))).toBe(false)
    })

    await test.step('permissões, pausa e limites', async () => {
      expect(await page.evaluate(() => window.absolem.permissions.get())).toMatchObject({
        ok: true,
        permissions: { paused: false }
      })
      expect(
        await page.evaluate(() =>
          window.absolem.permissions.set({ category: 'system.power', decision: 'ask' })
        )
      ).toEqual({ ok: true })
      const changed = await page.evaluate(() => window.absolem.permissions.get())
      expect(changed.ok && changed.permissions.categories['system.power']).toBe('ask')
      expect(
        await page.evaluate(() =>
          window.absolem.permissions.set({ category: 'system.power', decision: 'allow' })
        )
      ).toEqual({ ok: true })

      expect(await page.evaluate(() => window.absolem.actions.pause(true))).toEqual({
        ok: true,
        paused: true
      })
      expect(await page.evaluate(() => window.absolem.actions.pause(false))).toEqual({
        ok: true,
        paused: false
      })
      expect(await page.evaluate(() => window.absolem.actions.status())).toMatchObject({
        ok: true,
        status: { paused: false, limits: { appLaunchesPerMinute: 5 } }
      })
    })

    await test.step('pesquisa liga/desliga, limpa cache e recusa esquema não http', async () => {
      const enabled = await page.evaluate(() => window.absolem.search.status())
      expect(enabled.ok && enabled.status.enabled).toBe(true)
      if (enabled.ok) {
        expect(enabled.status.tools).toContain('fetch_url')
        expect(enabled.status.cache.entries).toBe(0)
      }
      expect(await page.evaluate(() => window.absolem.search.clearCache())).toEqual({ ok: true })

      expect(await page.evaluate(() => window.absolem.storeSet('web', { enabled: false }))).toEqual(
        { ok: true }
      )
      const disabled = await page.evaluate(() => window.absolem.search.status())
      expect(disabled.ok && disabled.status.enabled).toBe(false)
      if (disabled.ok) expect(disabled.status.tools).toEqual([])
      expect(await page.evaluate(() => window.absolem.storeSet('web', { enabled: true }))).toEqual({
        ok: true
      })
      expect(
        await page.evaluate(() => window.absolem.search.openUrl('javascript:alert(1)'))
      ).toMatchObject({ ok: false })
    })

    await test.step('histórico e diagnóstico exportado sem chave', async () => {
      expect(await page.evaluate(() => window.absolem.history.list({ limit: 5 }))).toMatchObject({
        ok: true,
        enabled: true
      })
      const gemini = await page.evaluate(() => window.absolem.diagnostics.gemini())
      expect(gemini.ok).toBe(true)
      expect(JSON.stringify(gemini)).not.toContain('absolem-test-live-key')
      expect(JSON.stringify(gemini)).not.toContain('apiKey')
      const overlay = await page.evaluate(() => window.absolem.diagnostics.overlay())
      expect(overlay.ok).toBe(true)

      await stubNativeDialogs(app, { savePath: diagnosticsPath })
      const exported = await page.evaluate(() => window.absolem.diagnostics.export())
      expect(exported).toMatchObject({ ok: true, canceled: false })
      const report = JSON.parse(readFileSync(diagnosticsPath, 'utf8')) as {
        app: { name: string }
        runtime: { electron: string }
        models: { live: string }
        gemini: { configured: boolean }
        recentErrors: unknown[]
      }
      expect(report.app.name.toLowerCase()).toBe('absolem')
      expect(typeof report.runtime.electron).toBe('string')
      expect(typeof report.models.live).toBe('string')
      expect(report.gemini.configured).toBe(false)
      expect(Array.isArray(report.recentErrors)).toBe(true)
      const text = readFileSync(diagnosticsPath, 'utf8')
      expect(text).not.toContain('absolem-test-live-key')
      expect(text).not.toContain('apiKey')
    })

    await test.step('nenhum arquivo sensível fora do perfil temporário', async () => {
      expect(existsSync(userData)).toBe(true)
      expect(existsSync(join(userData, 'memory.sqlite'))).toBe(true)
      expect(existsSync(themePath)).toBe(true)
      expect(existsSync(memoryPath)).toBe(true)
      expect(existsSync(diagnosticsPath)).toBe(true)
      expect(readFileSync(diagnosticsPath, 'utf8').includes(userData)).toBe(false)
    })
  })
})
