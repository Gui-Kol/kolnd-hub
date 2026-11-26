import { GeminiError, classifyError } from './errors'
import type {
  GeminiContent,
  GeminiFunctionCall,
  GeminiImage,
  GeminiRequest,
  GeminiTransport,
  GeminiUsageMetadata
} from './transport'

/**
 * Cliente Gemini: deadlines, retry limitado e taxonomia de erro.
 *
 * Regras fechadas:
 * - conexão 10 s, primeiro token 20 s, total 120 s (por chamada, retries
 *   incluídos no total);
 * - no máximo 2 tentativas, só para `network`, `timeout`, `429` e `5xx`;
 * - abort do usuário nunca é retry e vira `kind: 'cancelled'`;
 * - stream que já entregou texto não é repetido (evita delta duplicado);
 * - qualquer erro sai como `GeminiError` sem stack nem objeto do SDK.
 */

export type GeminiCallRequest = Omit<GeminiRequest, 'abortSignal'>

/**
 * Chamada multimodal: `text` + imagens viram o último turno do usuário.
 * `contents` opcional permite incluir histórico antes da imagem.
 */
export type GeminiImagesRequest = Omit<GeminiRequest, 'contents' | 'abortSignal'> & {
  text: string
  images: GeminiImage[]
  contents?: GeminiContent[]
}

export interface GeminiCallResult {
  text: string
  usage?: GeminiUsageMetadata
  functionCalls?: GeminiFunctionCall[]
  finishReason?: string
}

export interface GeminiDeadlines {
  connectMs: number
  firstTokenMs: number
  totalMs: number
}

export interface GeminiRetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  random: () => number
}

export interface GeminiClientOptions {
  transport: GeminiTransport
  deadlines?: Partial<GeminiDeadlines>
  retry?: Partial<GeminiRetryPolicy>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface StreamHandlers {
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

export const DEFAULT_DEADLINES: GeminiDeadlines = {
  connectMs: 10_000,
  firstTokenMs: 20_000,
  totalMs: 120_000
}

export const DEFAULT_RETRY: GeminiRetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 300,
  random: () => Math.random()
}

const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'RECITATION'
])

function createAbortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined)
    return Promise.reject(createAbortError())
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(createAbortError())
    }
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

function mergeUsage(
  current: GeminiUsageMetadata | undefined,
  next: GeminiUsageMetadata | undefined
): GeminiUsageMetadata | undefined {
  if (!next) return current
  const merged: GeminiUsageMetadata = { ...current }
  if (next.input !== undefined) merged.input = next.input
  if (next.output !== undefined) merged.output = next.output
  if (next.total !== undefined) merged.total = next.total
  return merged
}

type AbortCause = 'user' | 'connect' | 'first-token' | 'total'

interface AttemptControl {
  signal: AbortSignal
  cause: () => AbortCause | null
  connected: () => void
  firstToken: () => void
  cleanup: () => void
}

