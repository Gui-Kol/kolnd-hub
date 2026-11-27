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
import type { GeminiFunctionCall, GeminiFunctionResponse } from '../gemini/transport'
import type { ToolCallResult } from '../gemini/tools/router'
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
  sendToolResponse?: (responses: GeminiFunctionResponse[]) => void
  interrupt: () => void
  close: (reason: string) => void
  appendHistory: (role: 'user' | 'model', text: string) => void
}

export interface VoiceHistoryLike {
  append: (role: 'user' | 'model', text: string, interrupted?: boolean) => void
  /** Memória de longo prazo (task 09): sessão/turnos no SQLite. */
  beginSession?: (sessionId: string, at: number) => void
  endSession?: (sessionId: string, at: number) => void
  appendTurn?: (turn: VoiceHistoryTurn) => void
}

export interface VoiceHistoryTurn {
  sessionId: string
  role: 'user' | 'model'
  content: string
  at: number
  interrupted: boolean
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
  /** Roteador composto da task 08 (permissão → confirmação → execução). */
  routeToolCall?: (call: GeminiFunctionCall) => Promise<ToolCallResult>
  isOverlayVisible: () => boolean
  showOverlay: () => void
  notify: (message: string) => void
  /** Cancela a saudação em andamento (qualquer início de voz a interrompe). */
  cancelGreeting?: () => void
  /** Memória (task 09) desligada por padrão: transcrição não vai ao disco. */
  memoryEnabled: () => boolean
  history: VoiceHistoryLike
  logger?: VoiceLoggerLike
  now?: () => number
}

const MAX_DEVICE_ID_LENGTH = 200
const AUDIO_SPEECH_RMS = 0.02
/** Espera máxima pela fala de confirmação depois de uma ferramenta. */
export const TOOL_REPLY_GUARD_MS = 6_000
export const TOOL_REPLY_NUDGE =
  'Responda ao usuário em uma frase curta o resultado da ação que você acabou de executar, sucesso ou falha.'

interface TranscriptBuffer {
  text: string
  final: boolean
  closed: boolean
  persisted: boolean
}

function emptyBuffer(): TranscriptBuffer {
  return { text: '', final: false, closed: false, persisted: false }
}

/**
 * Frase pronta devolvida por ferramentas de ação (`result.message`). Só entra
 * no histórico sintético depois de uma execução ok e fica limitada a 200 chars.
 */
