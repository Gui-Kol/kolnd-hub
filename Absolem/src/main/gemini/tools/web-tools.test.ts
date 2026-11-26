import { describe, expect, it } from 'vitest'
import { createToolRegistry } from './registry'
import {
  WEB_SEARCH_TOOL_NAME,
  createWebSearchHandler,
  registerWebTools,
  type FetchUrlToolDeps,
  type WebSearchToolDeps
} from '../../search/tools'

function fetchUrlDeps(overrides: Partial<FetchUrlToolDeps> = {}): FetchUrlToolDeps {
  return {
    isEnabled: () => true,
    fetchPage: async () => ({
      finalUrl: 'https://example.test/a',
      status: 200,
      contentType: 'text/html',
      body: '<html><body><p>ok</p></body></html>',
      bytes: 30
    }),
    ...overrides
  }
}

function webSearchDeps(overrides: Partial<WebSearchToolDeps> = {}): WebSearchToolDeps {
  return {
    isEnabled: () => true,
    search: async () => ({
      ok: true,
      text: 'Resposta.',
      sources: [{ title: 'Fonte', url: 'https://example.test/fonte' }]
    }),
    ...overrides
  }
}

describe('registro das ferramentas web', () => {
  it('schema recusa query vazia', () => {
    const registry = createToolRegistry()
    const handlers = new Map()
    const result = registerWebTools(registry, handlers, {
      enabled: true,
      fetchUrl: fetchUrlDeps(),
      webSearch: webSearchDeps()
    })
    expect(result.registered).toEqual([WEB_SEARCH_TOOL_NAME, 'fetch_url'])

    expect(registry.validateArguments('web_search', { query: '' }).ok).toBe(false)
    expect(registry.validateArguments('web_search', { query: 'x'.repeat(301) }).ok).toBe(false)
    expect(registry.validateArguments('web_search', { query: 'satélites' }).ok).toBe(true)
  })

  it('schema recusa URL longa', () => {
    const registry = createToolRegistry()
    registerWebTools(registry, new Map(), {
      enabled: true,
      fetchUrl: fetchUrlDeps(),
      webSearch: webSearchDeps()
    })

    expect(
      registry.validateArguments('fetch_url', { url: 'https://example.test/' + 'a'.repeat(2_050) })
        .ok
    ).toBe(false)
    expect(registry.validateArguments('fetch_url', { url: '' }).ok).toBe(false)
    expect(registry.validateArguments('fetch_url', { url: 'https://example.test/a' }).ok).toBe(true)
  })

  it('desligado remove do registry', () => {
    const registry = createToolRegistry()
    const handlers = new Map()
    const result = registerWebTools(registry, handlers, {
      enabled: false,
      fetchUrl: fetchUrlDeps(),
      webSearch: webSearchDeps()
    })

    expect(result.registered).toEqual([])
    expect(handlers.size).toBe(0)
    expect(registry.listTools()).toEqual([])
  })

  it('definições seguem o contrato (não sensíveis, categoria e timeout)', () => {
    const registry = createToolRegistry()
    registerWebTools(registry, new Map(), {
      enabled: true,
      fetchUrl: fetchUrlDeps(),
      webSearch: webSearchDeps()
    })

    for (const name of ['web_search', 'fetch_url']) {
      const tool = registry.getTool(name)
      expect(tool).toMatchObject({
        sensitive: false,
        category: 'web.search',
        timeoutMs: 20_000
      })
    }
  })

  it('web_search devolve fontes e marca ausência de metadata', async () => {
    const withSources = await createWebSearchHandler(webSearchDeps())({ query: 'satélites' })
    expect(withSources.sources).toHaveLength(1)
    expect(withSources.noSources).toBe(false)

    const without = await createWebSearchHandler(
      webSearchDeps({ search: async () => ({ ok: true, text: 'Sem fontes.', sources: [] }) })
    )({ query: 'sem metadata' })
    expect(without.noSources).toBe(true)
    expect(without.sources).toEqual([])
  })
})
