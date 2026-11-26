import { describe, expect, it } from 'vitest'
import { GeminiClient, normalizeGroundedSources } from './client'
import { GeminiError } from './errors'
import { FakeTransport } from './testing/fakeTransport'

function createClient(transport: FakeTransport): GeminiClient {
  return new GeminiClient({
    transport,
    retry: { maxAttempts: 2, baseDelayMs: 1, random: () => 0 },
    sleep: async () => undefined,
    groundedBase: () => ({
      apiKey: 'test-key',
      model: 'gemini-2.0-flash',
      temperature: 0.2
    })
  })
}

describe('busca com grounding', () => {
  it('extrai 3 fontes da metadata e ativa googleSearch', async () => {
    const transport = new FakeTransport({
      generateSteps: [
        {
          text: 'Resposta com fatos verificáveis.',
          groundingChunks: [
            { uri: 'https://a.example/noticia', title: 'Notícia A' },
            { uri: 'https://b.example/artigo', title: 'Artigo B' },
            { uri: 'https://c.example/dados', title: 'Dados C' }
          ]
        }
      ]
    })
    const result = await createClient(transport).groundedSearch({ query: 'satélites' })

    expect(result.text).toContain('fatos verificáveis')
    expect(result.sources).toEqual([
      { title: 'Notícia A', url: 'https://a.example/noticia' },
      { title: 'Artigo B', url: 'https://b.example/artigo' },
      { title: 'Dados C', url: 'https://c.example/dados' }
    ])
    expect(transport.requests[0]).toMatchObject({
      googleSearch: true,
      model: 'gemini-2.0-flash'
    })
    expect(transport.requests[0]?.contents.at(-1)?.text).toBe('satélites')
  })

  it('deduplica URL (inclusive fragmento) e limita a 8', async () => {
    const chunks = [
      { uri: 'https://a.example/x#topo', title: 'Primeira' },
      { uri: 'https://a.example/x#outra', title: 'Duplicada' },
      { uri: 'https://b.example/y', title: 'Segunda' },
      { uri: 'ftp://arquivo.example/z', title: 'Esquema inválido' },
      ...Array.from({ length: 9 }, (_, index) => ({
        uri: `https://fonte${index}.example/p`,
        title: `Fonte ${index}`
      }))
    ]
    const transport = new FakeTransport({
      generateSteps: [{ text: 'ok', groundingChunks: chunks }]
    })
    const result = await createClient(transport).groundedSearch({ query: 'x' })

    expect(result.sources).toHaveLength(8)
    expect(result.sources[0]).toEqual({ title: 'Primeira', url: 'https://a.example/x' })
    expect(result.sources.filter((source) => source.url === 'https://a.example/x')).toHaveLength(1)
    expect(result.sources.some((source) => source.url.startsWith('ftp:'))).toBe(false)
    expect(normalizeGroundedSources(chunks, 2)).toHaveLength(2)
  })

  it('sem metadata de grounding devolve lista vazia', async () => {
    const transport = new FakeTransport({ generateSteps: [{ text: 'Resposta sem fontes.' }] })
    const result = await createClient(transport).groundedSearch({ query: 'sem fontes' })

    expect(result.sources).toEqual([])
    expect(result.text).toBe('Resposta sem fontes.')
  })

  it('erro de cota propaga kind quota', async () => {
    const transport = new FakeTransport({ generateErrors: [{ status: 429 }] })
    await expect(createClient(transport).groundedSearch({ query: 'cota' })).rejects.toMatchObject({
      name: 'GeminiError',
      kind: 'quota'
    })
    await expect(createClient(transport).groundedSearch({ query: 'cota' })).rejects.toBeInstanceOf(
      GeminiError
    )
  })
})
