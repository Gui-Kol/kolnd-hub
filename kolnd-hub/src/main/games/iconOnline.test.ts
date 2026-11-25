import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearIconOnlineCache,
  diceCoefficient,
  fetchOnlineArtForGame,
  fetchSteamArt,
  fetchWikipediaCover,
  isAllowedOnlineHost,
  isHighConfidenceNameMatch,
  normalizeGameName,
  normalizeWikipediaThumbUrl,
  pickSteamSearchResult,
  searchSteamAppId,
  type OnlineFetch,
  type OnlineFetchResponse
} from './iconOnline'

function bytesOf(text: string): Buffer {
  return Buffer.from(text)
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(buffer.length)
  new Uint8Array(out).set(buffer)
  return out
}

function fakeResponse(
  body: Buffer | string,
  options: {
    status?: number
    contentType?: string
    contentLength?: number
    url?: string
  } = {}
): OnlineFetchResponse {
  const buffer = typeof body === 'string' ? bytesOf(body) : body
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    url: options.url,
    headers: {
      get: (name: string) => {
        if (name === 'content-type') return options.contentType ?? null
        if (name === 'content-length') {
          return options.contentLength !== undefined ? String(options.contentLength) : null
        }
        return null
      }
    },
    arrayBuffer: async () => toArrayBuffer(buffer),
    text: async () => buffer.toString('utf8')
  }
}

function imageResponse(text = 'PNG', contentType = 'image/png', url?: string): OnlineFetchResponse {
  return fakeResponse(bytesOf(text), { contentType, url })
}

function jsonResponse(value: unknown): OnlineFetchResponse {
  return fakeResponse(JSON.stringify(value), { contentType: 'application/json' })
}

beforeEach(() => {
  clearIconOnlineCache()
})

describe('normalização e similaridade', () => {
  it('normaliza acentos, marcas e pontuação', () => {
    expect(normalizeGameName('  The Binding of Isaac: Rebirth® ')).toBe(
      'the binding of isaac rebirth'
    )
    expect(normalizeGameName('Subnautica 2™')).toBe('subnautica 2')
    expect(normalizeGameName('Ação & Aventura!')).toBe('acao aventura')
  })

  it('Dice é 1 para iguais e 0 para vazio', () => {
    expect(diceCoefficient('Subnautica 2', 'subnautica-2')).toBe(1)
    expect(diceCoefficient('', 'x')).toBe(0)
    expect(diceCoefficient('', '')).toBe(1)
  })

  it('aceita variações do mesmo jogo e recusa DLC/sequência', () => {
    expect(
      isHighConfidenceNameMatch('The Binding of Isaac Rebirth', 'The Binding of Isaac: Rebirth')
    ).toBe(true)
    expect(isHighConfidenceNameMatch('Bodycam', 'Bodycam')).toBe(true)
    expect(isHighConfidenceNameMatch('Subnautica 2', 'Subnautica 2 - Soundtrack')).toBe(false)
    expect(isHighConfidenceNameMatch('Subnautica', 'Subnautica 2')).toBe(false)
    expect(isHighConfidenceNameMatch('Subnautica 2', 'Subnautica 2 Deluxe Edition')).toBe(true)
    expect(isHighConfidenceNameMatch('Rocket League', 'Rocket League Sideswipe')).toBe(false)
  })

  it('allowlist só aceita os quatro hosts', () => {
    expect(isAllowedOnlineHost('https://cdn.cloudflare.steamstatic.com/x.png')).toBe(true)
    expect(isAllowedOnlineHost('https://store.steampowered.com/api')).toBe(true)
    expect(isAllowedOnlineHost('https://en.wikipedia.org/w/api.php')).toBe(true)
    expect(isAllowedOnlineHost('https://upload.wikimedia.org/x.png')).toBe(true)
    expect(isAllowedOnlineHost('https://evil.example/x.png')).toBe(false)
    expect(isAllowedOnlineHost('não é url')).toBe(false)
  })

  it('normaliza thumb.wikimedia.org para upload.wikimedia.org', () => {
    expect(
      normalizeWikipediaThumbUrl(
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Cover.jpg/330px-Cover.jpg'
      )
    ).toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cover.jpg/330px-Cover.jpg')
    expect(normalizeWikipediaThumbUrl('https://evil.example/x.png')).toBeNull()
  })
})

describe('fetchSteamArt', () => {
  it('usa logo.png quando disponível e envia UA/accept', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: { headers?: Record<string, string> }) => {
      if (url.endsWith('/logo.png')) return imageResponse('LOGO')
      return fakeResponse('', { status: 404 })
    })
    const art = await fetchSteamArt(1962700, {
      fetchImpl: fetchImpl as OnlineFetch,
      userAgent: 'KolndHub/teste'
    })

    expect(art).toMatchObject({ ext: '.png', source: 'steam-cdn' })
    expect(art?.buffer.toString()).toBe('LOGO')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://cdn.cloudflare.steamstatic.com/steam/apps/1962700/logo.png')
    expect(init?.headers?.['user-agent']).toBe('KolndHub/teste')
  })

  it('cai para header.jpg quando logo falha', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/logo.png')) return fakeResponse('', { status: 404 })
      return imageResponse('HEADER', 'image/jpeg')
    })
    const art = await fetchSteamArt(250900, { fetchImpl: fetchImpl as OnlineFetch })

    expect(art).toMatchObject({ ext: '.jpg', source: 'steam-cdn' })
    expect(art?.buffer.toString()).toBe('HEADER')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('recusa content-type inválido, corpo vazio e tamanho acima de 4 MB', async () => {
    const invalids: OnlineFetchResponse[] = [
      fakeResponse('x', { contentType: 'text/html' }),
      fakeResponse(Buffer.alloc(0), { contentType: 'image/png' }),
      fakeResponse(bytesOf('x'), { contentType: 'image/png', contentLength: 4 * 1024 * 1024 + 1 }),
      fakeResponse(Buffer.alloc(4 * 1024 * 1024 + 1), { contentType: 'image/png' })
    ]
    for (const response of invalids) {
      clearIconOnlineCache()
      const fetchImpl = vi.fn(async () => response)
      await expect(fetchSteamArt(1, { fetchImpl: fetchImpl as OnlineFetch })).resolves.toBeNull()
    }
  })

  it('respeita timeout e devolve null', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<OnlineFetchResponse>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const started = Date.now()
    await expect(
      fetchSteamArt(1, { fetchImpl: fetchImpl as OnlineFetch, timeoutMs: 20 })
    ).resolves.toBeNull()
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('recusa redirect para host fora da allowlist', async () => {
    const fetchImpl = vi.fn(async () =>
      imageResponse('PNG', 'image/png', 'https://evil.example/x.png')
    )
    await expect(fetchSteamArt(1, { fetchImpl: fetchImpl as OnlineFetch })).resolves.toBeNull()
  })
})

