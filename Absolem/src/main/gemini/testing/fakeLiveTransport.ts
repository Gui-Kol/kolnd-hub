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

  constructor(private readonly options: LiveConnectOptions) {}

  sendAudio(pcm: Uint8Array): void {
    this.audio.push(new Uint8Array(pcm))
  }

  sendText(text: string): void {
    this.texts.push(text)
  }

  sendImage(image: GeminiImage): void {
    this.images.push(image)
  }

  sendImageAndText(image: GeminiImage, text: string): void {
    this.images.push(image)
    this.texts.push(text)
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
  /** Erro por tentativa (índice = tentativa - 1); `undefined` conecta. */
  failures: Array<unknown | undefined> = []

  async connect(options: LiveConnectOptions): Promise<LiveConnection> {
    const attempt = this.connects.length
    this.connects.push(options)
    const failure = attempt < this.failures.length ? this.failures[attempt] : undefined
    if (failure !== undefined) throw failure
    const connection = new FakeLiveConnection(options)
    this.connections.push(connection)
    return connection
  }

  get last(): FakeLiveConnection | undefined {
    return this.connections[this.connections.length - 1]
  }
}
