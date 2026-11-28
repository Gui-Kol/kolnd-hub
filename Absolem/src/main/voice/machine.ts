import {
  canTransition,
  describeTransition,
  type VoiceState,
  type VoiceStateChange
} from '../../shared/voice'
import type { AvatarState } from '../../shared/avatar'

/**
 * Máquina de estados da voz. O main é o dono: toda transição válida atualiza o
 * avatar (via callback injetado, sem IPC para si mesmo) e empurra `voice:state`.
 * Transição inválida é rejeitada e registrada; o estado não muda.
 */

export interface VoiceStateMachineOptions {
  initial?: VoiceState
  onState?: (change: VoiceStateChange) => void
  onAvatar?: (state: AvatarState) => void
  onRejected?: (from: VoiceState, to: VoiceState) => void
}

export function toAvatarState(state: VoiceState): AvatarState {
  switch (state) {
    case 'listening':
      return 'listening'
    case 'thinking':
    case 'connecting':
      return 'thinking'
    case 'speaking':
      return 'speaking'
    case 'error':
      return 'error'
    case 'off':
    default:
      return 'idle'
  }
}

export class VoiceStateMachine {
  private current: VoiceState
  private reason: string | null = null
  private readonly options: VoiceStateMachineOptions

  constructor(options: VoiceStateMachineOptions = {}) {
    this.options = options
    this.current = options.initial ?? 'off'
  }

  getState(): VoiceState {
    return this.current
  }

  getReason(): string | null {
    return this.reason
  }

  /** Atualiza o motivo sem mudar de estado (erro repetido do mesmo tipo). */
  setReason(reason: string | null): void {
    this.reason = reason
    this.options.onState?.({ state: this.current, ...(reason ? { reason } : {}) })
    this.options.onAvatar?.(toAvatarState(this.current))
  }

  transition(next: VoiceState, reason?: string): boolean {
    if (!canTransition(this.current, next)) {
      this.options.onRejected?.(this.current, next)
      return false
    }
    this.current = next
    this.reason = reason ?? null
    this.options.onState?.({ state: next, ...(reason ? { reason } : {}) })
    this.options.onAvatar?.(toAvatarState(next))
    return true
  }

  describeRejection(next: VoiceState): string {
    return `Transição de voz inválida: ${describeTransition(this.current, next)}`
  }
}
