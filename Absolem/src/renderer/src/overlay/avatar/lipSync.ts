import type { AvatarState } from '../../../../shared/avatar'

/**
 * Lip-sync por amplitude com visemas opcionais.
 *
 * A amplitude chega já calculada (RMS normalizado 0..1) da task 06; este módulo
 * não abre áudio nem conhece texto. Ataque e relaxamento são exponenciais com
 * constantes em segundos (40 ms / 120 ms): o ataque rápido evita atraso na
 * consoante e o relaxamento lento evita tremedeira. Um visema opcional
 * (`openness`/`width`/`closure`) sobrepõe a amplitude quando existir - é o
 * caminho para /m/, /b/, /p/, que a amplitude sozinha não cobre.
 *
 * A boca só abre em `speaking`. Em `listening` a mesma amplitude alimenta a
 * aura, nunca a boca (lição do avatar.py).
 */
export interface Viseme {
  openness: number
  width: number
  closure: number
}

export interface LipSyncOptions {
  attackSeconds?: number
  releaseSeconds?: number
  maxStepSeconds?: number
}

export interface LipSyncFrame {
  /** Abertura final da boca (0..1); 0 fora de `speaking`. */
  mouthOpen: number
  /** Largura alvo da boca (0..1), usada para esticar o mesh. */
  mouthWidth: number
  /** Intensidade da aura em `listening` (a mesma amplitude, outro destino). */
  aura: number
  /** Amplitude suavizada (independente do estado). */
  level: number
}

export interface LipSync {
  setLevel: (level: number) => void
  getLevel: () => number
  setViseme: (viseme: Viseme | null) => void
  setState: (state: AvatarState) => void
  getMouthOpen: () => number
  update: (deltaSeconds: number) => LipSyncFrame
}

export const ATTACK_SECONDS = 0.04
export const RELEASE_SECONDS = 0.12
export const LIP_SYNC_MAX_STEP_SECONDS = 0.05

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function createLipSync(options: LipSyncOptions = {}): LipSync {
  const attack = Math.max(0.005, options.attackSeconds ?? ATTACK_SECONDS)
  const release = Math.max(0.005, options.releaseSeconds ?? RELEASE_SECONDS)
  const maxStep = Math.max(0.005, options.maxStepSeconds ?? LIP_SYNC_MAX_STEP_SECONDS)

  let state: AvatarState = 'idle'
  let target = 0
  let smoothed = 0
  let viseme: Viseme | null = null
  let mouthOpen = 0

  return {
    setLevel(level: number): void {
      target = clamp01(level)
    },
    getLevel(): number {
      return smoothed
    },
    setViseme(next: Viseme | null): void {
      viseme = next
    },
    setState(next: AvatarState): void {
      state = next
      if (next !== 'speaking') mouthOpen = 0
    },
    getMouthOpen(): number {
      return mouthOpen
    },
    update(deltaSeconds: number): LipSyncFrame {
      const raw = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0
      const step = Math.min(raw, maxStep)

      // Envelope assimétrico: subir usa ataque, descer usa relaxamento.
      const tau = target >= smoothed ? attack : release
      const factor = 1 - Math.exp(-step / tau)
      smoothed += (target - smoothed) * factor
      smoothed = clamp01(smoothed)

      const visemeOpen = viseme
        ? clamp01(viseme.openness) * (1 - clamp01(viseme.closure))
        : smoothed
      const mouthWidth = viseme ? clamp01(viseme.width) : 0.5

      mouthOpen = state === 'speaking' ? clamp01(visemeOpen) : 0
      const aura =
        state === 'listening' ? smoothed : state === 'speaking' ? smoothed * 0.35 : smoothed * 0.1

      return { mouthOpen, mouthWidth, aura, level: smoothed }
    }
  }
}
