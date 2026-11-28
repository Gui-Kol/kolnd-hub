import { IPC } from '../../shared/ipc'
import { isAllowedNavigationUrl } from '../navigation'

/**
 * Guarda central do IPC (task 13/T6).
 *
 * - allowlist fechada: o nome do canal precisa existir em `IPC`;
 * - limite de payload: 8 MB para binário (frame de tela) e 64 KB para texto;
 * - remetente: `senderFrame.url` precisa ser a origem do app (dev ou
 *   `renderer/index.html`);
 * - erro sanitizado: sem stack, sem chave e sem caminho pessoal.
 *
 * O módulo é puro (sem importar Electron) para os testes rodarem em Node.
 */

export const MAX_BINARY_PAYLOAD_BYTES = 8 * 1024 * 1024
export const MAX_TEXT_PAYLOAD_BYTES = 64 * 1024
const MAX_ERROR_CHARS = 300
const MAX_DEPTH = 8

const CHANNELS = new Set<string>(Object.values(IPC))

export function isAllowedIpcChannel(channel: unknown): channel is string {
  return typeof channel === 'string' && CHANNELS.has(channel)
}

export function listIpcChannels(): string[] {
  return [...CHANNELS]
}

export interface SenderFrameLike {
  url?: string
}

export interface IpcEventLike {
  senderFrame?: SenderFrameLike | null
}

/**
 * URL aceita: a origem do electron-vite em dev ou o `renderer/index.html`
 * empacotado. Qualquer outra origem é recusada.
 */
export function isTrustedAppUrl(url: unknown, devRendererUrl?: string | null): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  if (isAllowedNavigationUrl(url, devRendererUrl)) return true
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return false
    return /\/renderer\/index\.html$/i.test(parsed.pathname)
  } catch {
    return false
  }
}

/**
 * `true` quando o evento não traz frame (chamada interna/teste) ou quando o
 * frame é da origem do app. Um frame presente com URL estranha é recusado.
 */
export function isTrustedSender(event: IpcEventLike | null | undefined): boolean {
  if (!event || event.senderFrame === undefined) return true
  if (event.senderFrame === null) return false
  return isTrustedAppUrl(event.senderFrame.url, process.env['ELECTRON_RENDERER_URL'])
}

export type PayloadLimitResult =
  { ok: true } | { ok: false; reason: 'text' | 'binary'; message: string }

export interface PayloadLimitOptions {
  maxTextBytes?: number
  maxBinaryBytes?: number
}

function textByteLength(value: unknown, seen: WeakSet<object>, depth: number): number {
  if (depth > MAX_DEPTH) return 0
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8')
  // Binário tem limite próprio em `failBinary`; não entra na conta de texto.
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return 0
  if (Array.isArray(value)) {
    if (seen.has(value)) return 0
    seen.add(value)
    let total = 0
    for (const item of value) total += textByteLength(item, seen, depth + 1)
    return total
  }
  if (value && typeof value === 'object') {
    if (seen.has(value as object)) return 0
    seen.add(value as object)
    let total = 0
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      total += Buffer.byteLength(key, 'utf8') + textByteLength(item, seen, depth + 1)
    }
    return total
  }
  if (typeof value === 'number' || typeof value === 'boolean') return 8
  return 0
}

/** Verifica o limite de texto e de binário no payload inteiro. */
export function checkPayloadLimits(
  payload: unknown,
  options: PayloadLimitOptions = {}
): PayloadLimitResult {
  const maxTextBytes = options.maxTextBytes ?? MAX_TEXT_PAYLOAD_BYTES
  const maxBinaryBytes = options.maxBinaryBytes ?? MAX_BINARY_PAYLOAD_BYTES
  const seen = new WeakSet<object>()

  function failBinary(value: unknown, depth = 0): boolean {
    if (depth > MAX_DEPTH) return false
    if (value instanceof ArrayBuffer) return value.byteLength > maxBinaryBytes
    if (ArrayBuffer.isView(value)) return value.byteLength > maxBinaryBytes
    if (Array.isArray(value)) {
      if (seen.has(value)) return false
      seen.add(value)
      return value.some((item) => failBinary(item, depth + 1))
    }
    if (value && typeof value === 'object') {
      if (seen.has(value as object)) return false
      seen.add(value as object)
      return Object.values(value as Record<string, unknown>).some((item) =>
        failBinary(item, depth + 1)
      )
    }
    return false
  }

  if (failBinary(payload)) {
    return {
      ok: false,
      reason: 'binary',
      message: `Payload binário acima de ${Math.round(maxBinaryBytes / 1024 / 1024)} MB.`
    }
  }

  const textBytes = textByteLength(payload, new WeakSet<object>(), 0)
  if (textBytes > maxTextBytes) {
    return {
      ok: false,
      reason: 'text',
      message: `Payload de texto acima de ${Math.round(maxTextBytes / 1024)} KB.`
    }
  }
  return { ok: true }
}

/**
 * Lê `message` sem confiar no objeto: getter/`toString` hostil vira texto
 * vazio em vez de exceção crua escapando do guarda de IPC.
 */
function readErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) {
      const value = (error as { message: unknown }).message
      if (typeof value === 'string') return value
      return value === undefined || value === null ? '' : String(value)
    }
  } catch {
    return ''
  }
  return ''
}

/** Remove stack, chave e caminho pessoal de qualquer erro que vá ao IPC. */
export function sanitizeIpcError(
  error: unknown,
  fallback = 'Falha ao executar a operação.'
): string {
  const raw = readErrorMessage(error)
  const message = raw
    .replace(/\r?\n\s+at\s+[^\r\n]*/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/(api[-_]?key|authorization|token|senha|chave)\s*[=:]\s*\S+/gi, '$1=[redigido]')
    .replace(/\b([A-Za-z]):\\Users\\[^\\\s"']+/gi, '$1:\\Users\\[usuario]')
    .trim()
    .slice(0, MAX_ERROR_CHARS)
  return message || fallback
}
