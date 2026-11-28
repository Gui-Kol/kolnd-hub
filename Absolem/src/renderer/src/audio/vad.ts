/**
 * VAD local (task 06): energia RMS + piso de ruído adaptativo.
 *
 * Regras fechadas:
 * - ataque de 120 ms: só dispara se a energia ficar acima do limiar por 120 ms;
 * - histerese de saída de 500 ms: só encerra depois de 500 ms de silêncio;
 * - pre-roll de 300 ms: o bloco entregue no `speech-start` contém os 300 ms
 *   anteriores (o áudio já foi enviado ao Live em tempo real; o pre-roll existe
 *   para o indicador e para o teste de integração de T11);
 * - `listening`: o VAD só alimenta o indicador; quem decide barge-in é o
 *   controlador do overlay durante `speaking`.
 *
 * Função pura: nenhum acesso a Web Audio, microfone ou disco.
 */

export const VAD_SAMPLE_RATE = 16_000
export const VAD_ATTACK_MS = 120
export const VAD_RELEASE_MS = 500
export const VAD_PREROLL_MS = 300
export const VAD_MIN_RMS = 0.01
export const VAD_FLOOR_MULTIPLIER = 2.5
export const VAD_FLOOR_ADAPT = 0.08

export interface VadOptions {
  sampleRate?: number
  attackMs?: number
  releaseMs?: number
  prerollMs?: number
  minRms?: number
  floorMultiplier?: number
  floorAdapt?: number
}

export type VadEvent =
  { type: 'speech-start'; preroll: Float32Array; level: number } | { type: 'speech-end' }

export interface Vad {
  process: (frame: Float32Array | Int16Array, nowMs: number) => VadEvent[]
  isSpeaking: () => boolean
  getFloor: () => number
  getThreshold: () => number
  getLevel: () => number
}

export function frameRms(frame: Float32Array | Int16Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let index = 0; index < frame.length; index += 1) {
    const value = frame instanceof Int16Array ? (frame[index] ?? 0) / 0x8000 : (frame[index] ?? 0)
    sum += value * value
  }
  return Math.sqrt(sum / frame.length)
}

function toFloat(frame: Float32Array | Int16Array): Float32Array {
  if (frame instanceof Float32Array) return frame
  const output = new Float32Array(frame.length)
  for (let index = 0; index < frame.length; index += 1) {
    output[index] = (frame[index] ?? 0) / 0x8000
  }
  return output
}

export function createVad(options: VadOptions = {}): Vad {
  const sampleRate = options.sampleRate ?? VAD_SAMPLE_RATE
  const attackMs = options.attackMs ?? VAD_ATTACK_MS
  const releaseMs = options.releaseMs ?? VAD_RELEASE_MS
  const prerollMs = options.prerollMs ?? VAD_PREROLL_MS
  const minRms = options.minRms ?? VAD_MIN_RMS
  const floorMultiplier = options.floorMultiplier ?? VAD_FLOOR_MULTIPLIER
  const floorAdapt = options.floorAdapt ?? VAD_FLOOR_ADAPT

  let floor = minRms * 0.5
  let level = 0
  let speaking = false
  let speechRunMs = 0
  let silenceRunMs = 0
  let lastNow: number | null = null
  let ring: Float32Array[] = []

  const threshold = (): number => Math.max(minRms, floor * floorMultiplier)

  const pushRing = (frame: Float32Array): void => {
    const frameMs = (frame.length / sampleRate) * 1000
    const maxFrames = Math.max(1, Math.ceil(prerollMs / frameMs))
    ring.push(new Float32Array(frame))
    if (ring.length > maxFrames) ring = ring.slice(-maxFrames)
  }

  const flattenRing = (): Float32Array => {
    const total = ring.reduce((sum, frame) => sum + frame.length, 0)
    const output = new Float32Array(total)
    let offset = 0
    for (const frame of ring) {
      output.set(frame, offset)
      offset += frame.length
    }
    return output
  }

  const process = (frame: Float32Array | Int16Array, nowMs: number): VadEvent[] => {
    const samples = toFloat(frame)
    if (samples.length === 0) return []
    const frameMs = (samples.length / sampleRate) * 1000
    const deltaMs = lastNow === null ? frameMs : Math.max(0, nowMs - lastNow)
    lastNow = nowMs

    const currentLevel = frameRms(samples)
    level = currentLevel
    const limit = threshold()
    pushRing(samples)

    // Piso adaptativo: ruído de fundo estável é absorvido; fala não move o
    // piso porque só amostras abaixo do limiar entram na média.
    if (currentLevel <= limit && !speaking) {
      floor = floor * (1 - floorAdapt) + currentLevel * floorAdapt
    }

    const events: VadEvent[] = []
    if (currentLevel > limit) {
      speechRunMs += deltaMs
      silenceRunMs = 0
      if (!speaking && speechRunMs >= attackMs) {
        speaking = true
        events.push({ type: 'speech-start', preroll: flattenRing(), level: currentLevel })
      }
    } else {
      silenceRunMs += deltaMs
      if (!speaking) speechRunMs = 0
      if (speaking && silenceRunMs >= releaseMs) {
        speaking = false
        speechRunMs = 0
        events.push({ type: 'speech-end' })
      }
    }

    return events
  }

  return {
    process,
    isSpeaking: () => speaking,
    getFloor: () => floor,
    getThreshold: threshold,
    getLevel: () => level
  }
}
