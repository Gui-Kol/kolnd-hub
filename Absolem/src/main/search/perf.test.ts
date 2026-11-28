import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { UrlValidation } from './validateUrl'
import { SearchCache, normalizeCacheKey } from './cache'
import { extractReadable } from './extract'
import { fetchPage, type FetchPageDeps, type FetchedPage } from './fetchPage'
import { createFetchUrlHandler } from './tools'

/**
 * Perfil local da pesquisa (task 07/T1).
 *
 * Não roda no `npm test` normal: use `SEARCH_BENCH=1` para executar.
 *
 * Mede SOMENTE fixtures locais e um `fetch`/DNS falsos com atraso determinístico.
 * Não há rede, chave, URL real nem gravação de página em disco. Os números
 * separam validação (DNS), conexão/primeiro byte, leitura/extração, cache hit e
 * evicção para indicar onde otimizar.
 *
 * Variáveis:
 * - `SEARCH_BENCH=1` ativa o perfil;
 * - `SEARCH_BENCH_SAMPLES=40` define as amostras por cenário.
 */

const BENCH = process.env.SEARCH_BENCH === '1'
const SAMPLES = Math.max(5, Number(process.env.SEARCH_BENCH_SAMPLES ?? 40) || 40)

const FIXTURE = readFileSync(
  new URL('../../../tests/fixtures/html/long.html', import.meta.url),
  'utf8'
)
const URL_OK = 'https://example.test/artigo'
const URL_KEY = normalizeCacheKey(URL_OK) as string

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

function summary(values: readonly number[]): { p50: number; p95: number; max: number } {
  return {
    p50: Number(percentile(values, 50).toFixed(3)),
    p95: Number(percentile(values, 95).toFixed(3)),
    max: Number(Math.max(...values).toFixed(3))
  }
}

// DNS falso: atraso fixo de 1 ms, sem resolver nada de verdade.
const validate: FetchPageDeps['validate'] = async (raw): Promise<UrlValidation> => {
  await delay(1)
  try {
    const url = new URL(raw)
    if (url.hostname !== 'example.test') {
      return { ok: false, reason: 'private-ip', message: 'fora da fixture' }
    }
    return { ok: true, url }
  } catch {
    return { ok: false, reason: 'invalid', message: 'URL inválida.' }
  }
}

// Conexão/primeiro byte falsos: 3 ms antes da Response; corpo da fixture real.
const fakeFetch: FetchPageDeps['fetchImpl'] = async () => {
  await delay(3)
  return new Response(FIXTURE, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  })
}

