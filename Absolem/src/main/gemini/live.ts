import { GeminiError, classifyError } from './errors'
import type {
  GeminiFunctionCall,
  GeminiFunctionResponse,
  GeminiToolDeclaration,
  GeminiUsageMetadata
} from './transport'
import type { LiveConnection, LiveEvent, LiveHistoryTurn, LiveTransport } from './liveTransport'

/**
 * Sessão Live do main (`ai.live.connect` via `sdk.ts`).
 *
 * Regras fechadas:
 * - teto de custo da task 05 é consultado ANTES de conectar; mês bloqueado não
 *   abre socket nem microfone;
 * - falha de conexão/rede reconecta no máximo 2 tentativas no total (backoff
 *   exponencial injetável); a segunda falha vira `error`;
 * - histórico textual (`appendHistory`) viaja na reconexão;
 * - `close()` é idempotente: conexão fechada uma vez, uso contabilizado uma vez;
 * - custo de áudio: quando o Live não devolve `usageMetadata`, estimamos
 *   `duração_s × 32` tokens de entrada e marcamos `estimated` no log (a
 *   aproximação cobre o áudio de entrada; o áudio de saída vem no metadata).
 */

export interface LiveUsageMeterLike {
  checkBudget: () => void
  record: (amounts: { input: number; output: number }) => unknown
}

export interface LiveKeyReader {
  getApiKey: () => string | null
}

export interface LiveLoggerLike {
  debug: (scope: string, message: unknown, ...args: unknown[]) => void
  info: (scope: string, message: unknown, ...args: unknown[]) => void
  warn: (scope: string, message: unknown, ...args: unknown[]) => void
}

export interface LiveTranscriptEvent {
  role: 'user' | 'model'
  text: string
  final: boolean
}

export interface LiveSessionHandlers {
  onAudio?: (data: Uint8Array, sampleRate: number) => void
  onTranscript?: (event: LiveTranscriptEvent) => void
  onToolCall?: (calls: GeminiFunctionCall[]) => void
  onError?: (error: GeminiError) => void
  onClose?: (reason: string) => void
  onInterrupted?: () => void
  onTurnComplete?: () => void
}

export interface LiveSessionConfig {
  model: string
  temperature?: number
  systemInstruction?: string
  /** Alias pedido pela task (`connect({ systemPrompt })`). */
  systemPrompt?: string
  tools?: GeminiToolDeclaration[]
  /** Histórico textual inicial; cresce com `appendHistory`. */
  history?: LiveHistoryTurn[]
}

export interface LiveSessionOptions extends LiveSessionConfig {
  transport: LiveTransport
  keys: LiveKeyReader
  usage: LiveUsageMeterLike
  handlers?: LiveSessionHandlers
  logger?: LiveLoggerLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Tentativas TOTAIS, incluindo a primeira (default 2). */
  maxAttempts?: number
  baseBackoffMs?: number
}

/** Tokens estimados por segundo de áudio de entrada quando não há metadata. */
export const LIVE_AUDIO_TOKENS_PER_SECOND = 32
export const LIVE_MAX_ATTEMPTS = 2

export class LiveSession {
  private readonly transport: LiveTransport
  private readonly keys: LiveKeyReader
  private readonly usage: LiveUsageMeterLike
  private readonly logger?: LiveLoggerLike
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxAttempts: number
  private readonly baseBackoffMs: number

  private handlers: LiveSessionHandlers
  private config: LiveSessionConfig
  private connection: LiveConnection | null = null
  private history: LiveHistoryTurn[]
  private connectedAt: number | null = null
  private audioBytes = 0
  private metadata: GeminiUsageMetadata | undefined
  private recordedInput = 0
  private recordedOutput = 0
  private usageFinalized = false
  private closeReason: string | null = null
  private closed = false
  private connecting = false
  private reconnecting = false

  constructor(options: LiveSessionOptions) {
    this.transport = options.transport
    this.keys = options.keys
    this.usage = options.usage
    this.logger = options.logger
    this.now = options.now ?? (() => Date.now())
    this.sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    this.maxAttempts = Math.max(1, options.maxAttempts ?? LIVE_MAX_ATTEMPTS)
    this.baseBackoffMs = options.baseBackoffMs ?? 300
    this.handlers = options.handlers ?? {}
    this.config = {
      model: options.model,
      temperature: options.temperature,
      systemInstruction: options.systemInstruction ?? options.systemPrompt,
      systemPrompt: options.systemPrompt,
      tools: options.tools
    }
    this.history = [...(options.history ?? [])]
  }

  setHandlers(handlers: LiveSessionHandlers): void {
    this.handlers = handlers
  }

  isConnected(): boolean {
    return this.connection !== null
  }

  isClosed(): boolean {
    return this.closed
  }

