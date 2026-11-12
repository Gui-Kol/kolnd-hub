// Sons do modo Big Picture via Web Audio API — sem assets, sem dependências.
// Notas curtas com envelope de ganho (ataque rápido, decaimento exponencial).
// Tons usam osciladores; o impacto da transição (T7) usa ruído branco + grave.
// Nunca lança exceção: erros de áudio não podem quebrar a navegação.
//
// O toggle "Efeitos sonoros" (Configurações → Big Picture → bigPicture.sounds)
// desliga TUDO; este módulo é sincronizado no mount do Big Picture via
// `setSfxEnabled(...)` e deve ser reaplicado a cada troca do toggle (T5).

export type SfxName =
  | 'move'
  | 'confirm'
  | 'back'
  | 'open'
  | 'error'
  | 'launch'
  | 'zap'
  | 'impact'
  | 'wave'

let audioContext: AudioContext | null = null
let enabled = true

/** Liga/desliga todos os SFX (espelha `bigPicture.sounds`). */
export function setSfxEnabled(value: boolean): void {
  enabled = Boolean(value)
}

export function isSfxEnabled(): boolean {
  return enabled
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audioContext) return audioContext
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioContext = new Ctor()
  } catch {
    audioContext = null
  }
  return audioContext
}

type ToneNote = {
  kind: 'tone'
  freq: number
  type: OscillatorType
  at: number // início relativo, em segundos
  duration: number // segundos
  peak: number // volume de pico (0–1)
}

type NoiseNote = {
  kind: 'noise'
  at: number
  duration: number // segundos
  peak: number
}

type SfxNote = ToneNote | NoiseNote

function tone(
  freq: number,
  type: OscillatorType,
  at: number,
  duration: number,
  peak: number
): ToneNote {
  return { kind: 'tone', freq, type, at, duration, peak }
}

const NOTES: Record<SfxName, SfxNote[]> = {
  // Navegação: blip agudo e curtíssimo.
  move: [tone(740, 'square', 0, 0.055, 0.05)],
  // Confirmar: dois tons ascendentes.
  confirm: [
    tone(523.25, 'triangle', 0, 0.09, 0.2),
    tone(783.99, 'triangle', 0.085, 0.16, 0.2)
  ],
  // Voltar: dois tons descendentes suaves.
  back: [tone(392.0, 'triangle', 0, 0.09, 0.16), tone(261.63, 'triangle', 0.08, 0.16, 0.16)],
  // Abrir (Big Picture pronto): acorde suave maior.
  open: [
    tone(523.25, 'triangle', 0, 0.5, 0.14),
    tone(659.25, 'triangle', 0.02, 0.5, 0.12),
    tone(783.99, 'sine', 0.04, 0.55, 0.12)
  ],
  // Erro: tom grave curto.
  error: [tone(130.81, 'sawtooth', 0, 0.2, 0.2)],
  // Lançar: varredura ascendente rápida.
  launch: [
    tone(392.0, 'square', 0, 0.07, 0.1),
    tone(587.33, 'square', 0.06, 0.07, 0.1),
    tone(783.99, 'triangle', 0.12, 0.22, 0.18)
  ],
  // Zap (T7, fase 2): estalo brilhante de "raio" (sawtooth agudo + harmônico quadrado).
  zap: [
    tone(1900, 'sawtooth', 0, 0.14, 0.2),
    tone(2650, 'square', 0.015, 0.07, 0.1),
    tone(950, 'sawtooth', 0.09, 0.16, 0.14)
  ],
  // Impacto (T7, fase 3): estrondo de ruído branco + batida grave.
  impact: [
    { kind: 'noise', at: 0, duration: 0.34, peak: 0.5 },
    tone(58, 'sine', 0, 0.45, 0.55),
    tone(130, 'sawtooth', 0, 0.16, 0.22)
  ],
  // Onda (T7, fase 4): "whoosh" subindo — senoide grave abrindo para cima.
  wave: [
    tone(160, 'sine', 0, 0.55, 0.22),
    tone(320, 'triangle', 0.09, 0.5, 0.18),
    tone(640, 'sine', 0.18, 0.6, 0.15)
  ]
}

export function playSfx(name: SfxName): void {
  if (!enabled) return
  try {
    const ctx = getContext()
    if (!ctx) return
    // O primeiro gesto do usuário (clique/botão/tecla) retoma o contexto suspenso.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)

    const now = ctx.currentTime
    for (const note of NOTES[name]) {
      const gain = ctx.createGain()
      if (note.kind === 'noise') {
        // Ruído branco curto (usado no impacto da transição).
        const length = Math.max(1, Math.floor(ctx.sampleRate * note.duration))
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
        const data = buffer.getChannelData(0)
        for (let i = 0; i < length; i += 1) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / length)
        }
        const source = ctx.createBufferSource()
        source.buffer = buffer
        gain.gain.setValueAtTime(0.0001, now + note.at)
        gain.gain.exponentialRampToValueAtTime(note.peak, now + note.at + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration)
        source.connect(gain)
        gain.connect(ctx.destination)
        source.start(now + note.at)
        source.stop(now + note.at + note.duration + 0.03)
        continue
      }
      const osc = ctx.createOscillator()
      osc.type = note.type
      osc.frequency.setValueAtTime(note.freq, now + note.at)
      gain.gain.setValueAtTime(0.0001, now + note.at)
      gain.gain.exponentialRampToValueAtTime(note.peak, now + note.at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + note.at)
      osc.stop(now + note.at + note.duration + 0.03)
    }
  } catch {
    // Erros de áudio nunca quebram a navegação.
  }
}
