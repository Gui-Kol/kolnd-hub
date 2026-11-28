import { describe, expect, it, vi } from 'vitest'
import { SearchRequestCancelledError } from './cache'
import type { FetchedPage } from './fetchPage'
import { DYNAMIC_PAGE_WARNING, createFetchUrlHandler } from './tools'

function page(overrides: Partial<FetchedPage> = {}): FetchedPage {
  return {
    finalUrl: 'https://example.test/artigo',
    status: 200,
    contentType: 'text/html',
    body: '<html><head><title>Artigo</title></head><body><article><h1>Artigo</h1><p>Texto do artigo com detalhes suficientes.</p></article></body></html>',
    bytes: 120,
    ...overrides
  }
}

describe('ferramenta fetch_url', () => {
  it('recusa URL inválida antes da rede', async () => {
    const fetchPage = vi.fn()
    const handler = createFetchUrlHandler({
      isEnabled: () => true,
      fetchPage: fetchPage as never
    })

    await expect(handler({ url: 'file:///C:/Windows/win.ini' })).rejects.toThrow(
      'Apenas URLs http ou https'
    )
    await expect(handler({ url: 'javascript:alert(1)' })).rejects.toThrow(
      'Apenas URLs http ou https'
    )
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('avisa quando a página parece dinâmica', async () => {
    const handler = createFetchUrlHandler({
      isEnabled: () => true,
      fetchPage: async () =>
        page({
          body: '<html><body><div id="root"></div><script>renderApp()</script></body></html>',
          bytes: 200
        })
    })
    const result = await handler({ url: 'https://example.test/spa' })

    expect(result.warnings).toContain(DYNAMIC_PAGE_WARNING)
    expect(result.content).not.toContain('renderApp')
  })

  it('resposta inclui a URL final depois de redirect', async () => {
    const handler = createFetchUrlHandler({
      isEnabled: () => true,
      fetchPage: async () => page({ finalUrl: 'https://final.example/artigo' })
    })
    const result = await handler({ url: 'https://example.test/antigo' })

    expect(result.finalUrl).toBe('https://final.example/artigo')
    expect(result.sources).toEqual([{ title: 'Artigo', url: 'https://final.example/artigo' }])
    expect(result.title).toBe('Artigo')
    expect(result.content).toContain('Texto do artigo')
  })

  it('entrega o sinal do roteador ao fetch e recusa antes da rede se já cancelado', async () => {
    const controller = new AbortController()
    const fetchPage = vi.fn(async (_url: string, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal)
      return page()
    })
    const handler = createFetchUrlHandler({ isEnabled: () => true, fetchPage })

    await handler({ url: 'https://example.test/artigo' }, { signal: controller.signal })
    expect(fetchPage).toHaveBeenCalledTimes(1)

    const aborted = new AbortController()
    aborted.abort()
    await expect(
      handler({ url: 'https://example.test/artigo' }, { signal: aborted.signal })
    ).rejects.toBeInstanceOf(SearchRequestCancelledError)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('cancelamento durante o fetch vira falha auditada sem conteúdo', async () => {
    const audit: Array<{ ok: boolean; bytes: number }> = []
    const handler = createFetchUrlHandler({
      isEnabled: () => true,
      fetchPage: async () => {
        throw new SearchRequestCancelledError()
      },
      audit: (event) => audit.push({ ok: event.ok, bytes: event.bytes })
    })

    await expect(handler({ url: 'https://example.test/artigo' })).rejects.toMatchObject({
      kind: 'cancelled'
    })
    expect(audit).toEqual([{ ok: false, bytes: 0 }])
  })
})
