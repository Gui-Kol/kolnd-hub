/**
 * Worklet de captura do Absolem (JavaScript puro de proposito).
 *
 * `AudioWorklet.addModule` nao aceita TypeScript: o Vite emite este arquivo
 * como asset via `import url from './pcm-worklet.js?url'`. O processador
 * recebe blocos de 128 frames, faz downmix, reduz para 16 kHz por media de
 * janela, empacota Int16 e posta blocos de 20 ms (320 amostras = 640 bytes).
 *
 * A matematica espelha `pcm.ts`; os testes de `pcm.test.ts` travam as
 * constantes. Nada aqui toca no disco nem na rede.
 */

const TARGET_SAMPLE_RATE = 16000
const FRAME_SAMPLES = 320

class AbsolemPcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ratio = sampleRate / TARGET_SAMPLE_RATE
    this.mono = new Float32Array(4096)
    this.monoLength = 0
    this.readPosition = 0
    this.outSamples = []
  }

  appendMono(input) {
    const frames = input[0].length
    const channels = input.length
    if (this.monoLength + frames > this.mono.length) {
      const grown = new Float32Array(Math.max(this.mono.length * 2, this.monoLength + frames))
      grown.set(this.mono.subarray(0, this.monoLength))
      this.mono = grown
    }
    for (let index = 0; index < frames; index += 1) {
      let sum = 0
      for (let channel = 0; channel < channels; channel += 1) {
        sum += input[channel][index] || 0
      }
      this.mono[this.monoLength + index] = sum / channels
    }
    this.monoLength += frames
  }

  emitFrames() {
    while (this.outSamples.length >= FRAME_SAMPLES) {
      const chunk = new Int16Array(FRAME_SAMPLES)
      for (let index = 0; index < FRAME_SAMPLES; index += 1) {
        const value = Math.max(-1, Math.min(1, this.outSamples[index]))
        chunk[index] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff)
      }
      this.outSamples.splice(0, FRAME_SAMPLES)
      this.port.postMessage(chunk.buffer, [chunk.buffer])
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0 || !input[0]) return true
    this.appendMono(input)

    while (this.readPosition + this.ratio <= this.monoLength) {
      const start = Math.floor(this.readPosition)
      const end = Math.min(
        this.monoLength,
        Math.max(start + 1, Math.floor(this.readPosition + this.ratio))
      )
      let sum = 0
      for (let cursor = start; cursor < end; cursor += 1) sum += this.mono[cursor]
      this.outSamples.push(sum / (end - start))
      this.readPosition += this.ratio
    }

    if (this.readPosition > 2048) {
      const remaining = this.monoLength - Math.floor(this.readPosition)
      this.mono.copyWithin(0, Math.floor(this.readPosition), this.monoLength)
      this.monoLength = Math.max(0, remaining)
      this.readPosition -= Math.floor(this.readPosition)
    }

    this.emitFrames()
    return true
  }
}

registerProcessor('absolem-pcm16', AbsolemPcm16Processor)
