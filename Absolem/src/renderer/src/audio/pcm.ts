/**
 * DSP mínimo da captura (task 06): downmix, redução 48k -> 16k e PCM16.
 *
 * Funções puras, sem Web Audio: o worklet (`pcm-worklet.js`) repete a mesma
 * matemática em JavaScript puro porque `AudioWorkletProcessor` não aceita
 * módulos TypeScript. Os testes garantem que os dois lados usam as mesmas
 * constantes (320 amostras por bloco de 20 ms = 640 bytes).
 */

export const TARGET_SAMPLE_RATE = 16_000
export const SOURCE_SAMPLE_RATE = 48_000
export const FRAME_MS = 20
export const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_MS) / 1000
export const FRAME_BYTES = FRAME_SAMPLES * 2

/** Média dos canais; canal único é copiado. */
export function downmixToMono(channels: ArrayLike<Float32Array>): Float32Array {
  if (channels.length === 0) return new Float32Array(0)
  if (channels.length === 1) return new Float32Array(channels[0])
  const length = channels[0].length
  const mono = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    let sum = 0
    for (let channel = 0; channel < channels.length; channel += 1) {
      sum += channels[channel][index] ?? 0
    }
    mono[index] = sum / channels.length
  }
  return mono
}

/**
 * Redução por média de janela (decisão do gate de qualidade: média simples é
 * suficiente para fala; se a transcrição piorar, entra um passa-baixa antes).
 */
export function resample48to16(
  input: Float32Array,
  sourceRate: number = SOURCE_SAMPLE_RATE,
  targetRate: number = TARGET_SAMPLE_RATE
): Float32Array {
  if (sourceRate === targetRate) return new Float32Array(input)
  if (sourceRate <= 0 || targetRate <= 0 || input.length === 0) return new Float32Array(0)

  const ratio = sourceRate / targetRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)))
    let sum = 0
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor]
    output[index] = sum / (end - start)
  }
  return output
}

/** Converte float [-1, 1] em Int16 com clamp (sem wrap). */
export function packInt16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0))
    output[index] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff)
  }
  return output
}

/** Corta um fluxo Int16 em blocos de 20 ms (último bloco pode ser parcial). */
export function splitPcm16Frames(
  samples: Int16Array,
  frameSamples: number = FRAME_SAMPLES
): Int16Array[] {
  if (samples.length === 0) return []
  const frames: Int16Array[] = []
  for (let offset = 0; offset < samples.length; offset += frameSamples) {
    frames.push(samples.subarray(offset, Math.min(samples.length, offset + frameSamples)))
  }
  return frames
}

/** Interpreta bytes PCM16 little-endian como Float32 [-1, 1] (VAD/playback). */
export function pcm16BytesToFloat(bytes: Uint8Array): Float32Array {
  const samples = Math.floor(bytes.byteLength / 2)
  const output = new Float32Array(samples)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < samples; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000
  }
  return output
}

/** RMS de um bloco PCM16, usado no nível do avatar e no timeout do main. */
export function pcm16Rms(bytes: Uint8Array): number {
  const samples = Math.floor(bytes.byteLength / 2)
  if (samples === 0) return 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  for (let index = 0; index < samples; index += 1) {
    const value = view.getInt16(index * 2, true) / 0x8000
    sum += value * value
  }
  return Math.min(1, Math.sqrt(sum / samples))
}