describe.skipIf(!BENCH)('perfil local da pesquisa (fixtures e fetch falso)', () => {
  it('mede fases, cache e evicção e imprime SEARCH_BENCH_JSON', async () => {
    const fetchPhase: number[] = []
    const totalFetch: number[] = []
    const extractPhase: number[] = []
    const handlerTotal: number[] = []

    const handler = createFetchUrlHandler({
      isEnabled: () => true,
      fetchPage: (url) => fetchPage(url, { validate, fetchImpl: fakeFetch })
    })

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()
      const response = await fakeFetch(URL_OK, { method: 'GET' })
      fetchPhase.push(performance.now() - started)
      await response.arrayBuffer()
    }

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()
      const page = await fetchPage(URL_OK, { validate, fetchImpl: fakeFetch })
      totalFetch.push(performance.now() - started)
      const extractStarted = performance.now()
      extractReadable(page.body, page.finalUrl)
      extractPhase.push(performance.now() - extractStarted)
    }

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()
      await handler({ url: URL_OK })
      handlerTotal.push(performance.now() - started)
    }

    // Extração cresce com o HTML: mede 25 KB (fixture) e 2 MB (teto do fetch).
    const extractionScaling: Array<{ bytes: number; ms: number }> = []
    for (const targetBytes of [Buffer.byteLength(FIXTURE), 250 * 1024, 2 * 1024 * 1024]) {
      const paragraph = `<p>${'conteudo de teste '.repeat(20)}</p>`
      const html = `<html><body><article>${paragraph.repeat(
        Math.ceil(targetBytes / paragraph.length)
      )}</article></body></html>`
      const started = performance.now()
      extractReadable(html, URL_OK)
      extractionScaling.push({
        bytes: Buffer.byteLength(html),
        ms: Number((performance.now() - started).toFixed(3))
      })
    }

    const cache = new SearchCache<string>()
    cache.set(URL_KEY, FIXTURE)
    const cacheHits: number[] = []
    for (let index = 0; index < SAMPLES * 10; index += 1) {
      const started = performance.now()
      const hit = cache.get(URL_KEY)
      cacheHits.push(performance.now() - started)
      expect(hit).toBe(FIXTURE)
    }

    const missCache = new SearchCache<string>({ maxEntries: 50 })
    const cacheMisses: number[] = []
    for (let index = 0; index < SAMPLES * 10; index += 1) {
      const key = `https://example.test/miss-${index}`
      const started = performance.now()
      const miss = missCache.get(key)
      missCache.set(key, 'x')
      cacheMisses.push(performance.now() - started)
      expect(miss).toBeNull()
    }

    const evictionCache = new SearchCache<string>({ maxEntries: 50 })
    const evictionStarted = performance.now()
    for (let index = 0; index < 500; index += 1) {
      evictionCache.set(`https://example.test/evict-${index}`, 'x')
    }
    const evictionTotal = performance.now() - evictionStarted

    // Duplicata concorrente: hoje cada chamada dispara seu próprio fetch.
    let duplicateCalls = 0
    const duplicateFetch: FetchPageDeps['fetchImpl'] = async () => {
      duplicateCalls += 1
      await delay(4)
      return new Response(FIXTURE, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }
    const duplicateStarted = performance.now()
    const duplicates = await Promise.all(
      Array.from({ length: 5 }, () => fetchPage(URL_OK, { validate, fetchImpl: duplicateFetch }))
    )
    const duplicateMs = performance.now() - duplicateStarted

    // Depois da coalescência: as mesmas 5 chamadas compartilham um loader.
    const coalescedCache = new SearchCache<FetchedPage>()
    let coalescedLoads = 0
    const coalescedStarted = performance.now()
    const coalescedPages = await Promise.all(
      Array.from({ length: 5 }, () =>
        coalescedCache.getOrLoad(URL_KEY, async () => {
          coalescedLoads += 1
          await delay(4)
          return {
            finalUrl: URL_OK,
            status: 200,
            contentType: 'text/html',
            body: FIXTURE,
            bytes: Buffer.byteLength(FIXTURE)
          }
        })
      )
    )
    const coalescedMs = performance.now() - coalescedStarted

    const output = {
      samples: SAMPLES,
      fixtureBytes: Buffer.byteLength(FIXTURE),
      dnsValidateMs: summary([1]),
      connectFirstByteMs: summary(fetchPhase),
      fetchAndReadMs: summary(totalFetch),
      extractMs: summary(extractPhase),
      extractionScaling,
      fetchUrlHandlerMs: summary(handlerTotal),
      cacheHitUs: summary(cacheHits.map((value) => value * 1000)),
      cacheMissInsertUs: summary(cacheMisses.map((value) => value * 1000)),
      eviction500TotalMs: Number(evictionTotal.toFixed(3)),
      duplicate: {
        concurrent: 5,
        fetches: duplicateCalls,
        elapsedMs: Number(duplicateMs.toFixed(3)),
        pages: duplicates.length
      },
      coalesced: {
        concurrent: 5,
        loads: coalescedLoads,
        elapsedMs: Number(coalescedMs.toFixed(3)),
        pages: coalescedPages.length,
        cachedEntries: coalescedCache.snapshot().entries,
        stats: coalescedCache.stats()
      },
      cacheAfterEviction: evictionCache.snapshot()
    }

    // eslint-disable-next-line no-console -- o perfil imprime o JSON para o relatório
    console.log(`SEARCH_BENCH_JSON ${JSON.stringify(output)}`)
    expect(output.duplicate.pages).toBe(5)
    expect(output.cacheAfterEviction.entries).toBe(50)
  })
})
