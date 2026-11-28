/**
 * Captura de um frame da tela no renderer (task 07, T2).
 *
 * O caminho principal usa `getUserMedia` com as constraints de desktop do
 * Chromium (`chromeMediaSource: 'desktop'`) para obter resolução cheia. As
 * fábricas de `video`, `canvas` e o próprio `getUserMedia` são injetadas para
 * que o módulo rode em Node nos testes, sem DOM e sem tela real.
 *
 * Regras:
 * - todas as tracks são encerradas em `finally`, inclusive em erro;
 * - a imagem é limitada a 1280 px no maior lado (gate de custo);
 * - JPEG qualidade 0.75 por padrão; PNG quando `lossless` é pedido (texto);
 * - encode síncrono (`toDataURL`): o overlay fica oculto durante a captura e o
 *   callback de `toBlob` é throttled (~1 s) nesse estado; `toBlob` fica apenas
 *   como fallback para ambientes sem `toDataURL`;
 * - nada é gravado em disco: o retorno é um `ArrayBuffer` em memória.
 */

export const GRAB_MAX_SIDE = 1280
export const JPEG_QUALITY = 0.75
export const DEFAULT_FRAME_TIMEOUT_MS = 2_000

export interface DesktopVideoConstraints {
  mandatory: {
    chromeMediaSource: 'desktop'
    chromeMediaSourceId: string
    maxWidth: number
    maxHeight: number
    maxFrameRate: number
  }
}

export interface GrabConstraints {
  audio: false
  video: DesktopVideoConstraints
}

export interface GrabMediaStreamTrackLike {
  stop: () => void
}

export interface GrabMediaStreamLike {
  getTracks: () => GrabMediaStreamTrackLike[]
}

export type GetUserMediaLike = (constraints: GrabConstraints) => Promise<GrabMediaStreamLike>

export interface VideoElementLike {
  srcObject: unknown
  videoWidth: number
  videoHeight: number
  readyState?: number
  muted?: boolean
  playsInline?: boolean
  play?: () => Promise<void>
  requestVideoFrameCallback?: (callback: () => void) => number
  addEventListener?: (name: string, listener: () => void, options?: { once?: boolean }) => void
  removeEventListener?: (name: string, listener: () => void) => void
}

export interface Canvas2DContextLike {
  drawImage: (image: unknown, dx: number, dy: number, dw: number, dh: number) => void
}

export interface BlobLike {
  arrayBuffer: () => Promise<ArrayBuffer>
}

export interface CanvasElementLike {
  width: number
  height: number
  getContext: (type: '2d') => Canvas2DContextLike | null
  /**
   * Encode síncrono. É o caminho principal: quando o overlay está oculto, o
   * callback assíncrono de `toBlob` é throttled e chega ~1 s depois (task 04).
   */
  toDataURL?: (type?: string, quality?: number) => string
  toBlob?: (callback: (blob: BlobLike | null) => void, type?: string, quality?: number) => void
}

export interface GrabFactories {
  createVideo: () => VideoElementLike
  createCanvas: () => CanvasElementLike
  getUserMedia: GetUserMediaLike
}

export interface GrabOptions {
  /** PNG sem perdas, para texto pequeno. */
  lossless?: boolean
  /** Maior lado permitido; default 1280. */
  maxSide?: number
  /** Qualidade JPEG; default 0.75. */
  quality?: number
  /** Tempo máximo esperando o primeiro frame; default 2 s. */
  frameTimeoutMs?: number
}

export interface GrabbedFrame {
  data: ArrayBuffer
  mime: 'image/jpeg' | 'image/png'
  width: number
  height: number
  bytes: number
}

/** Constraints de desktop para um sourceId (formato aceito pelo Chromium 28). */
export function buildDesktopConstraints(
  sourceId: string,
  maxWidth: number = GRAB_MAX_SIDE,
  maxHeight: number = GRAB_MAX_SIDE
): GrabConstraints {
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth,
        maxHeight,
        maxFrameRate: 5
      }
    }
  }
}

