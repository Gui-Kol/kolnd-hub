import type { GeminiFunctionResponse, GeminiImage } from '../transport'
import type { LiveConnection, LiveConnectOptions, LiveEvent, LiveTransport } from '../liveTransport'

/**
 * Transporte Live falso: os testes nunca importam o SDK nem tocam na rede.
 * Cada tentativa de `connect` pode falhar; a conexão aceita registra tudo e
 * permite emitir eventos do servidor pelo teste.
 */

export class FakeLiveConnection implements LiveConnection {
  readonly audio: Uint8Array[] = []
  readonly texts: string[] = []
  readonly images: GeminiImage[] = []
  readonly toolResponses: GeminiFunctionResponse[][] = []
  interrupts = 0
  closes = 0

  constructor(
    private readonly options: LiveConnectOptions,
    private readonly autoRespond = false,
    private readonly responseDelayMs = 0
  ) {}

  private respond(): void {
    if (!this.autoRespond || this.closes > 0) return
    const emit = (): void => {
      if (this.closes > 0) return
      this.options.onEvent({
        type: 'transcript',
        role: 'model',
        text: 'Resposta sintética do transporte fake.',
        final: true
      })
      this.options.onEvent({
        type: 'usage',
        usage: { input: 1, output: 1, total: 2 }
      })
      this.options.onEvent({
        type: 'audio',
        data: new Uint8Array([0, 0, 0, 0]),
        sampleRate: 24_000
      })
      this.options.onEvent({ type: 'turnComplete' })
    }
    // E2E de cancelamento precisa de uma janela determinística entre o envio e
    // a resposta; em produção/teste unitário o padrão continua `queueMicrotask`.
    if (this.responseDelayMs > 0) setTimeout(emit, this.responseDelayMs)
    else queueMicrotask(emit)
  }

  sendAudio(pcm: Uint8Array): void {
    this.audio.push(new Uint8Array(pcm))
  }

  sendText(text: string): void {
    this.texts.push(text)
    this.respond()
  }

  sendImage(image: GeminiImage): void {
    this.images.push(image)
  }

  sendImageAndText(image: GeminiImage, text: string): void {
    this.images.push(image)
    this.texts.push(text)
    this.respond()
  }

  sendToolResponse(responses: GeminiFunctionResponse[]): void {
    this.toolResponses.push(responses.map((response) => ({ ...response })))
  }

  interrupt(): void {
    this.interrupts += 1
  }

  close(): void {
    this.closes += 1
  }

  emit(event: LiveEvent): void {
    this.options.onEvent(event)
  }
}

export class FakeLiveTransport implements LiveTransport {
  readonly connects: LiveConnectOptions[] = []
  readonly connections: FakeLiveConnection[] = []
  constructor(
    private readonly autoRespond = false,
    private readonly responseDelayMs = 0
  ) {}
  /** Erro por tentativa (índice = tentativa - 1); `undefined` conecta. */
  failures: Array<unknown | undefined> = []

  async connect(options: LiveConnectOptions): Promise<LiveConnection> {
    const attempt = this.connects.length
    this.connects.push(options)
    const failure = attempt < this.failures.length ? this.failures[attempt] : undefined
    if (failure !== undefined) throw failure
    const connection = new FakeLiveConnection(options, this.autoRespond, this.responseDelayMs)
    this.connections.push(connection)
    return connection
  }

  get last(): FakeLiveConnection | undefined {
    return this.connections[this.connections.length - 1]
  }
}
