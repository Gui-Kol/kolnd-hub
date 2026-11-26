/**
 * Reprodução do áudio do modelo (task 06).
 *
 * - PCM16 24 kHz (taxa do Live) convertido para Float32 em `AudioBuffer`;
 * - `start(nextTime)` com 60 ms de folga: nenhum buffer começa antes do fim do
 *   anterior, então não há sobreposição nem estalo de descontinuidade;
 * - `flush()` (barge-in) descarta o que ainda não começou, para o que já está
 *   tocando depois do fade e zera o ganho em 20 ms;
 * - `setOutputDevice` usa `setSinkId` quando o Chromium oferece; senão mantém a
 *   saída padrão e registra.
 *
 * O `AudioContext` é injetado: os testes rodam em Node sem Web Audio.
 */

export interface AudioParamLike {
  value: number
  setValueAtTime: (value: number, time: number) => void
  linearRampToValueAtTime: (value: number, time: number) => void
}

export interface GainNodeLike {
  gain: AudioParamLike
  connect: (destination: unknown) => void
  disconnect?: () => void
}

export interface AudioBufferLike {
  duration: number
  getChannelData: (channel: number) => Float32Array
}

export interface AudioBufferSourceLike {
  buffer: AudioBufferLike | null
  onended: (() => void) | null
  connect: (destination: unknown) => void
  start: (when?: number) => void
  stop: (when?: number) => void
}

export interface PlaybackAudioContextLike {
  currentTime: number
  state?: string
  destination: unknown
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBufferLike
  createBufferSource: () => AudioBufferSourceLike
  createGain: () => GainNodeLike
  setSinkId?: (deviceId: string) => Promise<void>
  resume?: () => Promise<void>
}

export interface PlaybackLoggerLike {
  warn: (scope: string, message: unknown) => void
  info?: (scope: string, message: unknown) => void
}

export interface PlaybackOptions {
  context: PlaybackAudioContextLike
  /** Volume 0..1 (pode ser lido a cada buffer). */
  getVolume?: () => number
  headroomMs?: number
  fadeMs?: number
  logger?: PlaybackLoggerLike
}

export interface Playback {
  enqueue: (pcm: Uint8Array | Int16Array, sampleRate?: number) => void
  flush: () => void
  setOutputDevice: (deviceId: string | null) => Promise<boolean>
  pending: () => number
  getLastLevel: () => number
  dispose: () => void
}

export const PLAYBACK_SAMPLE_RATE = 24_000
export const PLAYBACK_HEADROOM_MS = 60
export const PLAYBACK_FADE_MS = 20

interface ScheduledBuffer {
  source: AudioBufferSourceLike
  startAt: number
  endAt: number
}

function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}

function decodePcm16(pcm: Uint8Array | Int16Array): Float32Array {
  if (pcm instanceof Int16Array) {
    const output = new Float32Array(pcm.length)
    for (let index = 0; index < pcm.length; index += 1) {
      output[index] = (pcm[index] ?? 0) / 0x8000
    }
    return output
  }
  if (pcm.byteLength < 2) return new Float32Array(0)
  const samples = Math.floor(pcm.byteLength / 2)
  const output = new Float32Array(samples)
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  for (let index = 0; index < samples; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000
  }
  return output
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0
    sum += value * value
  }
  return Math.min(1, Math.sqrt(sum / samples.length))
}

export function createPlayback(options: PlaybackOptions): Playback {
  const { context } = options
  const headroom = (options.headroomMs ?? PLAYBACK_HEADROOM_MS) / 1000
  const fade = (options.fadeMs ?? PLAYBACK_FADE_MS) / 1000
  const getVolume = () => clampVolume(options.getVolume?.() ?? 1)

  const master = context.createGain()
  master.gain.value = getVolume()
  master.connect(context.destination)

  let scheduled: ScheduledBuffer[] = []
  let nextTime = 0
  let lastLevel = 0
  let disposed = false

  const enqueue = (pcm: Uint8Array | Int16Array, sampleRate = PLAYBACK_SAMPLE_RATE): void => {
    if (disposed) return
    const samples = decodePcm16(pcm)
    if (samples.length === 0) return
    if (context.state === 'suspended') void context.resume?.().catch(() => undefined)

    const buffer = context.createBuffer(1, samples.length, sampleRate)
    buffer.getChannelData(0).set(samples)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(master)

    const startAt = Math.max(context.currentTime + headroom, nextTime)
    const endAt = startAt + buffer.duration
    nextTime = endAt
    lastLevel = rms(samples)
    source.onended = () => {
      scheduled = scheduled.filter((entry) => entry.source !== source)
    }
    const entry: ScheduledBuffer = { source, startAt, endAt }
    scheduled.push(entry)
    source.start(startAt)
  }

  const flush = (): void => {
    if (disposed) return
    const now = context.currentTime
    const fadeEnd = now + fade
    master.gain.setValueAtTime(master.gain.value, now)
    master.gain.linearRampToValueAtTime(0, fadeEnd)
    // Restaura o volume depois do fade; o próximo buffer só começa com a
    // folga de 60 ms, então não há áudio novo durante a rampa.
    master.gain.setValueAtTime(getVolume(), fadeEnd + 0.001)

    for (const entry of scheduled) {
      try {
        // Antes de `startAt` o stop cancela o buffer (descarte); depois, para
        // no fim do fade em vez de cortar seco.
        entry.source.stop(entry.startAt >= now ? now : fadeEnd)
      } catch {
        // Buffer já terminou entre o flush e o stop.
      }
    }
    scheduled = []
    nextTime = 0
    lastLevel = 0
  }

  const setOutputDevice = async (deviceId: string | null): Promise<boolean> => {
    if (!deviceId) return false
    if (typeof context.setSinkId !== 'function') {
      options.logger?.warn('voice', 'setSinkId indisponível; mantendo a saída padrão')
      return false
    }
    try {
      await context.setSinkId(deviceId)
      options.logger?.info?.('voice', 'saída de áudio alterada')
      return true
    } catch {
      options.logger?.warn('voice', 'falha ao trocar a saída de áudio; mantendo a padrão')
      return false
    }
  }

  return {
    enqueue,
    flush,
    setOutputDevice,
    pending: () => scheduled.length,
    getLastLevel: () => lastLevel,
    dispose: () => {
      if (disposed) return
      flush()
      disposed = true
      try {
        master.disconnect?.()
      } catch {
        // best-effort
      }
    }
  }
}
