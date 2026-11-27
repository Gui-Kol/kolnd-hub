import { describe, expect, it, vi } from 'vitest'
import {
  YOUTUBE_SEARCH_TIMEOUT_MS,
  YoutubeSearchError,
  buildYoutubeSearchUrl,
  extractInitialData,
  parseYoutubeSearch,
  pickYoutubeVideo,
  resolveYoutubeVideo,
  watchUrl,
  youtubeSearchQueryFromUrl
} from './search'

/**
 * Fixture compacta no formato real da página de resultados: `var ytInitialData
 * = {...};` com três `videoRenderer`. O episódio 400 é o segundo, para provar
 * que a escolha não depende só da posição.
 */

const EPISODE_400 = {
  videoRenderer: {
    videoId: 'oDVH4HnGByU',
    title: {
      runs: [
        {
          text: 'O Esconderijo da Casa Automática - Minecraft Em busca da casa automática #400'
        }
      ]
    },
    ownerText: { runs: [{ text: 'viniccius13' }] },
    lengthText: { simpleText: '1:34:56' }
  }
}

function searchData(): Record<string, unknown> {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    {
                      videoRenderer: {
                        videoId: 'aaaaaaaaaaa',
                        title: { runs: [{ text: 'Casa automática: tour completo } com aspas' }] },
                        ownerText: { runs: [{ text: 'Canal Teste' }] },
                        lengthText: { simpleText: '10:01' }
                      }
                    },
                    EPISODE_400,
                    {
                      videoRenderer: {
                        videoId: 'bbbbbbbbbbb',
                        title: { runs: [{ text: 'Episódio 400 de outra série' }] },
                        ownerText: { runs: [{ text: 'Outro Canal' }] },
                        lengthText: { simpleText: '22:10' }
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  }
}

function fixtureHtml(): string {
  return [
    '<!doctype html><html><head><script>var keep = 1;</script></head><body>',
    `<script>var ytInitialData = ${JSON.stringify(searchData())};</script>`,
    '</body></html>'
  ].join('')
}

describe('buildYoutubeSearchUrl', () => {
  it('monta a busca em pt-BR com a query codificada', () => {
    const url = new URL(buildYoutubeSearchUrl('casa automatica episodio 400'))

    expect(url.origin + url.pathname).toBe('https://www.youtube.com/results')
    expect(url.searchParams.get('search_query')).toBe('casa automatica episodio 400')
    expect(url.searchParams.get('hl')).toBe('pt-BR')
    expect(url.searchParams.get('gl')).toBe('BR')
    expect(url.toString()).toContain('search_query=casa+automatica+episodio+400')
  })
})

describe('extractInitialData', () => {
  it('extrai o JSON ignorando chaves e escapes dentro de strings', () => {
    const html = [
      '<script>window.__x = "ytInitialData = {ignorado}";</script>',
      '<script>var ytInitialData = {"a":{"b":"} e \\"aspas\\""},"c":[1,2]};</script>'
    ].join('')

    expect(extractInitialData(html)).toEqual({ a: { b: '} e "aspas"' }, c: [1, 2] })
  })

  it('recusa HTML sem ytInitialData', () => {
    expect(() => extractInitialData('<html>sem dados</html>')).toThrow(YoutubeSearchError)
    try {
      extractInitialData('<html>sem dados</html>')
    } catch (error) {
      expect((error as YoutubeSearchError).code).toBe('parse')
    }
  })
})

describe('parseYoutubeSearch', () => {
  it('lê videoId, título, canal e duração na ordem da página', () => {
    const results = parseYoutubeSearch(fixtureHtml())

    expect(results.map((video) => video.videoId)).toEqual([
      'aaaaaaaaaaa',
      'oDVH4HnGByU',
      'bbbbbbbbbbb'
    ])
    expect(results[1]).toEqual({
      videoId: 'oDVH4HnGByU',
      title: 'O Esconderijo da Casa Automática - Minecraft Em busca da casa automática #400',
      channel: 'viniccius13',
      length: '1:34:56'
    })
  })
})

describe('pickYoutubeVideo', () => {
  it('prioriza título com os termos e o número do episódio', () => {
    const results = parseYoutubeSearch(fixtureHtml())
    const picked = pickYoutubeVideo(results, 'casa automatica episodio 400')

    expect(picked?.videoId).toBe('oDVH4HnGByU')
  })

  it('sem nenhum termo em comum, devolve o primeiro resultado', () => {
    const results = parseYoutubeSearch(fixtureHtml())

    expect(pickYoutubeVideo(results, 'receita de bolo')?.videoId).toBe('aaaaaaaaaaa')
    expect(pickYoutubeVideo([], 'qualquer coisa')).toBeNull()
  })

  it('números pesam mais que termos genéricos', () => {
    const results = [
      { videoId: 'ccccccccccc', title: 'Casa automática #399', channel: 'x', length: '' },
      { videoId: 'ddddddddddd', title: 'Casa automática #400', channel: 'x', length: '' }
    ]

    expect(pickYoutubeVideo(results, 'casa automatica 400')?.videoId).toBe('ddddddddddd')
  })

  it('com os mesmos termos e número, o primeiro resultado vence', () => {
    // Formato real da busca: o episódio 400 canônico vem no topo e outro vídeo
    // com "Episódio 400" no título vem depois; a ordem do YouTube desempata.
    const results = [
      {
        videoId: 'oDVH4HnGByU',
        title: 'O Esconderijo da Casa Automática - Minecraft Em busca da casa automática #400',
        channel: 'viniccius13',
        length: '1:34:56'
      },
      {
        videoId: 'jHx6IqysZ0c',
        title: 'O Episódio 400 foi abduzido - Minecraft Em busca da casa automática #',
        channel: 'viniccius13',
        length: '43:26'
      }
    ]

    expect(pickYoutubeVideo(results, 'casa automatica episodio 400')?.videoId).toBe('oDVH4HnGByU')
  })
})

describe('youtubeSearchQueryFromUrl', () => {
  it('reconhece /results nos hosts do YouTube e devolve a query trimada', () => {
    expect(
      youtubeSearchQueryFromUrl(
        'https://www.youtube.com/results?search_query=casa+automatica+episodio+400&hl=pt-BR'
      )
    ).toBe('casa automatica episodio 400')
    expect(
      youtubeSearchQueryFromUrl('https://youtube.com/results/?search_query=%20ep%20400%20')
    ).toBe('ep 400')
    expect(youtubeSearchQueryFromUrl('http://m.youtube.com/results?search_query=x')).toBe('x')
  })

  it('ignora watch, host parecido, /results sem query e esquema não web', () => {
    expect(youtubeSearchQueryFromUrl('https://www.youtube.com/watch?v=oDVH4HnGByU')).toBeNull()
    expect(
      youtubeSearchQueryFromUrl('https://youtube.com.evil.example/results?search_query=x')
    ).toBeNull()
    expect(youtubeSearchQueryFromUrl('https://notyoutube.com/results?search_query=x')).toBeNull()
    expect(youtubeSearchQueryFromUrl('https://www.youtube.com/results')).toBeNull()
    expect(
      youtubeSearchQueryFromUrl('https://www.youtube.com/results?search_query=%20%20')
    ).toBeNull()
    expect(youtubeSearchQueryFromUrl('javascript:alert(1)')).toBeNull()
    expect(youtubeSearchQueryFromUrl('   ')).toBeNull()
  })
})

describe('resolveYoutubeVideo', () => {
  const emptyHtml = `<script>var ytInitialData = ${JSON.stringify({ contents: {} })};</script>`
  const noSleep = async (): Promise<void> => undefined

  it('pesquisa, escolhe o episódio 400 e devolve a URL de watch', async () => {
    const fetchImpl = vi.fn(async () => new Response(fixtureHtml(), { status: 200 }))
    const resolved = await resolveYoutubeVideo('casa automatica episodio 400', { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [requested, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(requested).toContain('search_query=casa+automatica+episodio+400')
    expect((init.headers as Record<string, string>)['user-agent']).toMatch(/Mozilla/)
    expect((init.headers as Record<string, string>)['accept-language']).toContain('pt-BR')
    expect(resolved).toEqual({
      videoId: 'oDVH4HnGByU',
      title: EPISODE_400.videoRenderer.title.runs[0]?.text,
      channel: 'viniccius13',
      length: '1:34:56',
      url: 'https://www.youtube.com/watch?v=oDVH4HnGByU'
    })
    expect(watchUrl('oDVH4HnGByU')).toBe(resolved.url)
  })

  it('repete uma vez quando a página vem vazia e resolve na segunda tentativa', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(emptyHtml))
      .mockResolvedValueOnce(new Response(fixtureHtml()))
    const sleep = vi.fn(noSleep)

    const resolved = await resolveYoutubeVideo('casa automatica episodio 400', {
      fetchImpl,
      sleep
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(250)
    expect(resolved.videoId).toBe('oDVH4HnGByU')
    expect(resolved.url).toBe('https://www.youtube.com/watch?v=oDVH4HnGByU')
  })

  it('não repete mais de uma vez quando a segunda tentativa também vem vazia', async () => {
    const fetchImpl = vi.fn(async () => new Response(emptyHtml))
    const sleep = vi.fn(noSleep)

    await expect(
      resolveYoutubeVideo('casa automatica episodio 400', { fetchImpl, sleep })
    ).rejects.toMatchObject({ code: 'empty' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('devolve erro claro quando não há vídeo (sem abrir a busca)', async () => {
    await expect(
      resolveYoutubeVideo('nada aqui', {
        fetchImpl: async () => new Response(emptyHtml),
        sleep: noSleep
      })
    ).rejects.toMatchObject({ code: 'empty' })
    await expect(
      resolveYoutubeVideo('nada aqui', {
        fetchImpl: async () => new Response(emptyHtml),
        sleep: noSleep
      })
    ).rejects.toThrow(/Nenhum vídeo encontrado/)
  })

  it('recusa HTML sem ytInitialData sem retentar', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>indisponível</html>'))

    await expect(resolveYoutubeVideo('casa automatica', { fetchImpl })).rejects.toMatchObject({
      code: 'parse'
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('recusa status HTTP de erro e reporta o código, sem retentar', async () => {
    const fetchImpl = vi.fn(async () => new Response('bloqueado', { status: 429 }))

    await expect(resolveYoutubeVideo('casa automatica', { fetchImpl })).rejects.toMatchObject({
      code: 'http',
      status: 429
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('respeita o timeout sem deixar a promise pendurada', async () => {
    const fetchImpl = (_input: string, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    await expect(
      resolveYoutubeVideo('casa automatica', { fetchImpl, timeoutMs: 10 })
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(YOUTUBE_SEARCH_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('valida o tamanho da query antes de pesquisar', async () => {
    const fetchImpl = vi.fn(async () => new Response(''))

    await expect(resolveYoutubeVideo('', { fetchImpl })).rejects.toMatchObject({
      code: 'invalid-query'
    })
    await expect(resolveYoutubeVideo('x'.repeat(201), { fetchImpl })).rejects.toMatchObject({
      code: 'invalid-query'
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
