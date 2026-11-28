/**
 * Captura de microfone em PCM16 16 kHz (task 06).
 *
 * O `AudioContext` e o `getUserMedia` são injetados para que o módulo rode em
 * Node nos testes. Em produção o overlay cria o contexto no gesto do clique
 * (o Chromium inicia suspenso sem gesto) e passa o `deviceId` persistido.
 *
 * Regras:
 * - `echoCancellation`, `noiseSuppression` e `autoGainControl` sempre ligados;
 *   sem AEC o modelo ouve a própria voz e se interrompe;
 * - `stop()` para todas as tracks e fecha o contexto: nenhum stream órfão;
 * - um `stop()` durante o `start()` assíncrono invalida a geração: o stream
 *   que chegar depois é descartado, nunca reativa a captura;
 * - contexto suspenso pelo sistema é retomado enquanto a captura está ativa;
 * - track encerrada (microfone removido) para a captura e avisa o chamador;
 * - cada bloco de 20 ms vira `Uint8Array` e sai sem cópia extra.
 */

export interface MediaStreamTrackLike {
  stop: () => void
  onended?: ((event: Event) => void) | null
}

export interface MediaStreamLike {
  getTracks: () => MediaStreamTrackLike[]
}

export interface AudioNodeLike {
  connect: (destination: unknown) => void
  disconnect: () => void
}

export interface AudioWorkletNodeLike extends AudioNodeLike {
  port: {
    onmessage: ((event: { data: ArrayBufferLike }) => void) | null
    close?: () => void
  }
}

export interface AudioContextLike {
  sampleRate?: number
  state?: string
  destination: unknown
  audioWorklet: { addModule: (url: string) => Promise<void> }
  createMediaStreamSource: (stream: MediaStreamLike) => AudioNodeLike
  createGain?: () => { gain: { value: number }; connect: (destination: unknown) => void }
  resume?: () => Promise<void>
  close?: () => Promise<void>
  onstatechange?: ((event: unknown) => void) | null
}

export interface MediaConstraintsLike {
  audio: {
    deviceId?: { exact: string }
    echoCancellation: boolean
    noiseSuppression: boolean
    autoGainControl: boolean
    channelCount: number
    sampleRate?: number
  }
}

export const CAPTURE_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1
} as const

export const PCM_WORKLET_NAME = 'absolem-pcm16'

export function buildAudioConstraints(deviceId?: string | null): MediaConstraintsLike {
  const audio: MediaConstraintsLike['audio'] = { ...CAPTURE_CONSTRAINTS }
  if (typeof deviceId === 'string' && deviceId.length > 0) {
    audio.deviceId = { exact: deviceId }
  }
  return { audio }
}

export interface PcmCaptureOptions {
  createContext: () => AudioContextLike
  getUserMedia: (constraints: MediaConstraintsLike) => Promise<MediaStreamLike>
  createWorkletNode: (context: AudioContextLike) => AudioWorkletNodeLike
  workletUrl: string
  getDeviceId?: () => string | null
  onChunk: (chunk: Uint8Array) => void
  onError?: (error: unknown) => void
  /** Microfone removido/desconectado: a captura já foi parada. */
  onTrackEnded?: () => void
  logger?: { warn: (scope: string, message: unknown) => void }
}

export interface PcmCaptureStats {
  starts: number
  stops: number
  cancelledStarts: number
  chunks: number
  bytes: number
  resumes: number
  errors: number
  trackEnded: number
}

export interface PcmCapture {
  start: () => Promise<void>
  stop: () => void
  isActive: () => boolean
  getStats: () => PcmCaptureStats
}

interface CaptureResources {
  context: AudioContextLike | null
  stream: MediaStreamLike | null
  source: AudioNodeLike | null
  worklet: AudioWorkletNodeLike | null
}

function stopTracks(stream: MediaStreamLike | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      track.onended = null
      track.stop()
    } catch {
      // track já encerrada
    }
  }
}

function disconnectWorklet(worklet: AudioWorkletNodeLike | null): void {
  if (!worklet) return
  try {
    worklet.port.onmessage = null
    worklet.disconnect()
    worklet.port.close?.()
  } catch {
    // O contexto pode já ter sido fechado pelo Chromium.
  }
}