export class GeminiClient {
  private readonly transport: GeminiTransport
  private readonly deadlines: GeminiDeadlines
  private readonly retry: GeminiRetryPolicy
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: GeminiClientOptions) {
    this.transport = options.transport
    this.deadlines = { ...DEFAULT_DEADLINES, ...options.deadlines }
    this.retry = { ...DEFAULT_RETRY, ...options.retry }
    this.now = options.now ?? (() => Date.now())
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  }

  /**
   * Chamada multimodal (visão de tela, task 07). Usa exatamente o mesmo
   * deadline/retry/taxonomia de `generateText`; a única diferença é o turno
   * final, que carrega as imagens.
   */
  async generateWithImages(
    request: GeminiImagesRequest,
    options?: { signal?: AbortSignal }
  ): Promise<GeminiCallResult> {
    const { text, images, contents, ...base } = request
    if (!Array.isArray(images) || images.length === 0) {
      throw new GeminiError('invalid', 'Chamada multimodal sem imagem.')
    }
    const merged: GeminiContent[] = [
      ...(contents ?? []),
      { role: 'user', text, images: images.map((image) => ({ ...image })) }
    ]
    return this.generateText({ ...base, contents: merged }, options)
  }

  async generateText(
    request: GeminiCallRequest,
    options?: { signal?: AbortSignal }
  ): Promise<GeminiCallResult> {
    const callStart = this.now()
    return this.withRetry(options?.signal, async () => {
      const control = this.beginAttempt(callStart, options?.signal)
      try {
        const response = await raceWithAbort(
          this.transport.generate({ ...request, abortSignal: control.signal }),
          control.signal
        )
        control.connected()
        if (response.blocked) throw this.blockedError()
        return {
          text: response.text ?? '',
          usage: response.usage,
          functionCalls: response.functionCalls,
          finishReason: response.finishReason
        }
      } catch (err) {
        throw this.normalizeError(err, control)
      } finally {
        control.cleanup()
      }
    })
  }

  async streamText(
    request: GeminiCallRequest,
    handlers: StreamHandlers = {}
  ): Promise<GeminiCallResult> {
    const callStart = this.now()
    return this.withRetry(handlers.signal, async () => {
      const control = this.beginAttempt(callStart, handlers.signal)
      const iterator = this.transport
        .stream({ ...request, abortSignal: control.signal })
        [Symbol.asyncIterator]()
      let text = ''
      let usage: GeminiUsageMetadata | undefined
      let finishReason: string | undefined
      let functionCalls: GeminiFunctionCall[] | undefined
      try {
        for (;;) {
          const next = await raceWithAbort(iterator.next(), control.signal)
          if (next.done) break
          const chunk = next.value
          control.connected()
          if (chunk.blocked) throw this.blockedError()
          usage = mergeUsage(usage, chunk.usage)
          if (chunk.finishReason) finishReason = chunk.finishReason
          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
            functionCalls = [...(functionCalls ?? []), ...chunk.functionCalls]
          }
          if (chunk.text) {
            control.firstToken()
            text += chunk.text
            handlers.onDelta?.(chunk.text)
          }
          if (text.length === 0 && finishReason && BLOCKED_FINISH_REASONS.has(finishReason)) {
            throw this.blockedError()
          }
        }
        return { text, usage, functionCalls, finishReason }
      } catch (err) {
        // Libera o stream do transporte; falha ao fechar não muda o erro.
        try {
          await iterator.return?.(undefined)
        } catch {
          // best-effort
        }
        const normalized = this.normalizeError(err, control)
        // Delta já entregue não pode ser repetido: sem retry depois do primeiro texto.
        if (text.length > 0 && normalized.retryable) {
          throw new GeminiError(normalized.kind, normalized.message, {
            retryable: false,
            status: normalized.status
          })
        }
        throw normalized
      } finally {
        control.cleanup()
      }
    })
  }

  private blockedError(): GeminiError {
    return new GeminiError('blocked', 'Resposta bloqueada pela política de conteúdo do Gemini.')
  }

  private beginAttempt(callStart: number, userSignal?: AbortSignal): AttemptControl {
    const controller = new AbortController()
    let cause: AbortCause | null = null

    const abortWith = (next: AbortCause): void => {
      if (cause) return
      cause = next
      controller.abort()
    }

    const onUserAbort = (): void => abortWith('user')
    if (userSignal) {
      if (userSignal.aborted) abortWith('user')
      else userSignal.addEventListener('abort', onUserAbort, { once: true })
    }

    const remainingTotal = Math.max(0, this.deadlines.totalMs - (this.now() - callStart))
    const totalTimer = setTimeout(() => abortWith('total'), remainingTotal)
    const connectTimer = setTimeout(() => abortWith('connect'), this.deadlines.connectMs)
    const firstTokenTimer = setTimeout(() => abortWith('first-token'), this.deadlines.firstTokenMs)

    return {
      signal: controller.signal,
      cause: () => cause,
      connected: () => clearTimeout(connectTimer),
      firstToken: () => clearTimeout(firstTokenTimer),
      cleanup: () => {
        clearTimeout(totalTimer)
        clearTimeout(connectTimer)
        clearTimeout(firstTokenTimer)
        userSignal?.removeEventListener('abort', onUserAbort)
      }
    }
  }

  private normalizeError(err: unknown, control: AttemptControl): GeminiError {
    if (err instanceof GeminiError) return err
    const cause = control.cause()
    if (cause === 'user') {
      return new GeminiError('cancelled', 'Chamada cancelada.')
    }
    if (cause === 'total') {
      return new GeminiError('timeout', 'Tempo total da chamada ao Gemini esgotado.', {
        retryable: true
      })
    }
    if (cause === 'connect') {
      return new GeminiError('timeout', 'Não foi possível conectar ao Gemini a tempo.', {
        retryable: true
      })
    }
    if (cause === 'first-token') {
      return new GeminiError('timeout', 'O Gemini não começou a responder a tempo.', {
        retryable: true
      })
    }
    return classifyError(err)
  }

  private async withRetry<T>(
    userSignal: AbortSignal | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    let attempt = 0
    for (;;) {
      attempt += 1
      if (userSignal?.aborted) {
        throw new GeminiError('cancelled', 'Chamada cancelada.')
      }
      try {
        return await run()
      } catch (err) {
        const error = err instanceof GeminiError ? err : classifyError(err)
        if (!error.retryable || attempt >= this.retry.maxAttempts) throw error
        if (userSignal?.aborted) {
          throw new GeminiError('cancelled', 'Chamada cancelada.')
        }
        const delay =
          this.retry.baseDelayMs * 2 ** (attempt - 1) + this.retry.random() * this.retry.baseDelayMs
        await this.sleep(delay)
      }
    }
  }
}