function toolResultMessage(result: ToolCallResult): string | undefined {
  if (!result.ok) return undefined
  const value = result.result
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const message = (value as Record<string, unknown>).message
  if (typeof message !== 'string') return undefined
  const trimmed = message.trim()
  return trimmed ? trimmed.slice(0, 200) : undefined
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
  /** Vigia de confirmação após `sendToolResponse` (um nudge por rodada). */
  private toolReplyTimer: ReturnType<typeof setTimeout> | null = null
  private toolReplyPending = false
  private toolReplyNudged = false
  private transcripts = { user: emptyBuffer(), model: emptyBuffer() }
  private memorySessionId: string | null = null

  constructor(deps: VoiceControllerDeps) {
    this.deps = deps
    this.machine = new VoiceStateMachine({
      onState: (change) => {
        deps.logger?.info('voice', 'estado alterado', {
          state: change.state,
          reason: change.reason
        })
        deps.pushState(change)
      },
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
      outputVolume: config.outputVolume,
      bargeIn: config.bargeIn !== false
    }
  }

  getState(): VoiceState {
    return this.machine.getState()
  }

  start(source: 'ipc' | 'shortcut' = 'ipc'): VoiceStatus {
    this.deps.logger?.info('voice', 'início solicitado', {
      source,
      state: this.machine.getState(),
      consent: this.deps.hasConsent(),
      overlay: this.deps.isOverlayVisible()
    })
    this.deps.cancelGreeting?.()
    if (!this.deps.isOverlayVisible()) {
      if (source === 'shortcut') {
        this.deps.logger?.warn('voice', 'atalho recebido com overlay oculto')
        this.deps.showOverlay()
        this.deps.notify('Absolem visível. Clique no avatar para falar.')
        return this.status()
      }
      this.fail('Absolem está desativado. Ative o overlay para falar.')
      return this.status()
    }
    if (this.machine.getState() !== 'off' && this.machine.getState() !== 'error') {
      return this.status()
    }
    if (!this.deps.hasApiKey()) {
      this.deps.logger?.warn('voice', 'voz bloqueada: chave ausente')
      this.fail('Chave do Gemini não configurada.')
      return this.status()
    }
    try {
      this.deps.checkBudget()
    } catch (err) {
      this.deps.logger?.warn('voice', 'voz bloqueada pelo orçamento', {
        type: err instanceof Error ? err.name : typeof err
      })
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
    this.deps.logger?.info('voice', 'parada solicitada', {
      reason,
      state: this.machine.getState(),
      hadSession: this.session !== null
    })
    this.epoch += 1
    this.clearTimers()
    this.finishMemorySession()
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
    this.deps.logger?.info('voice', 'consentimento recebido', { granted })
    const result = this.deps.persistConsent(granted)
    if (!result.ok) {
      this.deps.logger?.warn('voice', 'falha ao persistir consentimento', {
        granted,
        errorType: result.error ? 'storage' : 'unknown'
      })
      return {
        ok: false,
        status: this.status(),
        error: result.error ?? 'Não foi possível salvar o consentimento.'
      }
    }
    if (!granted) {
      this.deps.logger?.warn('voice', 'consentimento negado')
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
    if (!(data instanceof Uint8Array) || data.byteLength === 0) {
      this.deps.logger?.debug('voice', 'chunk de microfone ignorado', { valid: false })
      return
    }
    if (data.byteLength % 2 !== 0 || data.byteLength > 65_536) {
      this.deps.logger?.warn('voice', 'chunk de microfone rejeitado', {
        bytes: data.byteLength,
        reason: data.byteLength % 2 !== 0 ? 'odd-size' : 'too-large'
      })
      return
    }
    const state = this.machine.getState()
    if (!this.session || state === 'off' || state === 'error' || state === 'connecting') {
      this.deps.logger?.debug('voice', 'chunk de microfone ignorado', {
        bytes: data.byteLength,
        state,
        session: Boolean(this.session)
      })
      return
    }
    if (pcmRms(data) >= AUDIO_SPEECH_RMS) this.armSilenceTimer()
    this.deps.logger?.debug('voice', 'chunk de microfone aceito', {
      bytes: data.byteLength,
      sampleRate: 16_000,
      state
    })
    this.session.sendAudio(data)
  }

  handleBargeIn(): void {
    if (this.deps.getConfig().bargeIn === false) return
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
      this.deps.logger?.info('voice', 'diálogo de consentimento concluído', { granted })
      if (epoch !== this.epoch) return
      if (!granted || !this.deps.hasConsent()) {
        this.deps.logger?.warn('voice', 'voz bloqueada por consentimento', {
          granted,
          persisted: this.deps.hasConsent()
        })
        this.fail(MICROPHONE_DENIED_MESSAGE)
        return
      }
    }

    if (epoch !== this.epoch || this.machine.getState() !== 'connecting') return
    try {
      const session = this.deps.createSession(this.buildHandlers(epoch))
      this.session = session
      this.deps.logger?.info('voice', 'sessão de voz criada')
      await session.connect()
      if (epoch !== this.epoch || this.machine.getState() !== 'connecting') {
        session.close('cancelled')
        return
      }
      this.transcripts = { user: emptyBuffer(), model: emptyBuffer() }
      this.beginMemorySession()
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
        this.deps.logger?.debug('voice', 'áudio recebido do Live', {
          bytes: data.byteLength,
          sampleRate
        })
        this.noteModelSpeech()
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
        this.deps.logger?.debug('voice', 'transcrição recebida', {
          role: event.role,
          final: event.final,
          chars: typeof event.text === 'string' ? event.text.length : 0
        })
        this.handleTranscript(event)
      },
      onToolCall: (calls) => {
        if (epoch !== this.epoch) return
        void this.handleToolCalls(epoch, calls)
      },
      onError: (error) => {
        if (epoch !== this.epoch) return
        this.deps.logger?.warn('voice', 'erro recebido da sessão', {
          kind: error.kind,
          messageType: typeof error.message
        })
        this.fail(error.message)
      },
      onClose: (reason) => {
        if (epoch !== this.epoch) return
        this.deps.logger?.info('voice', 'sessão de voz fechada', { reason })
        this.session = null
        this.clearTimers()
        this.finishMemorySession()
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
        this.deps.logger?.debug('voice', 'turno Live concluído')
        // Turno fechado sem fala depois de uma ferramenta: pede a confirmação
        // uma única vez, em vez de deixar o usuário no silêncio.
        if (this.toolReplyPending) this.sendToolReplyNudge()
        this.transcripts = { user: emptyBuffer(), model: emptyBuffer() }
        const state = this.machine.getState()
        if (state === 'speaking' || state === 'thinking') {
          this.machine.transition('listening', VOICE_REASONS.turnComplete)
        }
      }
    }
  }

  /**
   * Roteia cada `toolCall` do Live pelo mesmo roteador da conversa de texto.
   * Falha/recusa vira resposta estruturada ao modelo; a sessão nunca fecha por
   * causa de uma ferramenta.
   */
  private async handleToolCalls(epoch: number, calls: GeminiFunctionCall[]): Promise<void> {
    const route = this.deps.routeToolCall
    this.deps.logger?.debug('voice', 'tool call recebida do Live', { count: calls.length })
    if (!route || calls.length === 0) return
    // Um novo `onToolCall` significa que o turno continua com ferramenta (ex.:
    // list_apps -> open_app): o vigia da rodada anterior não pode disparar no
    // meio da próxima ação. Cancela sem marcar como respondido.
    this.cancelToolReplyGuard()

    const responses: GeminiFunctionResponse[] = []
    const syntheticMessages: string[] = []
    for (const call of calls) {
      if (epoch !== this.epoch) return
      let result: ToolCallResult
      try {
        result = await route(call)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result = { ok: false, error: { kind: 'failed', message: message.slice(0, 300) } }
      }
      if (epoch !== this.epoch) return
      responses.push({
        name: call.name,
        ...(typeof call.id === 'string' && call.id.length > 0 ? { id: call.id } : {}),
        response: result.ok
          ? { ok: true, result: result.result ?? null }
          : { ok: false, error: result.error }
      })
      const message = toolResultMessage(result)
      if (message) syntheticMessages.push(message)
    }
    if (epoch !== this.epoch || responses.length === 0) return
    const session = this.session
    if (!session) return
    session.sendToolResponse?.(responses)
    this.deps.logger?.info('voice', 'tool response enviado', {
      tools: responses.map((response) => response.name),
      ids: responses
        .map((response) => response.id)
        .filter((id): id is string => typeof id === 'string')
    })
    // Rede de segurança: se a sessão cair e reconectar, o modelo continua
    // sabendo o que foi executado, mesmo sem o resultado da ferramenta.
    for (const message of syntheticMessages) {
      try {
        session.appendHistory('model', message)
      } catch {
        // Sessão fechando: o histórico em memória não é crítico aqui.
      }
    }
    // A confirmação falada é obrigatória: se o modelo não falar e o turno
    // terminar (ou 6 s passarem), um único nudge pede a frase de resultado.
    this.armToolReplyGuard()
  }

  private handleTranscript(event: VoiceSessionTranscript): void {
    const text = typeof event.text === 'string' ? event.text : ''
    if (!text) return
    if (event.role === 'model') this.noteModelSpeech()
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
        this.persistTurn('model', model.text, true)
      }
      model.closed = true
    }
    const state = this.machine.getState()
    if (state === 'speaking' || state === 'thinking') {
      this.machine.transition('listening', VOICE_REASONS.interrupted)
    }
  }

  private persistTurn(role: 'user' | 'model', text: string, interrupted = false): void {
    // Histórico textual em memória da sessão: usado na reconexão do Live.
    this.session?.appendHistory(role, text)
    if (!this.deps.memoryEnabled()) return
    try {
      if (this.memorySessionId && this.deps.history.appendTurn) {
        this.deps.history.appendTurn({
          sessionId: this.memorySessionId,
          role,
          content: text,
          at: this.now(),
          interrupted
        })
      } else {
        this.deps.history.append(role, text, interrupted)
      }
    } catch (err) {
      this.deps.logger?.warn('voice', 'falha ao gravar transcrição na memória', err)
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private beginMemorySession(): void {
    this.memorySessionId = null
    if (!this.deps.memoryEnabled() || !this.deps.history.beginSession) return
    const sessionId = `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    try {
      this.deps.history.beginSession(sessionId, this.now())
      this.memorySessionId = sessionId
    } catch (err) {
      this.deps.logger?.warn('voice', 'falha ao abrir a sessão de memória', err)
    }
  }

  private finishMemorySession(): void {
    const sessionId = this.memorySessionId
    this.memorySessionId = null
    if (!sessionId || !this.deps.history.endSession) return
    try {
      this.deps.history.endSession(sessionId, this.now())
    } catch (err) {
      this.deps.logger?.warn('voice', 'falha ao encerrar a sessão de memória', err)
    }
  }

  /** Novo `onToolCall`: cancela o vigia anterior sem marcar como respondido. */
  private cancelToolReplyGuard(): void {
    if (this.toolReplyTimer) {
      clearTimeout(this.toolReplyTimer)
      this.toolReplyTimer = null
    }
    this.toolReplyPending = false
    this.toolReplyNudged = false
  }

  /** Arma o vigia de confirmação de UMA rodada de ferramenta. */
  private armToolReplyGuard(): void {
    if (this.toolReplyTimer) clearTimeout(this.toolReplyTimer)
    this.toolReplyPending = true
    this.toolReplyNudged = false
    this.toolReplyTimer = setTimeout(() => {
      this.toolReplyTimer = null
      this.sendToolReplyNudge()
    }, TOOL_REPLY_GUARD_MS)
  }

  /** O modelo falou (áudio ou transcrição): a confirmação chegou. */
  private noteModelSpeech(): void {
    if (!this.toolReplyPending) return
    this.toolReplyPending = false
    if (this.toolReplyTimer) {
      clearTimeout(this.toolReplyTimer)
      this.toolReplyTimer = null
    }
  }

  /** No máximo um nudge por rodada; nunca depois de fechar/parar. */
  private sendToolReplyNudge(): void {
    if (!this.toolReplyPending || this.toolReplyNudged) return
    const session = this.session
    if (!session) return
    this.toolReplyNudged = true
    this.toolReplyPending = false
    if (this.toolReplyTimer) {
      clearTimeout(this.toolReplyTimer)
      this.toolReplyTimer = null
    }
    try {
      session.sendText(TOOL_REPLY_NUDGE)
    } catch {
      // Sessão fechando: não há o que pedir.
    }
    this.deps.logger?.debug('voice', 'nudge de confirmação enviado')
  }

  private fail(message: string): void {
    this.epoch += 1
    this.clearTimers()
    this.finishMemorySession()
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
    this.deps.logger?.warn('voice', 'voz em estado de erro', {
      messageType: typeof message,
      messageChars: message.length
    })
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
    if (this.toolReplyTimer) clearTimeout(this.toolReplyTimer)
    this.silenceTimer = null
    this.maxTimer = null
    this.toolReplyTimer = null
    this.toolReplyPending = false
    this.toolReplyNudged = false
  }
}