function disconnectSource(source: AudioNodeLike | null): void {
  if (!source) return
  try {
    source.disconnect()
  } catch {
    // best-effort
  }
}

function closeContext(context: AudioContextLike | null): void {
  if (!context) return
  try {
    context.onstatechange = null
  } catch {
    // contexto já descartado
  }
  try {
    void context.close?.().catch(() => undefined)
  } catch {
    // best-effort
  }
}

export function createPcmCapture(options: PcmCaptureOptions): PcmCapture {
  const resources: CaptureResources = {
    context: null,
    stream: null,
    source: null,
    worklet: null
  }
  let starting = false
  let active = false
  let generation = 0
  const stats: PcmCaptureStats = {
    starts: 0,
    stops: 0,
    cancelledStarts: 0,
    chunks: 0,
    bytes: 0,
    resumes: 0,
    errors: 0,
    trackEnded: 0
  }

  const releaseResources = (target: CaptureResources): void => {
    disconnectWorklet(target.worklet)
    target.worklet = null
    disconnectSource(target.source)
    target.source = null
    stopTracks(target.stream)
    target.stream = null
    closeContext(target.context)
    target.context = null
  }

  const stop = (): void => {
    if (!active && !starting) return
    generation += 1
    starting = false
    stats.stops += 1
    releaseResources(resources)
    active = false
  }

  const start = async (): Promise<void> => {
    if (active || starting) return
    starting = true
    stats.starts += 1
    const epoch = generation
    const pending: CaptureResources = {
      context: null,
      stream: null,
      source: null,
      worklet: null
    }
    let committed = false

    try {
      const nextContext = options.createContext()
      pending.context = nextContext
      resources.context = nextContext

      nextContext.onstatechange = () => {
        if (epoch !== generation || !active) return
        if (nextContext.state !== 'suspended') return
        stats.resumes += 1
        void nextContext.resume?.().catch(() => undefined)
      }

      if (nextContext.state === 'suspended' && nextContext.resume) {
        stats.resumes += 1
        await nextContext.resume()
      }
      if (epoch !== generation) {
        stats.cancelledStarts += 1
        releaseResources(pending)
        return
      }

      await nextContext.audioWorklet.addModule(options.workletUrl)
      if (epoch !== generation) {
        stats.cancelledStarts += 1
        releaseResources(pending)
        return
      }

      const deviceId = options.getDeviceId?.() ?? null
      const nextStream = await options.getUserMedia(buildAudioConstraints(deviceId))
      pending.stream = nextStream
      if (epoch !== generation) {
        stats.cancelledStarts += 1
        releaseResources(pending)
        return
      }

      const nextSource = nextContext.createMediaStreamSource(nextStream)
      pending.source = nextSource
      const nextWorklet = options.createWorkletNode(nextContext)
      pending.worklet = nextWorklet
      if (epoch !== generation) {
        stats.cancelledStarts += 1
        releaseResources(pending)
        return
      }

      // Commit: a partir daqui os handlers pertencem a esta geração.
      resources.stream = nextStream
      resources.source = nextSource
      resources.worklet = nextWorklet
      active = true
      committed = true

      for (const track of nextStream.getTracks()) {
        track.onended = () => {
          if (epoch !== generation || !active) return
          stats.trackEnded += 1
          options.logger?.warn('voice', 'microfone desconectado')
          stop()
          options.onTrackEnded?.()
        }
      }

      nextWorklet.port.onmessage = (event) => {
        if (epoch !== generation || !active) return
        stats.chunks += 1
        stats.bytes += event.data.byteLength
        options.onChunk(new Uint8Array(event.data))
      }
      nextSource.connect(nextWorklet)
      nextWorklet.connect(nextContext.destination)
    } catch (err) {
      const pendingContext = pending.context
      if (committed) {
        releaseResources(resources)
        active = false
      } else {
        releaseResources(pending)
        if (resources.context === pendingContext) resources.context = null
      }
      if (epoch === generation) {
        stats.errors += 1
        options.onError?.(err)
        options.logger?.warn('voice', 'falha ao iniciar a captura de microfone')
      }
    } finally {
      if (epoch === generation) starting = false
    }
  }

  return {
    start,
    stop,
    isActive: () => active,
    getStats: () => ({ ...stats })
  }
}
