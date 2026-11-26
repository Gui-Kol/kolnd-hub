import { describe, expect, it, vi } from 'vitest'
import type { FetchedPage } from './fetchPage'
import { SearchQuotaError, createSearchTurnLimits } from './limits'
import { createFetchUrlHandler, createWebToolEntries, type SearchAuditEvent } from './tools'

const page: FetchedPage = {
  finalUrl: 'https://example.test/artigo',
  status: 200,
  contentType: 'text/html',
  body: '<html><body><article><p>Conteúdo suficiente para não parecer página dinâmica.</p></article></body></html>',
  bytes: 100
}

describe('limites, custo e indicador', () => {
  it('4ª busca no turno é recusada', () => {
    const limits = createSearchTurnLimits({ now: () => 1_000 })
    limits.beginTurn('req-1', 1_000)

    for (let index = 0; index < 3; index += 1) {
      expect(limits.check('search')).toEqual({ ok: true })
      limits.consume('search')
    }
    expect(limits.check('search')).toMatchObject({ ok: false, reason: 'turn-limit' })
    expect(limits.snapshot(1_000)).toMatchObject({
      requestId: 'req-1',
      searches: 3,
      searchesLimit: 3
    })

    // Turno novo zera a contagem.
    limits.beginTurn('req-2', 1_001)
    expect(limits.check('search')).toEqual({ ok: true })
  })

  it('6ª abertura de página é recusada', () => {
    const limits = createSearchTurnLimits({ now: () => 1_000 })
    limits.beginTurn('req-fetch', 1_000)
    for (let index = 0; index < 5; index += 1) {
      expect(limits.check('fetch')).toEqual({ ok: true })
      limits.consume('fetch')
    }
    expect(limits.check('fetch')).toMatchObject({ ok: false, reason: 'turn-limit' })
  })

  it('teto mensal bloqueia e vira kind quota', async () => {
    const limits = createSearchTurnLimits({
      now: () => 1_000,
      checkBudget: () => {
        throw new SearchQuotaError('Limite mensal de tokens atingido.')
      }
    })
    limits.beginTurn('req-quota', 1_000)
    expect(limits.check('search')).toMatchObject({ ok: false, reason: 'monthly' })

    const fetchPage = vi.fn()
    const handler = createFetchUrlHandler({
      isEnabled: () => true,
      fetchPage,
      limits
    })
    await expect(handler({ url: 'https://example.test/a' })).rejects.toMatchObject({
      kind: 'quota'
    })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('orçamento de 30 s encerra o turno', () => {
    let now = 5_000
    const limits = createSearchTurnLimits({ now: () => now })
    limits.beginTurn('req-budget', now)
    now += 29_999
    expect(limits.check('fetch')).toEqual({ ok: true })
    now += 1
    expect(limits.check('fetch')).toMatchObject({ ok: false, reason: 'budget' })
  })

  it('indicador liga/desliga e auditoria não guarda conteúdo', async () => {
    const activity: Array<{ active: boolean; kind: string }> = []
    const audit: SearchAuditEvent[] = []
    const limits = createSearchTurnLimits({ now: () => 1_000 })
    limits.beginTurn('req-indicator', 1_000)
    const handler = createFetchUrlHandler({
      isEnabled: () => true,
      fetchPage: async () => page,
      limits,
      onActivity: (active, kind) => activity.push({ active, kind }),
      audit: (event) => audit.push(event)
    })

    await handler({ url: 'https://example.test/artigo' })

    expect(activity).toEqual([
      { active: true, kind: 'fetch' },
      { active: false, kind: 'fetch' }
    ])
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ kind: 'fetch', host: 'example.test', bytes: 100, ok: true })
    expect(JSON.stringify(audit[0])).not.toContain('Conteúdo suficiente')
  })

  it('desligado não registra ferramenta nem abre página', async () => {
    const fetchPage = vi.fn()
    const entries = createWebToolEntries({
      enabled: false,
      fetchUrl: { isEnabled: () => false, fetchPage }
    })
    expect(entries).toEqual([])

    const handler = createFetchUrlHandler({ isEnabled: () => false, fetchPage })
    await expect(handler({ url: 'https://example.test/a' })).rejects.toThrow('desligada')
    expect(fetchPage).not.toHaveBeenCalled()
  })
})
