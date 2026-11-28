/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { showOverlay, windowSnapshots, withApp } from './helpers'

interface ChatEvents {
  delta: Array<{ id: string; text: string }>
  done: string[]
  error: Array<{ id: string; message: string }>
}

async function installChatProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as { __chatEvents?: ChatEvents }
    target.__chatEvents = { delta: [], done: [], error: [] }
    window.absolem.chat.onDelta((push) =>
      target.__chatEvents?.delta.push({ id: push.requestId, text: push.text })
    )
    window.absolem.chat.onDone((push) => target.__chatEvents?.done.push(push.requestId))
    window.absolem.chat.onError((push) =>
      target.__chatEvents?.error.push({ id: push.requestId, message: push.message })
    )
  })
}

function chatEvents(page: Page, requestId: string): Promise<ChatEvents> {
  return page.evaluate((id) => {
    const target = window as unknown as { __chatEvents?: ChatEvents }
    const events = target.__chatEvents ?? { delta: [], done: [], error: [] }
    return {
      delta: events.delta.filter((event) => event.id === id),
      done: events.done.filter((done) => done === id),
      error: events.error.filter((event) => event.id === id)
    }
  }, requestId)
}

async function installIndicatorProbe(overlay: Page): Promise<void> {
  await overlay.evaluate(() => {
    const target = window as unknown as { __captureIndicators?: boolean[] }
    target.__captureIndicators = []
    window.absolem.capture.onIndicator((push) => target.__captureIndicators?.push(push.active))
  })
}

function indicatorPushes(overlay: Page): Promise<boolean[]> {
  return overlay.evaluate(() => {
    const target = window as unknown as { __captureIndicators?: boolean[] }
    return target.__captureIndicators ?? []
  })
}

/**
 * Texto e captura no transporte Live fake.
 *
 * A resposta fake tem atraso determinístico para que cancelar/substituir um
 * turno seja provado sem corrida. Nenhum frame sai da memória local, nenhuma
 * chave é configurada e a rede não é tocada.
 */
test('chat fake conclui, cancela e se recupera de payload inválido', async () => {
  await withApp(
    'chat',
    async ({ page }) => {
      await test.step('probe de eventos', async () => {
        await installChatProbe(page)
      })

      await test.step('turno completo entrega delta e done', async () => {
        expect(
          await page.evaluate(() => window.absolem.chat.send('chat-ok', 'mensagem sintetica'))
        ).toEqual({ ok: true })
        await expect.poll(async () => (await chatEvents(page, 'chat-ok')).done).toEqual(['chat-ok'])
        const events = await chatEvents(page, 'chat-ok')
        expect(events.delta.map((event) => event.text).join('')).toContain('Resposta sintética')
        expect(events.error).toHaveLength(0)
      })

      await test.step('cancelar impede done tardio e o próximo turno funciona', async () => {
        expect(
          await page.evaluate(() => window.absolem.chat.send('chat-cancel', 'cancelar'))
        ).toEqual({ ok: true })
        expect(await page.evaluate(() => window.absolem.chat.cancel('chat-cancel'))).toEqual({
          ok: true
        })
        expect(await page.evaluate(() => window.absolem.chat.send('chat-after', 'depois'))).toEqual(
          { ok: true }
        )
        await expect
          .poll(async () => (await chatEvents(page, 'chat-after')).done)
          .toEqual(['chat-after'])
        const cancelled = await chatEvents(page, 'chat-cancel')
        expect(cancelled.done).toHaveLength(0)
        expect(cancelled.error).toHaveLength(0)
        expect(cancelled.delta).toHaveLength(0)
      })

      await test.step('novo requestId substitui o anterior', async () => {
        expect(
          await page.evaluate(() => window.absolem.chat.send('chat-superseded', 'primeiro'))
        ).toEqual({ ok: true })
        expect(
          await page.evaluate(() => window.absolem.chat.send('chat-winner', 'segundo'))
        ).toEqual({ ok: true })
        await expect
          .poll(async () => (await chatEvents(page, 'chat-winner')).done)
          .toEqual(['chat-winner'])
        expect((await chatEvents(page, 'chat-superseded')).done).toHaveLength(0)
      })

      await test.step('payload inválido não derruba o canal', async () => {
        expect(await page.evaluate(() => window.absolem.chat.send('', 'texto'))).toMatchObject({
          ok: false
        })
        expect(
          await page.evaluate(() => window.absolem.chat.send('chat-empty', '   '))
        ).toMatchObject({ ok: false })
        expect(
          await page.evaluate(() => window.absolem.chat.send('chat-recovered', 'volta'))
        ).toEqual({ ok: true })
        await expect
          .poll(async () => (await chatEvents(page, 'chat-recovered')).done)
          .toEqual(['chat-recovered'])
      })
    },
    { fakeDelayMs: 350 }
  )
})

