import type { CaptureFrameResultRequest } from '../../shared/ipc'
import type { CaptureRequestPush } from '../../shared/screen'
import { CAPTURE_FRAME_TIMEOUT_MS } from '../../shared/screen'
import type { CaptureGrabRequest, CapturedImage } from './controller'

/**
 * Ponte main -> renderer para capturar um frame (task 07, T3/T7; task 04).
 *
 * O pedido vai por push (`capture:request`) e a resposta volta por
 * `capture:result`. O main espera no máximo 4 s; se o renderer não tiver a
 * janela do overlay viva (ou falhar), o fallback opcional por thumbnail é
 * usado - a interface não muda. Nenhum pixel é escrito em disco.
 *
 * - um `requestId` já pendente é deduplicado: o mesmo frame atende os dois
 *   chamadores, sem um segundo pedido ao renderer;
 * - timeout, cancelamento e erro sempre liberam o pending e limpam o timer.
 */

export interface FrameGrabServiceOptions {
  /** Envia o pedido ao overlay; `false` quando não há renderer disponível. */
  sendRequest: (push: CaptureRequestPush) => boolean
  timeoutMs?: number
  /** Fallback suportado (desktopCapturer thumbnail) quando o renderer falha. */
  fallback?: (request: CaptureGrabRequest) => Promise<CapturedImage | null>
}

export interface FrameResultHandling {
  handled: boolean
  ok: boolean
  error?: string
}

interface PendingRequest {
  request: CaptureGrabRequest
  promise: Promise<CapturedImage>
  resolve: (image: CapturedImage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function toArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    return copy.buffer
  }
  return null
}

export class FrameGrabService {
  private readonly options: FrameGrabServiceOptions
  private readonly timeoutMs: number
  private readonly pending = new Map<string, PendingRequest>()

  constructor(options: FrameGrabServiceOptions) {
    this.options = options
    this.timeoutMs =
      typeof options.timeoutMs === 'number' && options.timeoutMs > 0
        ? options.timeoutMs
        : CAPTURE_FRAME_TIMEOUT_MS
  }

  async request(request: CaptureGrabRequest): Promise<CapturedImage> {
    // Duplicado concorrente: o mesmo frame resolve os dois chamadores e o
    // renderer só recebe um pedido (sem custo dobrado).
    const existing = this.pending.get(request.requestId)
    if (existing) return existing.promise

    const push: CaptureRequestPush = {
      requestId: request.requestId,
      sourceId: request.sourceId,
      pixelWidth: request.pixelWidth,
      pixelHeight: request.pixelHeight,
      lossless: request.lossless
    }
    const sent = this.options.sendRequest(push)
    if (!sent) return this.fallbackOrThrow(request, 'Janela de captura indisponível.')

    let resolvePromise: (image: CapturedImage) => void = () => undefined
    let rejectPromise: (error: Error) => void = () => undefined
    const promise = new Promise<CapturedImage>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const timer = setTimeout(() => {
      this.pending.delete(request.requestId)
      void this.fallbackOrThrow(request, 'A captura no renderer não respondeu em 4 segundos.').then(
        resolvePromise,
        rejectPromise
      )
    }, this.timeoutMs)
    this.pending.set(request.requestId, {
      request,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer
    })
    return promise
  }

  /** Trata `capture:result`; valida tipo/tamanho básico no main. */
  handleResult(payload: CaptureFrameResultRequest): FrameResultHandling {
    if (!payload || typeof payload.requestId !== 'string') {
      return { handled: false, ok: false, error: 'Resposta de captura sem requestId.' }
    }
    const pending = this.pending.get(payload.requestId)
    if (!pending) {
      return { handled: false, ok: false, error: 'Resposta de captura fora de hora.' }
    }
    this.release(payload.requestId, pending)

    if (!payload.ok) {
      const error =
        typeof payload.error === 'string' ? payload.error.slice(0, 300) : 'captura falhou'
      this.settleFailure(pending, error)
      return { handled: true, ok: false, error }
    }
    const data = toArrayBuffer(payload.data)
    const mime = payload.mime
    if (
      !data ||
      data.byteLength === 0 ||
      (mime !== 'image/jpeg' && mime !== 'image/png') ||
      typeof payload.width !== 'number' ||
      typeof payload.height !== 'number' ||
      !Number.isFinite(payload.width) ||
      !Number.isFinite(payload.height) ||
      payload.width <= 0 ||
      payload.height <= 0
    ) {
      const error = 'Frame inválido (mime/dimensões/buffer).'
      this.settleFailure(pending, error)
      return { handled: true, ok: false, error }
    }
    pending.resolve({
      mime,
      data,
      width: Math.round(payload.width),
      height: Math.round(payload.height)
    })
    return { handled: true, ok: true }
  }

  private release(requestId: string, pending: PendingRequest): void {
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
  }

  private settleFailure(pending: PendingRequest, reason: string): void {
    if (this.options.fallback) {
      void this.fallbackOrThrow(pending.request, reason).then(pending.resolve, pending.reject)
      return
    }
    pending.reject(new Error(reason))
  }

  private async fallbackOrThrow(
    request: CaptureGrabRequest,
    reason: string
  ): Promise<CapturedImage> {
    if (!this.options.fallback) throw new Error(reason)
    const image = await this.options.fallback(request)
    if (!image) throw new Error(reason)
    return image
  }

  /** Cancela um pedido pendente (sem fallback: o usuário cancelou). */
  cancel(requestId: string): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    this.release(requestId, pending)
    pending.reject(new Error('captura cancelada'))
    return true
  }

  cancelAll(): void {
    for (const [requestId] of [...this.pending]) this.cancel(requestId)
  }

  /** Somente para teste/observação: requests aguardando o renderer. */
  pendingCount(): number {
    return this.pending.size
  }
}

export function createFrameGrabService(options: FrameGrabServiceOptions): FrameGrabService {
  return new FrameGrabService(options)
}
