/**
 * Taxonomia única de erro do motor Gemini.
 *
 * Tudo que sai de `client.ts`, `engine.ts` e do IPC é um `GeminiError`
 * normalizado: `kind` estável, `retryable` explícito e mensagem curta em pt-BR.
 * O erro cru do SDK nunca atravessa esta camada (a task proíbe vazar stack ou
 * objeto do provedor para o renderer).
 */

import type { GeminiErrorKind, GeminiErrorSummary } from '../../shared/gemini'

export { GEMINI_ERROR_KINDS } from '../../shared/gemini'
export type { GeminiErrorKind } from '../../shared/gemini'

export interface GeminiErrorInfo extends GeminiErrorSummary {
  retryable: boolean
  status?: number
}

const MAX_DETAIL = 200

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind
  readonly retryable: boolean
  readonly status?: number

  constructor(
    kind: GeminiErrorKind,
    message: string,
    options?: { retryable?: boolean; status?: number }
  ) {
    super(message)
    this.name = 'GeminiError'
    this.kind = kind
    this.retryable = options?.retryable ?? false
    this.status = options?.status
  }

  toInfo(): GeminiErrorInfo {
    return this.status === undefined
      ? { kind: this.kind, message: this.message, retryable: this.retryable }
      : { kind: this.kind, message: this.message, retryable: this.retryable, status: this.status }
  }
}

export function isGeminiError(value: unknown): value is GeminiError {
  return value instanceof GeminiError
}

/** Remove credenciais e reduz o texto a uma linha curta. */
export function sanitizeDetail(value: unknown): string {
  const text = typeof value === 'string' ? value : value instanceof Error ? value.message : ''
  return text
    .replace(/(api[-_]?key|key)\s*=\s*[^&\s]+/gi, '$1=[redigido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL)
}

function readStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const record = err as Record<string, unknown>
  const candidates = [record.status, record.statusCode, record.code]
  const response = record.response
  if (response && typeof response === 'object') {
    candidates.push((response as Record<string, unknown>).status)
  }
  const nested = record.error
  if (nested && typeof nested === 'object') {
    candidates.push((nested as Record<string, unknown>).code)
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) return Number(candidate)
  }
  return undefined
}

function readCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const record = err as Record<string, unknown>
  const code = record.code
  if (typeof code === 'string' && /^[A-Z_]+$/.test(code)) return code
  const cause = record.cause
  if (cause && typeof cause === 'object') {
    const inner = (cause as Record<string, unknown>).code
    if (typeof inner === 'string' && /^[A-Z_]+$/.test(inner)) return inner
  }
  return undefined
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_NETWORK'
])

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'])

function classifyStatus(status: number, detail: string): GeminiError {
  if (status === 401 || status === 403) {
    return new GeminiError('auth', 'Chave de API inválida, ausente ou sem permissão.', {
      status
    })
  }
  if (status === 429) {
    return new GeminiError('quota', 'Cota do Gemini esgotada para agora. Tente mais tarde.', {
      retryable: true,
      status
    })
  }
  if (status === 408) {
    return new GeminiError('timeout', 'O Gemini demorou demais para responder.', {
      retryable: true,
      status
    })
  }
  if (status === 499) {
    return new GeminiError('cancelled', 'Chamada cancelada.', { status })
  }
  if (status >= 500 && status <= 599) {
    return new GeminiError('server', 'O serviço do Gemini está indisponível agora.', {
      retryable: true,
      status
    })
  }
  if (status >= 400 && status <= 499) {
    const detailText = detail ? `: ${detail}` : '.'
    return new GeminiError('invalid', `Requisição inválida para o Gemini${detailText}`, { status })
  }
  return new GeminiError('unknown', 'Falha inesperada ao falar com o Gemini.')
}

/**
 * Normaliza qualquer erro do transporte. Nunca anexa o erro original: a stack
 * do SDK não chega ao chamador nem ao renderer.
 */
export function classifyError(err: unknown): GeminiError {
  if (isGeminiError(err)) return err

  const status = readStatus(err)
  const detail = sanitizeDetail(err)
  if (status !== undefined) return classifyStatus(status, detail)

  const code = readCode(err)
  if (code && TIMEOUT_CODES.has(code)) {
    return new GeminiError('timeout', 'O Gemini demorou demais para responder.', {
      retryable: true
    })
  }
  if (code && NETWORK_CODES.has(code)) {
    return new GeminiError('network', 'Falha de rede ao falar com o Gemini.', {
      retryable: true
    })
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return new GeminiError('cancelled', 'Chamada cancelada.')
  }
  if (typeof err === 'string' && /\b(fetch failed|network|socket hang up)\b/i.test(err)) {
    return new GeminiError('network', 'Falha de rede ao falar com o Gemini.', {
      retryable: true
    })
  }
  return new GeminiError('unknown', 'Falha inesperada ao falar com o Gemini.')
}

/** Payload público de erro (`chat:error` e `lastError` do status). */
export function toPublicError(err: unknown): { kind: GeminiErrorKind; message: string } {
  const gemini = classifyError(err)
  return { kind: gemini.kind, message: gemini.message }
}