test('captura fake recusa modo off, cancela e não deixa janela de região', async () => {
  await withApp(
    'capture',
    async ({ app, page }) => {
      const overlay = await test.step('abrir overlay e preparar indicador', async () => {
        const window = await showOverlay(app, page)
        await installIndicatorProbe(window)
        return window
      })

      await test.step('fontes e modo off recusam sem capturar', async () => {
        const sources = await page.evaluate(() => window.absolem.capture.sources())
        expect(sources.ok).toBe(true)
        if (sources.ok) expect(sources.screens.length).toBeGreaterThan(0)

        const disabled = await page.evaluate(async () => {
          const current = await window.absolem.storeGet('privacy')
          if (!current.ok) return false
          const value = current.value as { screen?: Record<string, unknown> }
          const result = await window.absolem.storeSet('privacy', {
            ...value,
            screen: { ...value.screen, mode: 'off' }
          })
          return result.ok
        })
        expect(disabled).toBe(true)

        const status = await page.evaluate(() => window.absolem.capture.status())
        expect(status.ok && status.status.mode).toBe('off')
        expect(
          await page.evaluate(() =>
            window.absolem.capture.ask({
              requestId: 'capture-off',
              kind: 'screen',
              question: 'pergunta sintetica'
            })
          )
        ).toMatchObject({ ok: false })
        expect(await page.evaluate(() => window.absolem.capture.region())).toMatchObject({
          ok: false
        })
      })

      await test.step('religar o modo e capturar com indicador', async () => {
        const enabled = await page.evaluate(async () => {
          const current = await window.absolem.storeGet('privacy')
          if (!current.ok) return false
          const value = current.value as { screen?: Record<string, unknown> }
          const result = await window.absolem.storeSet('privacy', {
            ...value,
            screen: { ...value.screen, mode: 'on' }
          })
          return result.ok
        })
        expect(enabled).toBe(true)

        await installChatProbe(page)
        expect(
          await page.evaluate(() =>
            window.absolem.capture.ask({
              requestId: 'capture-ok',
              kind: 'screen',
              question: 'pergunta sintetica'
            })
          )
        ).toEqual({ ok: true })
        await expect
          .poll(async () => (await chatEvents(page, 'capture-ok')).done)
          .toEqual(['capture-ok'])
        await expect.poll(async () => (await indicatorPushes(overlay)).at(-1)).toBe(false)
        expect(await indicatorPushes(overlay)).toContain(true)
      })

      await test.step('cancelar captura em curso não entrega resposta tardia', async () => {
        expect(
          await page.evaluate(() =>
            window.absolem.capture.ask({
              requestId: 'capture-cancel',
              kind: 'screen',
              question: 'pergunta sintetica'
            })
          )
        ).toEqual({ ok: true })
        expect(
          await page.evaluate(() =>
            window.absolem.capture.cancel({ requestId: 'capture-cancel', kind: 'ask' })
          )
        ).toEqual({ ok: true })

        expect(
          await page.evaluate(() =>
            window.absolem.capture.ask({
              requestId: 'capture-after',
              kind: 'screen',
              question: 'pergunta sintetica'
            })
          )
        ).toEqual({ ok: true })
        await expect
          .poll(async () => (await chatEvents(page, 'capture-after')).done)
          .toEqual(['capture-after'])
        const cancelled = await chatEvents(page, 'capture-cancel')
        expect(cancelled.done).toHaveLength(0)
        expect(cancelled.delta).toHaveLength(0)
        expect(cancelled.error).toHaveLength(0)
      })

      await test.step('região cancelada fecha a janela sem seleção', async () => {
        const resultPromise = page.evaluate(() => window.absolem.capture.region())
        const regionWindow = await app.waitForEvent('window')
        await regionWindow.waitForLoadState('domcontentloaded')
        expect(await regionWindow.evaluate(() => location.hash)).toContain('region')
        expect(
          await page.evaluate(() => window.absolem.capture.cancel({ kind: 'region' }))
        ).toEqual({ ok: true })
        expect(await resultPromise).toEqual({ ok: true, canceled: true, selection: null })
        await expect
          .poll(async () =>
            (await windowSnapshots(app)).some((item) => item.hash.includes('region'))
          )
          .toBe(false)
      })
    },
    { fakeDelayMs: 350 }
  )
})