  /** Preserva o turno textual para a próxima reconexão. */
  appendHistory(role: 'user' | 'model', text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.history.push({ role, text: trimmed })
    if (this.history.length > 40) this.history = this.history.slice(-40)
  }

  getHistory(): LiveHistoryTurn[] {
    return [...this.history]
  }

  async connect(override?: Partial<LiveSessionConfig>): Promise<void> {
    if (this.closed) throw new GeminiError('invalid', 'Sessão Live já encerrada.')
    if (this.connection || this.connecting) return
    if (override) {
      this.config = {
        ...this.config,
        ...override,
        ...(override.systemPrompt !== undefined && override.systemInstruction === undefined
          ? { systemInstruction: override.systemPrompt }
          : {})
      }
    }

    const apiKey = this.keys.getApiKey()
    if (!apiKey) {
      throw new GeminiError('auth', 'Chave do Gemini não configurada.')
    }
    // Teto do mês: lança `quota` antes de qualquer rede.
    this.usage.checkBudget()

    this.connecting = true
    try {
      await this.connectWithRetry(apiKey)
    } finally {
      this.connecting = false
    }
  }

  sendAudio(pcm: Uint8Array): void {
    if (this.closed || !this.connection) return
    if (!(pcm instanceof Uint8Array) || pcm.byteLength === 0) return
    this.audioBytes += pcm.byteLength
    try {
      this.connection.sendAudio(pcm)
    } catch (err) {
      this.handleRuntimeError(err)
    }
  }

  sendText(text: string): void {
    if (this.closed || !this.connection) return
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (!trimmed) return
    try {
      this.connection.sendText(trimmed)
    } catch (err) {
      this.handleRuntimeError(err)
    }
  }

  /** Devolve ao modelo o resultado de ferramentas executadas (task 08, T10b). */
  sendToolResponse(responses: GeminiFunctionResponse[]): void {
    if (this.closed || !this.connection) return
    if (!Array.isArray(responses) || responses.length === 0) return
    try {
      this.connection.sendToolResponse(responses)
    } catch (err) {
      this.handleRuntimeError(err)
    }
  }

  interrupt(): void {
    if (this.closed || !this.connection) return
    try {
      this.connection.interrupt()
    } catch (err) {
      this.handleRuntimeError(err)
    }
  }

  close(reason: string = 'close'): void {
    if (this.closed) return
    this.closed = true
    this.closeReason = reason
    const connection = this.connection
    this.connection = null
    if (connection) {
      try {
        connection.close()
      } catch {
        // Conexão já pode ter caído; o fechamento lógico continua.
      }
    }
    this.finalizeUsage()
    this.logger?.info('voice', 'sessão Live encerrada', {
      reason,
      audioSeconds: Math.round(this.audioSeconds() * 10) / 10
    })
    this.handlers.onClose?.(reason)
  }

  private async connectWithRetry(apiKey: string): Promise<void> {
    let lastError: GeminiError | null = null
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (this.closed) throw new GeminiError('cancelled', 'Sessão Live cancelada.')
      try {
        const connection = await this.transport.connect({
          apiKey,
          model: this.config.model,
          systemInstruction: this.config.systemInstruction ?? this.config.systemPrompt ?? '',
          temperature: this.config.temperature ?? 0.7,
          tools: this.config.tools,
          history: this.getHistory(),
          onEvent: (event) => this.handleEvent(event)
        })
        // `close()` pode ter vencido a corrida do connect: não deixa socket
        // órfão depois de a sessão já estar logicamente fechada.
        if (this.closed) {
          try {
            connection.close()
          } catch {
            // best-effort
          }
          return
        }
        this.connection = connection
        this.connectedAt = this.now()
        this.logger?.info('voice', 'sessão Live conectada', {
          model: this.config.model,
          attempt
        })
        return
      } catch (err) {
        lastError = classifyError(err)
        const retryable = this.isRetryable(lastError)
        this.logger?.warn('voice', 'falha ao conectar a sessão Live', {
          kind: lastError.kind,
          attempt,
          retryable
        })
        if (!retryable || attempt >= this.maxAttempts) break
        await this.sleep(this.backoff(attempt))
      }
    }

