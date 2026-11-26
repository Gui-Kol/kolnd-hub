import { MAX_CAPTURES_PER_HOUR, PROACTIVE_MIN_INTERVAL_MS } from '../../shared/screen'
import type { VoiceState } from '../../shared/voice'
import type { CaptureFailureCode } from './controller'

/**
 * Limites de captura (task 07, T8).
 *
 * - 20 capturas por hora, em memória (reiniciar o app zera a janela);
 * - modo proativo: no máximo 1 captura a cada 60 s e apenas com voz em
 *   `listening`; a flag `privacy.screen.proactive` é checada antes;
 * - teto mensal do motor (task 05) é consultado antes de qualquer pixel: se
 *   estourou, a captura é recusada com a mensagem do medidor.
 *
 * O estado é somente de contagem: nenhum título, imagem ou pergunta é mantido.
 */

export const CAPTURE_HOUR_MS = 60 * 60 * 1000

export type CaptureLimitReason =
  'hourly' | 'proactive-off' | 'proactive-interval' | 'voice-not-listening' | 'monthly'

export type CaptureLimitDecision =
  | { ok: true }
  | { ok: false; reason: CaptureLimitReason; code: CaptureFailureCode; message: string }

export interface CaptureLimiterOptions {
  now?: () => number
  maxPerHour?: number
  proactiveMinIntervalMs?: number
  /** Lança quando o teto mensal já foi atingido (task 05). */
  checkBudget?: () => void
}

export interface CaptureLimitCheckInput {
  proactive: boolean
  /** `privacy.screen.proactive`; `undefined` não bloqueia (compatibilidade). */
  proactiveEnabled?: boolean
  voiceState: VoiceState | null
  now?: number
}

export interface CaptureLimitSnapshot {
  capturesLastHour: number
  maxPerHour: number
}

export class CaptureLimiter {
  private readonly now: () => number
  private readonly maxPerHour: number
  private readonly proactiveMinIntervalMs: number
  private readonly checkBudget?: () => void
  private timestamps: number[] = []
  private lastProactiveAt: number | null = null

  constructor(options: CaptureLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.maxPerHour = options.maxPerHour ?? MAX_CAPTURES_PER_HOUR
    this.proactiveMinIntervalMs = options.proactiveMinIntervalMs ?? PROACTIVE_MIN_INTERVAL_MS
    this.checkBudget = options.checkBudget
  }

  private recent(now: number): number[] {
    const cutoff = now - CAPTURE_HOUR_MS
    this.timestamps = this.timestamps.filter((at) => at > cutoff)
    return this.timestamps
  }

  check(input: CaptureLimitCheckInput): CaptureLimitDecision {
    const now = input.now ?? this.now()
    if (this.checkBudget) {
      try {
        this.checkBudget()
      } catch (err) {
        return {
          ok: false,
          reason: 'monthly',
          code: 'quota',
          message:
            err instanceof Error
              ? err.message
              : 'Teto mensal de tokens atingido. Ajuste o limite nas configurações.'
        }
      }
    }

    if (input.proactive && input.proactiveEnabled === false) {
      return {
        ok: false,
        reason: 'proactive-off',
        code: 'limit',
        message:
          'Captura proativa desligada. Ative privacy.screen.proactive nas configurações para permitir.'
      }
    }
    if (input.proactive && input.voiceState !== 'listening') {
      return {
        ok: false,
        reason: 'voice-not-listening',
        code: 'limit',
        message: 'Captura proativa só acontece com a sessão de voz ouvindo.'
      }
    }
    if (input.proactive && this.lastProactiveAt !== null) {
      const elapsed = now - this.lastProactiveAt
      if (elapsed < this.proactiveMinIntervalMs) {
        const wait = Math.max(1, Math.ceil((this.proactiveMinIntervalMs - elapsed) / 1000))
        return {
          ok: false,
          reason: 'proactive-interval',
          code: 'limit',
          message: `Captura proativa limitada a uma a cada 60 s. Tente de novo em ${wait} s.`
        }
      }
    }
    if (this.recent(now).length >= this.maxPerHour) {
      return {
        ok: false,
        reason: 'hourly',
        code: 'limit',
        message:
          `Limite de ${this.maxPerHour} capturas por hora atingido. ` +
          'Aguarde a janela de uma hora ou reduza o uso pelo modo proativo.'
      }
    }
    return { ok: true }
  }

  record(info: { at?: number; proactive?: boolean } = {}): void {
    const at = info.at ?? this.now()
    this.recent(at)
    this.timestamps.push(at)
    if (info.proactive === true) this.lastProactiveAt = at
  }

  snapshot(now: number = this.now()): CaptureLimitSnapshot {
    return { capturesLastHour: this.recent(now).length, maxPerHour: this.maxPerHour }
  }

  reset(): void {
    this.timestamps = []
    this.lastProactiveAt = null
  }
}

export function createCaptureLimiter(options: CaptureLimiterOptions = {}): CaptureLimiter {
  return new CaptureLimiter(options)
}
