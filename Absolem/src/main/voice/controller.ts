import type { AvatarState } from '../../shared/avatar'
import type { VoiceConfig } from '../../shared/config'
import type {
  VoiceAudioPush,
  VoiceSetDeviceRequest,
  VoiceState,
  VoiceStateChange,
  VoiceStatus,
  VoiceTranscriptPush
} from '../../shared/voice'
import { VOICE_REASONS } from '../../shared/voice'
import type { GeminiFunctionCall } from '../gemini/transport'
import { MICROPHONE_DENIED_MESSAGE } from './consent'
import { VoiceStateMachine } from './machine'

/**
 * Controlador da voz (main). Dono do estado, do consentimento, dos timers e da
 * sessão Live. O IPC é uma casca fina sobre esta classe; os testes montam o
 * controlador com sessão, relógio e callbacks falsos (nenhuma rede, nenhum
 * microfone).
 */

export interface VoiceSessionTranscript {
  role: 'user' | 'model'
  text: string
  final: boolean
}

export interface VoiceSessionHandlers {
  onAudio: (data: Uint8Array, sampleRate: number) => void
  onTranscript: (event: VoiceSessionTranscript) => void
  onToolCall: (calls: GeminiFunctionCall[]) => void
  onError: (error: { kind: string; message: string }) => void
  onClose: (reason: string) => void
  onInterrupted: () => void
  onTurnComplete: () => void
}

export interface VoiceSessionLike {
  connect: () => Promise<void>
  sendAudio: (pcm: Uint8Array) => void
  sendText: (text: string) => void
  interrupt: () => void
  close: (reason: string) => void
  appendHistory: (role: 'user' | 'model', text: string) => void
}

export interface VoiceHistoryLike {
  append: (role: 'user' | 'model', text: string) => void
}

export interface VoiceLoggerLike {
  debug: (scope: string, message: unknown, ...args: unknown[]) => void
  info: (scope: string, message: unknown, ...args: unknown[]) => void
  warn: (scope: string, message: unknown, ...args: unknown[]) => void
}

export interface VoiceControllerDeps {
  getConfig: () => VoiceConfig
  updateConfig: (patch: Partial<VoiceConfig>) => { success: boolean; error?: string }
  hasConsent: () => boolean
  persistConsent: (granted: boolean) => { ok: boolean; error?: string }
  /** Mostra o diálogo da primeira ativação e persiste a decisão. */
  requestConsent: () => Promise<boolean>
  hasApiKey: () => boolean
  checkBudget: () => void
  createSession: (handlers: VoiceSessionHandlers) => VoiceSessionLike
  setAvatarState: (state: AvatarState) => void
  pushState: (change: VoiceStateChange) => void
  pushAudio: (push: VoiceAudioPush) => void
  pushTranscript: (push: VoiceTranscriptPush) => void
  isOverlayVisible: () => boolean
  showOverlay: () => void
  notify: (message: string) => void
  /** Memória (task 09) desligada por padrão: transcrição não vai ao disco. */
  memoryEnabled: () => boolean
  history: VoiceHistoryLike
  logger?: VoiceLoggerLike
  now?: () => number
}

const MAX_DEVICE_ID_LENGTH = 200
const AUDIO_SPEECH_RMS = 0.02

interface TranscriptBuffer {
  text: string
  final: boolean
  closed: boolean
  persisted: boolean
}

function emptyBuffer(): TranscriptBuffer {
  return { text: '', final: false, closed: false, persisted: false }
}

function normalizeDeviceId(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_DEVICE_ID_LENGTH) return undefined
  return trimmed
}

function pcmRms(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.byteLength / 2)
  if (samples === 0) return 0
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let sum = 0
  for (let index = 0; index < samples; index += 1) {
    const value = view.getInt16(index * 2, true) / 0x8000
    sum += value * value
  }
  return Math.sqrt(sum / samples)
}

export class VoiceController {
  private readonly deps: VoiceControllerDeps
  private readonly machine: VoiceStateMachine
  private session: VoiceSessionLike | null = null
  private epoch = 0
  private consentAsked = false
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private transcripts = { user: emptyBuffer(), model: emptyBuffer() }

