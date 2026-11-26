import type { UrlValidation } from './validateUrl'

/**
 * Busca HTTP segura (task 10, T2).
 *
 * Regras fechadas:
 * - apenas `http`/`https`, validados antes de cada requisição;
 * - timeout total de 10 s por requisição;
 * - no máximo 3 redirecionamentos, cada destino revalidado (302 para host
 *   privado é recusado);
 * - corpo máximo de 2 MB, medido enquanto lê (não confia só no header);
 * - somente `text/html`, `text/plain`, `application/xhtml+xml` e
 *   `application/json` (JSON é tratado como texto);
 * - `User-Agent` identifica o Absolem e a versão.
 *
 * `fetchImpl` e `validate` são injetados: os testes usam um servidor HTTP
 * local e um validador que libera apenas esse servidor, sem tocar a internet.
 */

export const FETCH_TIMEOUT_MS = 10_000
export const FETCH_MAX_BYTES = 2 * 1024 * 1024
export const FETCH_MAX_REDIRECTS = 3
export const ABSOLEM_USER_AGENT = 'Absolem/0.1.0 (Windows; +https://github.com/kolnd/absolem)'

export const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'application/xhtml+xml',
  'application/json'
] as const

export type FetchFailureCode =
  | 'invalid-url'
  | 'ssrf'
  | 'timeout'
  | 'network'
  | 'http'
  | 'content-type'
  | 'too-large'
  | 'redirects'

export class FetchPageError extends Error {
  readonly code: FetchFailureCode
  readonly status?: number

  constructor(code: FetchFailureCode, message: string, status?: number) {
    super(message)
    this.name = 'FetchPageError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

export interface FetchedPage {
  finalUrl: string
  status: number
  contentType: string
  body: string
  bytes: number
}

export interface FetchPageDeps {
  /** Validação SSRF; é chamada para a URL inicial e para cada redirect. */
  validate: (url: string) => Promise<UrlValidation>
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>
  timeoutMs?: number
  maxBytes?: number
  userAgent?: string
}

function validationFailure(validation: Extract<UrlValidation, { ok: false }>): FetchPageError {
  if (validation.reason === 'protocol' || validation.reason === 'invalid') {
    return new FetchPageError('invalid-url', validation.message)
  }
  if (validation.reason === 'dns') {
    return new FetchPageError('network', validation.message)
  }
  return new FetchPageError('ssrf', validation.message)
}

function mimeType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

async function readBodyCapped(
  response: Response,
  maxBytes: number
): Promise<{ bytes: number; body: string }> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined)
          throw new FetchPageError(
            'too-large',
            `A página passa do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`
          )
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock?.()
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { bytes: total, body: new TextDecoder('utf-8').decode(merged) }
  }

  const buffer = await response.arrayBuffer()
  const bytes = buffer.byteLength
  if (bytes > maxBytes) {
    throw new FetchPageError(
      'too-large',
      `A página passa do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`
    )
  }
  return { bytes, body: new TextDecoder('utf-8').decode(buffer) }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

export async function fetchPage(rawUrl: string, deps: FetchPageDeps): Promise<FetchedPage> {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = deps.maxBytes ?? FETCH_MAX_BYTES
  const userAgent = deps.userAgent ?? ABSOLEM_USER_AGENT
  let current = rawUrl
  let redirects = 0

  for (;;) {
    const validation = await deps.validate(current)
    if (!validation.ok) throw validationFailure(validation)
    current = validation.url.toString()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let response: Response
      try {
        response = await deps.fetchImpl(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.1'
          }
        })
      } catch (err) {
        if (controller.signal.aborted) {
          throw new FetchPageError('timeout', `A página demorou mais de ${timeoutMs / 1000} s.`)
        }
        throw new FetchPageError(
          'network',
          err instanceof Error
            ? `Falha de rede ao abrir a página: ${err.message.slice(0, 200)}`
            : 'Falha de rede ao abrir a página.'
        )
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        if (!location) {
          throw new FetchPageError('http', 'Redirecionamento sem destino.', response.status)
        }
        redirects += 1
        if (redirects > FETCH_MAX_REDIRECTS) {
          throw new FetchPageError(
            'redirects',
            `A página redireciona mais de ${FETCH_MAX_REDIRECTS} vezes.`
          )
        }
        let next: string
        try {
          next = new URL(location, current).toString()
        } catch {
          throw new FetchPageError(
            'http',
            'Redirecionamento com destino inválido.',
            response.status
          )
        }
        current = next
        continue
      }

      if (response.status < 200 || response.status >= 300) {
        throw new FetchPageError(
          'http',
          `A página respondeu com status ${response.status}.`,
          response.status
        )
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(mimeType(contentType))) {
        throw new FetchPageError(
          'content-type',
          `Tipo de conteúdo não permitido: ${mimeType(contentType) || '(ausente)'}.`
        )
      }

      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new FetchPageError(
          'too-large',
          `A página passa do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`
        )
      }

      const { bytes, body } = await readBodyCapped(response, maxBytes)
      return {
        finalUrl: current,
        status: response.status,
        contentType: mimeType(contentType),
        body,
        bytes
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
