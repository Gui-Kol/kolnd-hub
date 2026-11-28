import { expect, test } from '@playwright/test'
import { showOverlay, windowSnapshots, withApp } from './helpers'

/**
 * Overlay, avatar e pausa no caminho real de IPC do app buildado.
 *
 * userData temporário, transporte fake e nenhuma rede. O objetivo é provar
 * show/hide/toggle, layout, interatividade, modo de entrada, push de status,
 * estado do avatar e pausa global sem depender de clique na bandeja.
 */
test('overlay, avatar e pausa mantêm o app responsivo', async () => {
  await withApp('overlay', async ({ app, page }) => {
    await test.step('estado inicial e autostart recusado fora do pacote', async () => {
      const info = await page.evaluate(() => window.absolem.getAppInfo())
      expect(info.ok).toBe(true)
      if (info.ok) {
        expect(info.info.name.toLowerCase()).toBe('absolem')
        expect(typeof info.info.platform).toBe('string')
      }

      const status = await page.evaluate(() => window.absolem.overlayStatus())
      expect(status.ok && status.status.visible).toBe(false)

      const autostart = await page.evaluate(() => window.absolem.getAutostart())
      expect(autostart.ok).toBe(true)
      if (autostart.ok) expect(autostart.state.supported).toBe(false)
      const setAutostart = await page.evaluate(() => window.absolem.setAutostart(true))
      expect(setAutostart.ok).toBe(false)
    })

    const overlay = await test.step('mostrar overlay e registrar push de status', async () => {
      const overlayWindow = await showOverlay(app, page)
      expect(await overlayWindow.evaluate(() => location.hash)).toContain('overlay')
      await page.evaluate(() => {
        const target = window as unknown as { __statusPushes?: boolean[] }
        target.__statusPushes = []
        window.absolem.onOverlayStatusChanged((next) => target.__statusPushes?.push(next.visible))
      })
      return overlayWindow
    })

    await test.step('hide, toggle e layout atualizam janela e status', async () => {
      const hidden = await page.evaluate(() => window.absolem.overlayHide())
      expect(hidden.ok && hidden.status.visible).toBe(false)
      await expect
        .poll(() => page.evaluate(() => window.absolem.overlayStatus()))
        .toMatchObject({ ok: true, status: { visible: false } })
      await expect
        .poll(async () =>
          (await windowSnapshots(app)).some((item) => item.hash.includes('overlay') && item.visible)
        )
        .toBe(false)
      await expect
        .poll(() =>
          page.evaluate(() => {
            const target = window as unknown as { __statusPushes?: boolean[] }
            return target.__statusPushes?.at(-1)
          })
        )
        .toBe(false)

      const toggled = await page.evaluate(() => window.absolem.overlayToggle())
      expect(toggled.ok && toggled.status.visible).toBe(true)
      await expect
        .poll(async () =>
          (await windowSnapshots(app)).some((item) => item.hash.includes('overlay') && item.visible)
        )
        .toBe(true)

      const layout = await page.evaluate(() =>
        window.absolem.overlaySetLayout({
          position: 'top-right',
          width: 300,
          height: 280
        })
      )
      expect(layout.ok).toBe(true)
      if (layout.ok) {
        expect(layout.status.layout).toMatchObject({
          position: 'top-right',
          width: 300,
          height: 280
        })
      }

      const interactive = await page.evaluate(() => window.absolem.overlaySetInteractive(true))
      expect(interactive.ok && interactive.status.interactive).toBe(true)
      const notInteractive = await page.evaluate(() => window.absolem.overlaySetInteractive(false))
      expect(notInteractive.ok && notInteractive.status.interactive).toBe(false)
    })

    await test.step('modo de entrada só é aceito pelo overlay', async () => {
      const fromSettings = await page.evaluate(() => window.absolem.overlaySetInputMode(true))
      expect(fromSettings.ok).toBe(false)
      const fromOverlay = await overlay.evaluate(() => window.absolem.overlaySetInputMode(true))
      expect(fromOverlay.ok).toBe(true)
      const released = await overlay.evaluate(() => window.absolem.overlaySetInputMode(false))
      expect(released.ok).toBe(true)
    })

    await test.step('avatar aplica estado, nível e push no overlay', async () => {
      await overlay.evaluate(() => {
        const target = window as unknown as {
          __avatarPushes?: Array<{ state?: string; level?: number }>
        }
        target.__avatarPushes = []
        window.absolem.avatar.onApply((push) => target.__avatarPushes?.push(push))
      })

      expect(await page.evaluate(() => window.absolem.avatar.setState('thinking'))).toEqual({
        ok: true
      })
      expect(await page.evaluate(() => window.absolem.avatar.setLevel(0.62))).toEqual({
        ok: true
      })
      const avatar = await page.evaluate(() => window.absolem.avatar.getStatus())
      expect(avatar).toEqual({ ok: true, state: 'thinking', level: 0.62 })
      await expect
        .poll(() =>
          overlay.evaluate(() => {
            const target = window as unknown as {
              __avatarPushes?: Array<{ state?: string; level?: number }>
            }
            return target.__avatarPushes?.at(-1)
          })
        )
        .toMatchObject({ level: 0.62 })
    })

    await test.step('pausa global alterna e não altera o app', async () => {
      const paused = await page.evaluate(() => window.absolem.actions.pause(true))
      expect(paused).toEqual({ ok: true, paused: true })
      const during = await page.evaluate(() => window.absolem.actions.status())
      expect(during.ok && during.status.paused).toBe(true)
      const permissions = await page.evaluate(() => window.absolem.permissions.get())
      expect(permissions.ok && permissions.permissions.paused).toBe(true)

      const invalid = await page.evaluate(() =>
        window.absolem.permissions.set({
          category: 'apps.launch',
          decision: 'invalid' as never
        })
      )
      expect(invalid.ok).toBe(false)

      const resumed = await page.evaluate(() => window.absolem.actions.pause(false))
      expect(resumed).toEqual({ ok: true, paused: false })
      expect(await app.evaluate(({ app }) => app.isReady())).toBe(true)
    })
  })
})
