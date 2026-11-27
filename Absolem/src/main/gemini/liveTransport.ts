import type {
  GeminiFunctionCall,
  GeminiFunctionResponse,
  GeminiToolDeclaration,
  GeminiUsageMetadata
} from './transport'
import type { GeminiImage } from './transport'
import type { WebSource } from '../../shared/search'

/**
 * Contrato neutro da sessão Live.
 *
 * `live.ts` fala apenas com esta interface; `sdk.ts` implementa com o SDK
 * oficial (unico arquivo que importa o pacote) e
 * `testing/fakeLiveTransport.ts` implementa para os testes. Nenhum teste toca
 * na rede.
 *
 * A taxa de saída do modelo Live é 24 kHz (PCM16). O SDK entrega o MIME type
 * em `serverContent.modelTurn.parts[].inlineData`; quando ausente usamos esta
 * constante.
 */

export const LIVE_AUDIO_OUTPUT_RATE = 24_000
export const LIVE_AUDIO_INPUT_RATE = 16_000

export interface LiveHistoryTurn {
  role: 'user' | 'model'
  text: string
}

export type LiveEvent =
  | { type: 'audio'; data: Uint8Array; sampleRate: number }
  | { type: 'transcript'; role: 'user' | 'model'; text: string; final: boolean }
  | { type: 'toolCall'; calls: GeminiFunctionCall[] }
  | { type: 'usage'; usage: GeminiUsageMetadata }
  | { type: 'grounding'; sources: WebSource[] }
  | { type: 'turnComplete' }
  | { type: 'interrupted' }
  | { type: 'error'; error: unknown }
  | { type: 'closed'; reason?: string }

export interface LiveConnectOptions {
  apiKey: string
  model: string
  systemInstruction: string
  temperature: number
  /** Voz pré-definida (`speechConfig...voiceName`); vazio usa o default do serviço. */
  voiceName?: string
  tools?: GeminiToolDeclaration[]
  /** Histórico textual preservado entre reconexões. */
  history?: LiveHistoryTurn[]
  onEvent: (event: LiveEvent) => void
}

export interface LiveConnection {
  sendAudio: (pcm: Uint8Array) => void
  sendText: (text: string) => void
  sendImage: (image: GeminiImage) => void
  /** Envia imagem e pergunta como um único turno ordenado. */
  sendImageAndText: (image: GeminiImage, text: string) => void
  /** Devolve o resultado das ferramentas executadas ao modelo (task 08). */
  sendToolResponse: (responses: GeminiFunctionResponse[]) => void
  /** Pede ao servidor para cortar a geração atual (barge-in/“parar”). */
  interrupt: () => void
  close: () => void
}

export interface LiveTransport {
  connect: (options: LiveConnectOptions) => Promise<LiveConnection>
}