/** Dimensões do canvas: maior lado limitado, proporção preservada. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number
): { width: number; height: number } {
  const largest = Math.max(width, height)
  if (!Number.isFinite(largest) || largest <= 0) return { width: 0, height: 0 }
  const scale = largest > maxSide ? maxSide / largest : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

function waitForFirstFrame(video: VideoElementLike, timeoutMs: number): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      video.removeEventListener?.('loadeddata', onLoaded)
      if (error) reject(error)
      else resolve()
    }
    const onLoaded = (): void => finish()
    timer = setTimeout(
      () => finish(new Error('tempo esgotado aguardando o frame da tela')),
      timeoutMs
    )

    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => finish())
      return
    }
    if (video.readyState !== undefined && video.readyState >= 2) {
      finish()
      return
    }
    if (typeof video.addEventListener === 'function') {
      video.addEventListener('loadeddata', onLoaded, { once: true })
      return
    }
    finish()
  })
}

function encodeCanvas(
  canvas: CanvasElementLike,
  mime: 'image/jpeg' | 'image/png',
  quality?: number
): Promise<ArrayBuffer> {
  // Caminho síncrono: não depende do agendador de tarefas do renderer oculto.
  if (typeof canvas.toDataURL === 'function') {
    try {
      return Promise.resolve(decodeDataUrl(canvas.toDataURL(mime, quality)))
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }
  if (typeof canvas.toBlob !== 'function') {
    return Promise.reject(new Error('canvas sem encoder para a imagem da tela'))
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    try {
      canvas.toBlob?.(
        (blob) => {
          if (!blob) {
            reject(new Error('falha ao codificar a imagem da tela'))
            return
          }
          blob.arrayBuffer().then(resolve, reject)
        },
        mime,
        quality
      )
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** Converte um `data:` URL (encode síncrono do canvas) em bytes. */
export function decodeDataUrl(url: string): ArrayBuffer {
  if (typeof url !== 'string' || !url.startsWith('data:')) {
    throw new Error('encode da tela devolveu dados inválidos')
  }
  const comma = url.indexOf(',')
  if (comma < 0) throw new Error('encode da tela veio sem payload')
  const binary = atob(url.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

/**
 * Captura um frame e devolve o buffer codificado. O stream é sempre encerrado,
 * mesmo quando o canvas/video falham.
 */
export async function grabFrame(
  sourceId: string,
  factories: GrabFactories,
  options: GrabOptions = {}
): Promise<GrabbedFrame> {
  if (typeof sourceId !== 'string' || sourceId.trim().length === 0) {
    throw new Error('sourceId inválido para captura de tela')
  }
  const maxSide =
    typeof options.maxSide === 'number' && options.maxSide > 0 ? options.maxSide : GRAB_MAX_SIDE
  const lossless = options.lossless === true
  const mime: 'image/jpeg' | 'image/png' = lossless ? 'image/png' : 'image/jpeg'
  const quality = lossless ? undefined : (options.quality ?? JPEG_QUALITY)
  const frameTimeoutMs =
    typeof options.frameTimeoutMs === 'number' && options.frameTimeoutMs > 0
      ? options.frameTimeoutMs
      : DEFAULT_FRAME_TIMEOUT_MS

  let stream: GrabMediaStreamLike | null = null
  const video = factories.createVideo()
  try {
    stream = await factories.getUserMedia(buildDesktopConstraints(sourceId, maxSide, maxSide))
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    if (typeof video.play === 'function') {
      await video.play().catch(() => undefined)
    }
    await waitForFirstFrame(video, frameTimeoutMs)

    const sourceWidth = Math.round(video.videoWidth)
    const sourceHeight = Math.round(video.videoHeight)
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error('o frame da tela veio vazio')
    }
    const size = fitWithin(sourceWidth, sourceHeight, maxSide)
    const canvas = factories.createCanvas()
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas 2D indisponível para capturar a tela')
    context.drawImage(video, 0, 0, size.width, size.height)
    const data = await encodeCanvas(canvas, mime, quality)
    return { data, mime, width: size.width, height: size.height, bytes: data.byteLength }
  } finally {
    video.srcObject = null
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop()
      } catch {
        // track já encerrada pelo Chromium
      }
    }
  }
}

/** Fábricas reais do renderer (DOM + getUserMedia). */
export function createDomGrabFactories(): GrabFactories {
  return {
    createVideo: () => {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      return video as unknown as VideoElementLike
    },
    createCanvas: () => {
      const canvas = document.createElement('canvas')
      return canvas as unknown as CanvasElementLike
    },
    getUserMedia: (constraints) =>
      navigator.mediaDevices.getUserMedia(
        constraints as unknown as MediaStreamConstraints
      ) as unknown as Promise<GrabMediaStreamLike>
  }
}
