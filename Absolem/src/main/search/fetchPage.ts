import type { UrlValidation } from './validateUrl'

/**
 * Busca HTTP segura (task 10, T2; cancelamento e timeout da task 07, T2).
 *
 * Regras fechadas:
 * - apenas `http`/`https`, validados antes de cada requisição;
 * - timeout total de 10 s por requisição, INCLUINDO a resolução de DNS;
 * - cancelamento externo (`signal`) interrompe a leitura e libera a conexão;
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
// User-Agent identifica o Absolem sem fixar versão; nada de versão hardcoded em src/
// (fonte única da versão: Absolem/package.json). Ver teste src/shared/version.test.ts.
export const ABSOLEM_USER_AGENT = 'Absolem/unknown (Windows; +https://github.com/Gui-Kol/kolnd-hub)'

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
  | 'cancelled'
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
  /** Cancelamento externo (turno substituído, timeout do roteador ou desligar). */
  signal?: AbortSignal
}

/** Sentinela interna: o chamador abortou ou o timeout venceu. */
class RequestAborted extends Error {
  constructor() {
    super('requisição abortada')
    this.name = 'RequestAborted'
  }
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

/** Corrida entre a promise e o sinal; não deixa a promise original pendurada. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new RequestAborted())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new RequestAborted())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<{ bytes: number; body: string }> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    const onAbort = (): void => {
      void reader.cancel().catch(() => undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      for (;;) {
        if (signal.aborted) throw new RequestAborted()
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
      if (signal.aborted) throw new RequestAborted()
    } finally {
      signal.removeEventListener('abort', onAbort)
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

  const buffer = await abortable(response.arrayBuffer(), signal)
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

/** Descarta o corpo de resposta que não vai ser usado (redirect/erro). */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Corpo já consumido/fechado; nada a liberar.
  }
}

export async function fetchPage(rawUrl: string, deps: FetchPageDeps): Promise<FetchedPage> {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = deps.maxBytes ?? FETCH_MAX_BYTES
  const userAgent = deps.userAgent ?? ABSOLEM_USER_AGENT
  const external = deps.signal
  if (external?.aborted) {
    throw new FetchPageError('cancelled', 'A abertura da página foi cancelada.')
  }

  let current = rawUrl
  let redirects = 0

  for (;;) {
    let timedOut = false
    const controller = new AbortController()
    const onExternalAbort = (): void => controller.abort()
    external?.addEventListener('abort', onExternalAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    try {
      let validation: UrlValidation
      try {
        // O timeout começa ANTES da validação: DNS lento não fica fora do teto.
        validation = await abortable(deps.validate(current), controller.signal)
      } catch (err) {
        if (err instanceof RequestAborted || controller.signal.aborted) throw err
        throw new FetchPageError(
          'network',
          err instanceof Error
            ? `Falha ao validar a página: ${err.message.slice(0, 200)}`
            : 'Falha ao validar a página.'
        )
      }
      if (!validation.ok) throw validationFailure(validation)
      current = validation.url.toString()

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
        if (err instanceof RequestAborted || controller.signal.aborted) throw err
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
          await discardBody(response)
          throw new FetchPageError('http', 'Redirecionamento sem destino.', response.status)
        }
        redirects += 1
        if (redirects > FETCH_MAX_REDIRECTS) {
          await discardBody(response)
          throw new FetchPageError(
            'redirects',
            `A página redireciona mais de ${FETCH_MAX_REDIRECTS} vezes.`
          )
        }
        let next: string
        try {
          next = new URL(location, current).toString()
        } catch {
          await discardBody(response)
          throw new FetchPageError(
            'http',
            'Redirecionamento com destino inválido.',
            response.status
          )
        }
        await discardBody(response)
        current = next
        continue
      }

      if (response.status < 200 || response.status >= 300) {
        await discardBody(response)
        throw new FetchPageError(
          'http',
          `A página respondeu com status ${response.status}.`,
          response.status
        )
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(mimeType(contentType))) {
        await discardBody(response)
        throw new FetchPageError(
          'content-type',
          `Tipo de conteúdo não permitido: ${mimeType(contentType) || '(ausente)'}.`
        )
      }

      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxBytes) {
        await discardBody(response)
        throw new FetchPageError(
          'too-large',
          `A página passa do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`
        )
      }

      const { bytes, body } = await readBodyCapped(response, maxBytes, controller.signal)
      return {
        finalUrl: current,
        status: response.status,
        contentType: mimeType(contentType),
        body,
        bytes
      }
    } catch (err) {
      if (err instanceof FetchPageError) throw err
      if (timedOut) {
        throw new FetchPageError('timeout', `A página demorou mais de ${timeoutMs / 1000} s.`)
      }
      if (external?.aborted) {
        throw new FetchPageError('cancelled', 'A abertura da página foi cancelada.')
      }
      if (controller.signal.aborted || err instanceof RequestAborted) {
        throw new FetchPageError('timeout', `A página demorou mais de ${timeoutMs / 1000} s.`)
      }
      throw err
    } finally {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    }
  }
}