  constructor(deps: VoiceControllerDeps) {
    this.deps = deps
    this.machine = new VoiceStateMachine({
      onState: (change) => deps.pushState(change),
      onAvatar: (state) => deps.setAvatarState(state),
      onRejected: (from, to) => {
        deps.logger?.debug('voice', 'transição rejeitada', { from, to })
      }
    })
  }

  status(): VoiceStatus {
    const config = this.deps.getConfig()
    return {
      state: this.machine.getState(),
      reason: this.machine.getReason(),
      consentGranted: this.deps.hasConsent(),
      sessionActive: this.session !== null,
      inputDeviceId: config.inputDeviceId,
      outputDeviceId: config.outputDeviceId,
      outputVolume: config.outputVolume
    }
  }

  getState(): VoiceState {
    return this.machine.getState()
  }

  start(source: 'ipc' | 'shortcut' = 'ipc'): VoiceStatus {
    if (source === 'shortcut' && !this.deps.isOverlayVisible()) {
      this.deps.showOverlay()
      this.deps.notify('Absolem visível. Clique no avatar para falar.')
      return this.status()
    }
    if (this.machine.getState() !== 'off' && this.machine.getState() !== 'error') {
      return this.status()
    }
    if (!this.deps.hasApiKey()) {
      this.fail('Chave do Gemini não configurada.')
      return this.status()
    }
    try {
      this.deps.checkBudget()
    } catch (err) {
      this.fail(err instanceof Error ? err.message : 'Limite de custo atingido.')
      return this.status()
    }

    if (this.machine.getState() === 'error') {
      // `error -> connecting` é válido; o motivo antigo é descartado.
    }
    this.machine.transition('connecting', source)
    const epoch = ++this.epoch
    void this.beginStart(epoch)
    return this.status()
  }

  stop(reason: string = VOICE_REASONS.user): VoiceStatus {
    this.epoch += 1
    this.clearTimers()
    const session = this.session
    this.session = null
    this.transcripts = { user: emptyBuffer(), model: emptyBuffer() }
    if (session) {
      try {
        session.close(reason)
      } catch {
        // Sessão já encerrada.
      }
    }
    if (this.machine.getState() !== 'off') {
      this.machine.transition('off', reason)
    }
    return this.status()
  }

  toggle(source: 'ipc' | 'shortcut' = 'ipc'): VoiceStatus {
    const state = this.machine.getState()
    if (state === 'off' || state === 'error') return this.start(source)
    return this.stop(source === 'shortcut' ? VOICE_REASONS.shortcut : VOICE_REASONS.user)
  }

  interrupt(): VoiceStatus {
    if (this.session) this.session.interrupt()
    const state = this.machine.getState()
    if (state === 'speaking' || state === 'thinking') {
      this.machine.transition('listening', VOICE_REASONS.interrupted)
    }
    return this.status()
  }

  setConsent(granted: boolean): { ok: boolean; status: VoiceStatus; error?: string } {
    const result = this.deps.persistConsent(granted)
    if (!result.ok) {
      return {
        ok: false,
        status: this.status(),
        error: result.error ?? 'Não foi possível salvar o consentimento.'
      }
    }
    if (!granted) {
      this.consentAsked = true
      if (this.session || this.machine.getState() !== 'off') {
        this.stop(VOICE_REASONS.consentDenied)
      }
      this.fail(MICROPHONE_DENIED_MESSAGE)
      return { ok: true, status: this.status() }
    }
    this.consentAsked = false
    if (this.machine.getState() === 'error') {
      this.machine.transition('off', 'consent')
    }
    return { ok: true, status: this.status() }
  }