    const error = lastError ?? new GeminiError('unknown', 'Falha ao conectar a sessão Live.')
    this.fail(error)
    throw error
  }

  private backoff(attempt: number): number {
    return this.baseBackoffMs * 2 ** Math.max(0, attempt - 1)
  }

  private isRetryable(error: GeminiError): boolean {
    if (error.kind === 'auth' || error.kind === 'quota' || error.kind === 'invalid') return false
    if (error.kind === 'cancelled' || error.kind === 'blocked') return false
    return true
  }

  private handleEvent(event: LiveEvent): void {
    if (this.closed) return
    switch (event.type) {
      case 'audio':
        this.handlers.onAudio?.(event.data, event.sampleRate)
        return
      case 'transcript':
        this.handlers.onTranscript?.(event)
        return
      case 'toolCall':
        this.handlers.onToolCall?.(event.calls)
        return
      case 'usage':
        this.metadata = event.usage
        return
      case 'turnComplete':
        this.handlers.onTurnComplete?.()
        return
      case 'interrupted':
        this.handlers.onInterrupted?.()
        return
      case 'error':
        this.handleRuntimeError(event.error)
        return
      case 'closed':
        this.handleRuntimeClose(event.reason)
        return
    }
  }

  /**
   * Erro em sessão já conectada: tenta reconectar até `maxAttempts - 1`
   * (a conexão original conta como a primeira tentativa).
   */
  private handleRuntimeError(err: unknown): void {
    if (this.closed || this.reconnecting) return
    const error = classifyError(err)
    this.logger?.warn('voice', 'erro na sessão Live', { kind: error.kind })
    if (!this.isRetryable(error) || this.maxAttempts <= 1) {
      this.fail(error)
      return
    }
    void this.reconnect(error)
  }

  private handleRuntimeClose(reason?: string): void {
    if (this.closed || this.reconnecting) return
    this.logger?.warn('voice', 'sessão Live fechada pelo servidor', { reason })
    if (this.maxAttempts <= 1) {
      this.fail(new GeminiError('network', 'A conexão de voz foi encerrada.'))
      return
    }
    void this.reconnect(new GeminiError('network', 'A conexão de voz foi encerrada.'))
  }

  private async reconnect(initialError: GeminiError): Promise<void> {
    this.reconnecting = true
    const connection = this.connection
    this.connection = null
    try {
      connection?.close()
    } catch {
      // best-effort
    }

    let lastError = initialError
    for (let attempt = 2; attempt <= this.maxAttempts; attempt += 1) {
      if (this.closed) break
      await this.sleep(this.backoff(attempt))
      if (this.closed) break
      try {
        const connection = await this.transport.connect({
          apiKey: this.keys.getApiKey() ?? '',
          model: this.config.model,
          systemInstruction: this.config.systemInstruction ?? this.config.systemPrompt ?? '',
          temperature: this.config.temperature ?? 0.7,
          tools: this.config.tools,
          history: this.getHistory(),
          onEvent: (event) => this.handleEvent(event)
        })
        if (this.closed) {
          try {
            connection.close()
          } catch {
            // best-effort
          }
          return
        }
        this.connection = connection
        this.logger?.info('voice', 'sessão Live reconectada', { attempt })
        return
      } catch (err) {
        lastError = classifyError(err)
        this.logger?.warn('voice', 'reconexão da sessão Live falhou', {
          kind: lastError.kind,
          attempt
        })
        if (!this.isRetryable(lastError)) break
      }
    }

    if (!this.closed) this.fail(lastError)
  }

  private fail(error: GeminiError): void {
    this.logger?.warn('voice', 'sessão Live em erro', { kind: error.kind })
    this.handlers.onError?.(error)
    this.close('error')
  }

  private audioSeconds(): number {
    return this.audioBytes / 2 / 16_000
  }

  private finalizeUsage(): void {
    if (this.usageFinalized) return
    this.usageFinalized = true
    const metadata = this.metadata
    if (metadata && (metadata.input !== undefined || metadata.output !== undefined)) {
      const input = Math.max(0, (metadata.input ?? 0) - this.recordedInput)
      const output = Math.max(0, (metadata.output ?? 0) - this.recordedOutput)
      this.recordedInput += input
      this.recordedOutput += output
      if (input > 0 || output > 0) {
        this.usage.record({ input, output })
        this.logger?.info('voice', 'custo de voz (metadata do Live)', { input, output })
      }
      return
    }

    if (metadata?.total !== undefined && metadata.total > 0) {
      const total = Math.max(0, metadata.total - this.recordedInput - this.recordedOutput)
      if (total > 0) {
        this.recordedInput += total
        this.usage.record({ input: total, output: 0 })
        this.logger?.info('voice', 'custo de voz (total do Live)', { input: total })
      }
      return
    }

    const estimatedInput = Math.ceil(this.audioSeconds() * LIVE_AUDIO_TOKENS_PER_SECOND)
    if (estimatedInput > 0) {
      this.recordedInput += estimatedInput
      this.usage.record({ input: estimatedInput, output: 0 })
      // Aproximação documentada: sem usageMetadata, 1 s de áudio ≈ 32 tokens
      // de entrada. O medidor da task 05 marca `estimated` no log do turno.
      this.logger?.info('voice', 'custo de voz estimado', {
        input: estimatedInput,
        estimated: true,
        audioSeconds: Math.round(this.audioSeconds() * 10) / 10
      })
    }
  }
}