describe('searchSteamAppId', () => {
  it('escolhe o appid com match alto e ignora DLC', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('l=portuguese&cc=BR')
      expect(url).toContain('term=Subnautica%202')
      return jsonResponse({
        items: [
          { id: 999, name: 'Subnautica 2 - Soundtrack', type: 'app' },
          { id: 1962700, name: 'Subnautica 2', type: 'app' }
        ]
      })
    })

    await expect(
      searchSteamAppId('Subnautica 2', { fetchImpl: fetchImpl as OnlineFetch })
    ).resolves.toBe(1962700)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('cacheia negativo e não repete a busca', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] }))
    expect(
      await searchSteamAppId('Rocket League', { fetchImpl: fetchImpl as OnlineFetch })
    ).toBeNull()
    expect(
      await searchSteamAppId('Rocket League', { fetchImpl: fetchImpl as OnlineFetch })
    ).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('deduplica chamadas concorrentes do mesmo nome', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [{ id: 42, name: 'Bodycam' }] }))
    const [a, b] = await Promise.all([
      searchSteamAppId('Bodycam', { fetchImpl: fetchImpl as OnlineFetch }),
      searchSteamAppId('Bodycam', { fetchImpl: fetchImpl as OnlineFetch })
    ])
    expect([a, b]).toEqual([42, 42])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('aceita id em string e recusa itens que não são app', () => {
    expect(
      pickSteamSearchResult('Bodycam', {
        items: [
          { id: '1', name: 'Bodycam', type: 'bundle' },
          { id: '2406770', name: 'Bodycam', type: 'app' }
        ]
      })
    ).toBe(2406770)
    expect(pickSteamSearchResult('Bodycam', { items: 'x' })).toBeNull()
    expect(pickSteamSearchResult('Bodycam', null)).toBeNull()
  })
})

describe('fetchWikipediaCover', () => {
  it('baixa o thumbnail permitido da Wikipédia (thumb → upload)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
        return jsonResponse({
          query: {
            pages: {
              '1': {
                thumbnail: {
                  source:
                    'https://thumb.wikimedia.org/wikipedia/commons/a/ab/Cover.jpg/330px-Cover.jpg'
                }
              }
            }
          }
        })
      }
      expect(url.startsWith('https://upload.wikimedia.org/')).toBe(true)
      return imageResponse('WIKI')
    })

    const art = await fetchWikipediaCover('Rocket League', {
      fetchImpl: fetchImpl as OnlineFetch
    })
    expect(art).toMatchObject({ ext: '.png', source: 'wikipedia' })
    expect(art?.buffer.toString()).toBe('WIKI')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('recusa thumbnail em host fora da allowlist sem baixar', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        query: { pages: { '1': { thumbnail: { source: 'https://evil.example/x.png' } } } }
      })
    )
    await expect(
      fetchWikipediaCover('Rocket League', { fetchImpl: fetchImpl as OnlineFetch })
    ).resolves.toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('fetchOnlineArtForGame', () => {
  it('appid conhecido vence e não faz busca por nome', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('storesearch')) throw new Error('não deveria buscar')
      return imageResponse('STEAM')
    })
    const art = await fetchOnlineArtForGame(
      { name: 'Subnautica 2', steamAppId: 1962700 },
      { fetchImpl: fetchImpl as OnlineFetch }
    )
    expect(art).toMatchObject({ source: 'steam-cdn' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sem appid, busca por nome e usa a CDN do appid encontrado', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('storesearch')) {
        return jsonResponse({ items: [{ id: 250900, name: 'The Binding of Isaac: Rebirth' }] })
      }
      if (url.endsWith('/logo.png')) return fakeResponse('', { status: 404 })
      return imageResponse('HEADER', 'image/jpeg')
    })
    const art = await fetchOnlineArtForGame(
      { name: 'The Binding of Isaac Rebirth' },
      { fetchImpl: fetchImpl as OnlineFetch }
    )
    expect(art).toMatchObject({ source: 'steam-search', ext: '.jpg' })
  })

  it('sem match na Steam cai para a Wikipédia', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('storesearch')) return jsonResponse({ items: [] })
      if (url.startsWith('https://en.wikipedia.org')) {
        return jsonResponse({
          query: {
            pages: { '1': { thumbnail: { source: 'https://upload.wikimedia.org/rl.png' } } }
          }
        })
      }
      return imageResponse('WIKI')
    })
    const art = await fetchOnlineArtForGame(
      { name: 'Rocket League' },
      { fetchImpl: fetchImpl as OnlineFetch }
    )
    expect(art).toMatchObject({ source: 'wikipedia' })
  })
})