  setDevice(request: VoiceSetDeviceRequest): {
    ok: boolean
    status: VoiceStatus
    error?: string
  } {
    const patch: Partial<VoiceConfig> = {}
    if (request.inputDeviceId !== undefined) {
      const input = normalizeDeviceId(request.inputDeviceId)
      if (input === undefined) {
        return { ok: false, status: this.status(), error: 'Dispositivo de entrada inválido.' }
      }
      patch.inputDeviceId = input
    }
    if (request.outputDeviceId !== undefined) {
      const output = normalizeDeviceId(request.outputDeviceId)
      if (output === undefined) {
        return { ok: false, status: this.status(), error: 'Dispositivo de saída inválido.' }
      }
      patch.outputDeviceId = output
    }
    if (Object.keys(patch).length === 0) {
      return { ok: false, status: this.status(), error: 'Nenhum dispositivo informado.' }
    }

    // Nunca trocar de dispositivo no meio de uma fala: encerra a sessão.
    if (this.session || this.machine.getState() !== 'off') {
      this.stop(VOICE_REASONS.deviceChanged)
      this.deps.notify('Dispositivo de áudio alterado: a sessão de voz foi encerrada.')
    }
    const result = this.deps.updateConfig(patch)
    if (!result.success) {
      return { ok: false, status: this.status(), error: result.error ?? 'Falha ao salvar.' }
    }
    return { ok: true, status: this.status() }
  }

  handleAudioChunk(data: unknown): void {
    if (!(data instanceof Uint8Array) || data.byteLength === 0) return
    if (data.byteLength % 2 !== 0 || data.byteLength > 65_536) return
    const state = this.machine.getState()
    if (!this.session || state === 'off' || state === 'error' || state === 'connecting') return
    if (pcmRms(data) >= AUDIO_SPEECH_RMS) this.armSilenceTimer()
    this.session.sendAudio(data)
  }

  handleBargeIn(): void {
    this.deps.logger?.debug('voice', 'barge-in recebido do renderer')
    // O pre-roll de 300 ms não precisa ser reenviado: os chunks anteriores já
    // foram transmitidos ao Live em tempo real; aqui só interrompemos a
    // geração e voltamos a ouvir.
    this.session?.interrupt()
    this.armSilenceTimer()
    const state = this.machine.getState()
    if (state === 'speaking' || state === 'thinking') {
      this.machine.transition('listening', VOICE_REASONS.bargeIn)
    }
  }

  handleSilence(): void {
    // O VAD local já corta a reprodução; o timeout do main é medido pela RMS
    // dos chunks de áudio. O evento existe para o indicador da task 11.
  }

  notifyOverlayHidden(): void {
    if (this.machine.getState() === 'off') return
    this.stop(VOICE_REASONS.hide)
  }

  shutdown(): void {
    if (this.machine.getState() === 'off' && !this.session) return
    this.stop(VOICE_REASONS.shutdown)
  }

  private async beginStart(epoch: number): Promise<void> {
    if (!this.deps.hasConsent()) {
      if (this.consentAsked) {
        this.fail(MICROPHONE_DENIED_MESSAGE)
        return
      }
      this.consentAsked = true
      const granted = await this.deps.requestConsent()
      if (epoch !== this.epoch) return
      if (!granted || !this.deps.hasConsent()) {
        this.fail(MICROPHONE_DENIED_MESSAGE)
        return
      }
    }

    if (epoch !== this.epoch || this.machine.getState() !== 'connecting') return
    try {
      const session = this.deps.createSession(this.buildHandlers(epoch))
      this.session = session
      await session.connect()
      if (epoch !== this.epoch || this.machine.getState() !== 'connecting') {
        session.close('cancelled')
        return
      }
      this.transcripts = { user: emptyBuffer(), model: emptyBuffer() }
      this.machine.transition('listening', 'connected')
      this.armSilenceTimer()
      this.armSessionTimer()
    } catch (err) {
      if (epoch !== this.epoch) return
      const message = err instanceof Error ? err.message : 'Falha ao conectar a voz.'
      this.fail(message)
    }
  }

