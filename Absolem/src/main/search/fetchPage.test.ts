import { createServer, type Server } from 'node:http'
import { isIP } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FETCH_MAX_BYTES, fetchPage, type FetchPageDeps } from './fetchPage'
import { validateUrl, type UrlValidation } from './validateUrl'

describe('fetchPage contra SSRF e limites', () => {
  let server: Server
  let base: string
  let lastUserAgent = ''

  beforeAll(async () => {
    server = createServer((request, response) => {
      lastUserAgent = String(request.headers['user-agent'] ?? '')
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      switch (url.pathname) {
        case '/ok':
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          response.end(
            '<html><body><article><p>Conteúdo local de teste.</p></article></body></html>'
          )
          return
        case '/r1':
          response.writeHead(302, { location: '/r2' })
          response.end()
          return
        case '/r2':
          response.writeHead(302, { location: '/r3' })
          response.end()
          return
        case '/r3':
          response.writeHead(302, { location: '/ok' })
          response.end()
          return
        case '/r4':
          response.writeHead(302, { location: '/r1' })
          response.end()
          return
        case '/private':
          response.writeHead(302, { location: 'http://10.0.0.1/segredo' })
          response.end()
          return
        case '/large':
          response.writeHead(200, { 'content-type': 'text/html' })
          response.end(`<html><body>${'a'.repeat(FETCH_MAX_BYTES + 10)}</body></html>`)
          return
        case '/csv':
          response.writeHead(200, { 'content-type': 'text/csv' })
          response.end('a,b\n1,2')
          return
        default:
          response.writeHead(404, { 'content-type': 'text/html' })
          response.end('não encontrado')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('servidor de teste sem porta')
    base = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    )
  })

  // Validador dos testes de fetch: libera SÓ o servidor local desta suíte.
  const allowLocal: FetchPageDeps['validate'] = async (raw): Promise<UrlValidation> => {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return { ok: false, reason: 'invalid', message: 'URL inválida.' }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, reason: 'protocol', message: 'protocolo recusado' }
    }
    if (url.hostname !== '127.0.0.1' || url.port !== new URL(base).port) {
      return { ok: false, reason: 'private-ip', message: 'fora do servidor de teste' }
    }
    return { ok: true, url }
  }

  it('bloqueia 127.0.0.1 antes da rede', async () => {
    const fetchImpl = vi.fn()
    await expect(
      fetchPage('http://127.0.0.1/', {
        validate: (url) => validateUrl(url),
        fetchImpl: fetchImpl as unknown as FetchPageDeps['fetchImpl']
      })
    ).rejects.toMatchObject({ code: 'ssrf' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('bloqueia host que resolve para 10.x (DNS injetado)', async () => {
    const result = await validateUrl('http://interno.example.test/', {
      lookup: async () => [{ address: '10.1.2.3', family: 4 }],
      isIP
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('private-ip')
  })

  it('segue no máximo 3 redirects e devolve a URL final', async () => {
    const page = await fetchPage(`${base}/r1`, {
      validate: allowLocal,
      fetchImpl: (input, init) => fetch(input, init)
    })
    expect(page.status).toBe(200)
    expect(page.finalUrl).toBe(`${base}/ok`)
    expect(page.body).toContain('Conteúdo local de teste.')
    expect(lastUserAgent.startsWith('Absolem/')).toBe(true)

    await expect(
      fetchPage(`${base}/r4`, {
        validate: allowLocal,
        fetchImpl: (input, init) => fetch(input, init)
      })
    ).rejects.toMatchObject({ code: 'redirects' })
  })

  it('recusa redirecionamento para host privado', async () => {
    await expect(
      fetchPage(`${base}/private`, {
        validate: allowLocal,
        fetchImpl: (input, init) => fetch(input, init)
      })
    ).rejects.toMatchObject({ code: 'ssrf' })
  })

  it('recusa corpo maior que 2 MB', async () => {
    await expect(
      fetchPage(`${base}/large`, {
        validate: allowLocal,
        fetchImpl: (input, init) => fetch(input, init)
      })
    ).rejects.toMatchObject({ code: 'too-large' })
  })

  it('recusa content-type não permitido', async () => {
    await expect(
      fetchPage(`${base}/csv`, {
        validate: allowLocal,
        fetchImpl: (input, init) => fetch(input, init)
      })
    ).rejects.toMatchObject({ code: 'content-type' })
  })

  it('timeout também cobre DNS/validação que não responde', async () => {
    const fetchImpl = vi.fn()
    const started = Date.now()

    await expect(
      fetchPage('https://example.test/lento', {
        validate: () => new Promise<UrlValidation>(() => undefined),
        fetchImpl: fetchImpl as unknown as FetchPageDeps['fetchImpl'],
        timeoutMs: 25
      })
    ).rejects.toMatchObject({ code: 'timeout' })

    expect(Date.now() - started).toBeLessThan(2_000)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sinal já cancelado não toca a rede', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn()

    await expect(
      fetchPage(`${base}/ok`, {
        validate: allowLocal,
        fetchImpl: fetchImpl as unknown as FetchPageDeps['fetchImpl'],
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('cancelamento no meio do corpo interrompe a leitura e libera o stream', async () => {
    const controller = new AbortController()
    let pulls = 0
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        pulls += 1
        await new Promise((resolve) => setTimeout(resolve, 2))
        try {
          streamController.enqueue(new TextEncoder().encode(`<p>${pulls}</p>`))
        } catch {
          // O leitor cancelou entre o atraso e o enqueue.
        }
      },
      cancel() {
        cancelled = true
      }
    })

    const promise = fetchPage(`${base}/stream`, {
      validate: allowLocal,
      fetchImpl: async () =>
        new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }),
      signal: controller.signal
    })

    await new Promise((resolve) => setTimeout(resolve, 15))
    controller.abort()

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' })
    const pullsAtAbort = pulls
    expect(cancelled).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pulls).toBe(pullsAtAbort)
  })

  it('timeout durante a leitura do corpo não deixa a promise pendurada', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('<html>'))
        // Nunca fecha: simula servidor que trava no meio do corpo.
      }
    })

    await expect(
      fetchPage(`${base}/travado`, {
        validate: allowLocal,
        fetchImpl: async () =>
          new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }),
        timeoutMs: 30
      })
    ).rejects.toMatchObject({ code: 'timeout' })
  })
})

describe('validator real de URL', () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://localhost/',
    'http://impressora.local/',
    'file:///C:/Windows/win.ini',
    'http://usuario:senha@example.com/'
  ]

  it.each(blocked)('recusa %s', async (url) => {
    const result = await validateUrl(url)
    expect(result.ok).toBe(false)
  })

  it('aceita host público que resolve para endereço público', async () => {
    const result = await validateUrl('https://example.com/noticia', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      isIP
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url.hostname).toBe('example.com')
  })
})
