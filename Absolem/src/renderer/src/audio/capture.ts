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
 * - cada bloco de 20 ms vira `Uint8Array` e sai sem cópia extra.
 */

export interface MediaStreamTrackLike {
  stop: () => void
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
  logger?: { warn: (scope: string, message: unknown) => void }
}

export interface PcmCapture {
  start: () => Promise<void>
  stop: () => void
  isActive: () => boolean
}

export function createPcmCapture(options: PcmCaptureOptions): PcmCapture {
  let context: AudioContextLike | null = null
  let stream: MediaStreamLike | null = null
  let source: AudioNodeLike | null = null
  let worklet: AudioWorkletNodeLike | null = null
  let starting = false
  let active = false

  const release = (): void => {
    if (worklet) {
      try {
        worklet.port.onmessage = null
        worklet.disconnect()
        worklet.port.close?.()
      } catch {
        // O contexto pode já ter sido fechado pelo Chromium.
      }
      worklet = null
    }
    if (source) {
      try {
        source.disconnect()
      } catch {
        // best-effort
      }
      source = null
    }
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          // track já encerrada
        }
      }
      stream = null
    }
    if (context) {
      void context.close?.().catch(() => undefined)
      context = null
    }
    active = false
  }

  const stop = (): void => {
    if (!active && !starting) return
    starting = false
    release()
  }

  const start = async (): Promise<void> => {
    if (active || starting) return
    starting = true
    try {
      const deviceId = options.getDeviceId?.() ?? null
      const nextContext = options.createContext()
      context = nextContext
      if (nextContext.state === 'suspended' && nextContext.resume) {
        await nextContext.resume()
      }
      await nextContext.audioWorklet.addModule(options.workletUrl)
      const nextStream = await options.getUserMedia(buildAudioConstraints(deviceId))
      stream = nextStream
      const nextSource = nextContext.createMediaStreamSource(nextStream)
      source = nextSource
      const nextWorklet = options.createWorkletNode(nextContext)
      worklet = nextWorklet
      nextWorklet.port.onmessage = (event) => {
        options.onChunk(new Uint8Array(event.data))
      }
      nextSource.connect(nextWorklet)
      nextWorklet.connect(nextContext.destination)
      active = true
    } catch (err) {
      release()
      options.onError?.(err)
      options.logger?.warn('voice', 'falha ao iniciar a captura de microfone')
    } finally {
      starting = false
    }
  }

  return {
    start,
    stop,
    isActive: () => active
  }
}