  private buildHandlers(epoch: number): VoiceSessionHandlers {
    return {
      onAudio: (data, sampleRate) => {
        if (epoch !== this.epoch) return
        const state = this.machine.getState()
        if (state === 'listening') {
          this.machine.transition('thinking', 'response')
        }
        if (this.machine.getState() === 'thinking') {
          this.machine.transition('speaking', 'audio')
        }
        this.deps.pushAudio({ data, sampleRate })
        this.armSilenceTimer()
      },
      onTranscript: (event) => {
        if (epoch !== this.epoch) return
        this.handleTranscript(event)
      },
      onToolCall: (calls) => {
        if (epoch !== this.epoch) return
        // A execução de tools da Live fica para a task 08; aqui só não se perde
        // o evento (log sem conteúdo sensível).
        this.deps.logger?.debug('voice', 'tool call recebida do Live', {
          count: calls.length
        })
      },
      onError: (error) => {
        if (epoch !== this.epoch) return
        this.fail(error.message)
      },
      onClose: (reason) => {
        if (epoch !== this.epoch) return
        this.session = null
        this.clearTimers()
        if (this.machine.getState() !== 'off' && this.machine.getState() !== 'error') {
          this.machine.transition('off', reason)
        }
      },
      onInterrupted: () => {
        if (epoch !== this.epoch) return
        this.handleInterrupted()
      },
      onTurnComplete: () => {
        if (epoch !== this.epoch) return
        this.transcripts = { user: emptyBuffer(), model: emptyBuffer() }
        const state = this.machine.getState()
        if (state === 'speaking' || state === 'thinking') {
          this.machine.transition('listening', VOICE_REASONS.turnComplete)
        }
      }
    }
  }

  private handleTranscript(event: VoiceSessionTranscript): void {
    const text = typeof event.text === 'string' ? event.text : ''
    if (!text) return
    const buffer = this.transcripts[event.role]
    if (event.final) {
      buffer.text = text
      buffer.final = true
      buffer.closed = true
      this.deps.pushTranscript({ role: event.role, text, final: true, interrupted: false })
      this.persistTurn(event.role, text)
      return
    }
    // Parcial depois de final não substitui o texto final do turno.
    if (buffer.closed) return
    buffer.text = text
    buffer.final = false
    this.deps.pushTranscript({ role: event.role, text, final: false, interrupted: false })
  }

  private handleInterrupted(): void {
    const model = this.transcripts.model
    if (model.text) {
      this.deps.pushTranscript({
        role: 'model',
        text: model.text,
        final: model.final,
        interrupted: true
      })
      this.session?.appendHistory('model', model.text)
      if (!model.final && !model.persisted) {
        model.persisted = true
        this.persistTurn('model', model.text)
      }
      model.closed = true
    }
    const state = this.machine.getState()
    if (state === 'speaking' || state === 'thinking') {
      this.machine.transition('listening', VOICE_REASONS.interrupted)
    }
  }

  private persistTurn(role: 'user' | 'model', text: string): void {
    // Histórico textual em memória da sessão: usado na reconexão do Live.
    this.session?.appendHistory(role, text)
    if (!this.deps.memoryEnabled()) return
    try {
      this.deps.history.append(role, text)
    } catch (err) {
      this.deps.logger?.warn('voice', 'falha ao gravar transcrição na memória', err)
    }
  }

  private fail(message: string): void {
    this.epoch += 1
    this.clearTimers()
    const session = this.session
    this.session = null
    this.transcripts = { user: emptyBuffer(), model: emptyBuffer() }
    if (session) {
      try {
        session.close('error')
      } catch {
        // Sessão já encerrada.
      }
    }
    if (this.machine.getState() === 'error') {
      this.machine.setReason(message)
    } else {
      this.machine.transition('error', message)
    }
    this.deps.logger?.warn('voice', 'voz em estado de erro', { message })
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    const seconds = Math.max(1, this.deps.getConfig().silenceTimeoutSeconds)
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null
      if (this.machine.getState() === 'off' || this.machine.getState() === 'error') return
      this.stop(VOICE_REASONS.timeoutSilence)
      this.deps.notify(`Sessão de voz encerrada após ${seconds} s sem fala.`)
    }, seconds * 1000)
  }

  private armSessionTimer(): void {
    if (this.maxTimer) clearTimeout(this.maxTimer)
    const minutes = Math.max(1, this.deps.getConfig().maxSessionMinutes)
    this.maxTimer = setTimeout(
      () => {
        this.maxTimer = null
        if (this.machine.getState() === 'off' || this.machine.getState() === 'error') return
        this.stop(VOICE_REASONS.timeoutMaxDuration)
        this.deps.notify(`Sessão de voz encerrada após ${minutes} min (limite de custo).`)
      },
      minutes * 60 * 1000
    )
  }

  private clearTimers(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    if (this.maxTimer) clearTimeout(this.maxTimer)
    this.silenceTimer = null
    this.maxTimer = null
  }
}
