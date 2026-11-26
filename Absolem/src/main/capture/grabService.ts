import type { CaptureFrameResultRequest } from '../../shared/ipc'
import type { CaptureRequestPush } from '../../shared/screen'
import { CAPTURE_FRAME_TIMEOUT_MS } from '../../shared/screen'
import type { CaptureGrabRequest, CapturedImage } from './controller'

/**
 * Ponte main -> renderer para capturar um frame (task 07, T3/T7).
 *
 * O pedido vai por push (`capture:request`) e a resposta volta por
 * `capture:result`. O main espera no máximo 4 s; se o renderer não tiver a
 * janela do overlay viva (ou falhar), o fallback opcional por thumbnail é
 * usado - a interface não muda. Nenhum pixel é escrito em disco.
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
    const push: CaptureRequestPush = {
      requestId: request.requestId,
      sourceId: request.sourceId,
      pixelWidth: request.pixelWidth,
      pixelHeight: request.pixelHeight,
      lossless: request.lossless
    }
    const sent = this.options.sendRequest(push)
    if (!sent) return this.fallbackOrThrow(request, 'Janela de captura indisponível.')

    return new Promise<CapturedImage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        void this.fallbackOrThrow(
          request,
          'A captura no renderer não respondeu em 4 segundos.'
        ).then(resolve, reject)
      }, this.timeoutMs)
      this.pending.set(request.requestId, { request, resolve, reject, timer })
    })
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
    this.pending.delete(payload.requestId)
    clearTimeout(pending.timer)

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
    this.pending.delete(requestId)
    clearTimeout(pending.timer)
    pending.reject(new Error('captura cancelada'))
    return true
  }

  cancelAll(): void {
    for (const [requestId] of [...this.pending]) this.cancel(requestId)
  }
}

export function createFrameGrabService(options: FrameGrabServiceOptions): FrameGrabService {
  return new FrameGrabService(options)
}
