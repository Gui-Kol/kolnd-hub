import type {
  GeminiContent,
  GeminiFunctionCall,
  GeminiGenerateResult,
  GeminiGroundingChunk,
  GeminiImage,
  GeminiRequest,
  GeminiStreamChunk,
  GeminiTransport,
  GeminiUsageMetadata
} from './transport'
import type { LiveConnection, LiveConnectOptions, LiveEvent, LiveTransport } from './liveTransport'
import { LIVE_AUDIO_OUTPUT_RATE } from './liveTransport'

/**
 * Único arquivo do main que importa `@google/genai`.
 *
 * O import é dinâmico de propósito: o pacote é publicado como ESM com entrada
 * CJS separada, mas o main do Electron 28 (Node 18) só precisa carregá-lo
 * quando houver uma chamada real. Assim o boot, o store e o IPC não dependem do
 * SDK, e trocar de pacote/versão fica restrito a este arquivo.
 *
 * Versão fixada no `package.json` (`3.6.1`, licença Apache-2.0). Se o SDK mudar
 * de superfície, o typecheck deste arquivo é o primeiro a quebrar.
 */

export const GEMINI_SDK_PACKAGE = '@google/genai'
export const GEMINI_SDK_VERSION = '3.6.1'

/**
 * Versão da API usada SÓ pelo Live. O default do SDK 3.6.1 é `v1`, que não
 * expõe `BidiGenerateContent` (a URL responde 404); `v1beta` é o endpoint do
 * Live. O transporte de texto continua no default do SDK.
 */
export const LIVE_API_VERSION = 'v1beta'

type GenAiModule = typeof import('@google/genai')

let loaded: Promise<GenAiModule> | null = null

/** Carrega o SDK uma única vez por processo. */
function loadSdk(): Promise<GenAiModule> {
  if (!loaded) loaded = import('@google/genai')
  return loaded
}

function imageToBase64(image: GeminiImage): string {
  if (typeof image.data === 'string') return image.data
  const bytes = image.data instanceof ArrayBuffer ? new Uint8Array(image.data) : image.data
  return Buffer.from(bytes).toString('base64')
}

function toContents(contents: GeminiContent[]): Array<Record<string, unknown>> {
  return contents.map((content) => {
    const parts: Array<Record<string, unknown>> = []
    if (content.text) parts.push({ text: content.text })
    for (const image of content.images ?? []) {
      parts.push({ inlineData: { mimeType: image.mime, data: imageToBase64(image) } })
    }
    for (const call of content.functionCalls ?? []) {
      parts.push({ functionCall: { name: call.name, args: call.args } })
    }
    for (const response of content.functionResponses ?? []) {
      parts.push({ functionResponse: { name: response.name, response: response.response } })
    }
    if (parts.length === 0) parts.push({ text: '' })
    return {
      role: content.role === 'model' ? 'model' : 'user',
      parts
    }
  })
}

function toUsage(
  metadata:
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined
): GeminiUsageMetadata | undefined {
  if (!metadata) return undefined
  const usage: GeminiUsageMetadata = {}
  if (typeof metadata.promptTokenCount === 'number') usage.input = metadata.promptTokenCount
  if (typeof metadata.candidatesTokenCount === 'number')
    usage.output = metadata.candidatesTokenCount
  if (typeof metadata.totalTokenCount === 'number') usage.total = metadata.totalTokenCount
  return usage.input === undefined && usage.output === undefined && usage.total === undefined
    ? undefined
    : usage
}

function toFunctionCalls(
  calls: Array<{ name?: string; args?: Record<string, unknown> }> | undefined
): GeminiFunctionCall[] | undefined {
  if (!calls || calls.length === 0) return undefined
  return calls
    .filter((call): call is { name: string; args?: Record<string, unknown> } =>
      Boolean(call && typeof call.name === 'string' && call.name.length > 0)
    )
    .map((call) => ({ name: call.name, args: call.args ?? {} }))
}

/** `groundingMetadata.groundingChunks[].web.{uri,title}` (SDK 3.6.1). */
function toGroundingChunks(
  metadata: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } | undefined
): GeminiGroundingChunk[] | undefined {
  const chunks = metadata?.groundingChunks
  if (!chunks || chunks.length === 0) return undefined
  const out: GeminiGroundingChunk[] = []
  for (const chunk of chunks) {
    const web = chunk?.web
    if (!web || typeof web.uri !== 'string' || web.uri.length === 0) continue
    out.push({
      uri: web.uri,
      ...(typeof web.title === 'string' ? { title: web.title } : {})
    })
  }
  return out.length > 0 ? out : undefined
}

function buildConfig(request: GeminiRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    temperature: request.temperature,
    systemInstruction: { parts: [{ text: request.systemInstruction }] },
    abortSignal: request.abortSignal
  }
  if (typeof request.maxOutputTokens === 'number') {
    config.maxOutputTokens = request.maxOutputTokens
  }
  if (typeof request.responseMimeType === 'string') {
    config.responseMimeType = request.responseMimeType
  }
  if (request.responseSchema) {
    config.responseSchema = request.responseSchema
  }
  const tools: Array<Record<string, unknown>> = []
  if (request.tools && request.tools.length > 0) {
    tools.push({
      functionDeclarations: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    })
  }
  if (request.googleSearch === true) {
    tools.push({ googleSearch: {} })
  }
  if (tools.length > 0) config.tools = tools
  return config
}

/** Transporte real: traduz o contrato neutro para `@google/genai`. */
export class SdkGeminiTransport implements GeminiTransport {
  async *stream(request: GeminiRequest): AsyncIterable<GeminiStreamChunk> {
    const { GoogleGenAI } = await loadSdk()
    const ai = new GoogleGenAI({ apiKey: request.apiKey })
    const stream = await ai.models.generateContentStream({
      model: request.model,
      contents: toContents(request.contents) as never,
      config: buildConfig(request) as never
    })
    for await (const chunk of stream) {
      const text = typeof chunk.text === 'string' ? chunk.text : ''
      const functionCalls = toFunctionCalls(chunk.functionCalls)
      const usage = toUsage(chunk.usageMetadata)
      const blocked = chunk.promptFeedback?.blockReason !== undefined
      const finishReason =
        typeof chunk.candidates?.[0]?.finishReason === 'string'
          ? String(chunk.candidates[0].finishReason)
          : undefined
      if (!text && !functionCalls && !usage && !blocked && !finishReason) continue
      yield { text, functionCalls, usage, blocked, finishReason }
    }
  }

  async generate(request: GeminiRequest): Promise<GeminiGenerateResult> {
    const { GoogleGenAI } = await loadSdk()
    const ai = new GoogleGenAI({ apiKey: request.apiKey })
    const response = await ai.models.generateContent({
      model: request.model,
      contents: toContents(request.contents) as never,
      config: buildConfig(request) as never
    })
    return {
      text: typeof response.text === 'string' ? response.text : '',
      functionCalls: toFunctionCalls(response.functionCalls),
      usage: toUsage(response.usageMetadata),
      blocked: response.promptFeedback?.blockReason !== undefined,
      finishReason:
        typeof response.candidates?.[0]?.finishReason === 'string'
          ? String(response.candidates[0].finishReason)
          : undefined,
      groundingChunks: toGroundingChunks(response.candidates?.[0]?.groundingMetadata)
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

function rateFromMimeType(mimeType: string | undefined): number {
  if (!mimeType) return LIVE_AUDIO_OUTPUT_RATE
  const match = /rate=(\d+)/i.exec(mimeType)
  if (!match) return LIVE_AUDIO_OUTPUT_RATE
  const rate = Number(match[1])
  return Number.isFinite(rate) && rate > 0 ? rate : LIVE_AUDIO_OUTPUT_RATE
}

/**
 * Opções do cliente Live. Ficam separadas para o teste provar, sem rede, que o
 * Live usa `v1beta` sem alterar o transporte de texto.
 */
export function buildLiveClientOptions(apiKey: string): {
  apiKey: string
  httpOptions: { apiVersion: typeof LIVE_API_VERSION }
} {
  return { apiKey, httpOptions: { apiVersion: LIVE_API_VERSION } }
}

/**
 * `speechConfig` da Live API para uma voz pré-definida.
 *
 * O SDK 3.6.1 espera `voiceConfig.prebuiltVoiceConfig.voiceName`. Voz vazia ou
 * só espaços devolve `undefined` para o serviço escolher o default; nenhum
 * fallback de voz é inventado aqui.
 */
export function buildLiveSpeechConfig(
  voiceName: string | undefined
): Record<string, unknown> | undefined {
  const name = typeof voiceName === 'string' ? voiceName.trim() : ''
  if (!name) return undefined
  return {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: name }
    }
  }
}

/**
 * Transporte real da Live API (`ai.live.connect`).
 *
 * Métodos usados do SDK 3.6.1 (confirmados no gate):
 * - `ai.live.connect({ model, config, callbacks })` -> `Session`;
 * - `Session.sendRealtimeInput({ audio: { data, mimeType } })` (PCM16 16 kHz)
 *   e `sendRealtimeInput({ text })`;
 * - `Session.sendClientContent({ turns, turnComplete })` (histórico textual na
 *   reconexão);
 * - `Session.sendRealtimeInput({ activityStart: {} })` como sinal de
 *   interrupção (o default `START_OF_ACTIVITY_INTERRUPTS` corta a resposta);
 * - `Session.close()`;
 * - `LiveServerMessage.serverContent` (`modelTurn`, `inputTranscription`,
 *   `outputTranscription`, `interrupted`, `turnComplete`), `toolCall` e
 *   `usageMetadata`.
 *
 * O áudio do modelo sai em PCM16 24 kHz; o MIME type do chunk manda quando
 * presente. Nada é gravado em disco.
 */
export class SdkLiveTransport implements LiveTransport {
  async connect(options: LiveConnectOptions): Promise<LiveConnection> {
    const { GoogleGenAI, Modality } = await loadSdk()
    const ai = new GoogleGenAI(buildLiveClientOptions(options.apiKey))

    const config: Record<string, unknown> = {
      responseModalities: [Modality.AUDIO],
      temperature: options.temperature,
      systemInstruction: { parts: [{ text: options.systemInstruction }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {}
    }
    const speechConfig = buildLiveSpeechConfig(options.voiceName)
    if (speechConfig) config.speechConfig = speechConfig
    if (options.tools && options.tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }))
        }
      ]
    }

    const emit = (event: LiveEvent): void => options.onEvent(event)

    const session = await ai.live.connect({
      model: options.model,
      config: config as never,
      callbacks: {
        onmessage: (message) => {
          const content = message.serverContent
          if (content) {
            if (content.interrupted) emit({ type: 'interrupted' })
            if (content.turnComplete) emit({ type: 'turnComplete' })

            const input = content.inputTranscription ?? content.interimInputTranscription
            if (input?.text) {
              const final = content.inputTranscription !== undefined && input.finished === true
              emit({ type: 'transcript', role: 'user', text: input.text, final })
            }
            if (content.outputTranscription?.text) {
              emit({
                type: 'transcript',
                role: 'model',
                text: content.outputTranscription.text,
                final: content.outputTranscription.finished === true
              })
            }

            for (const part of content.modelTurn?.parts ?? []) {
              const inline = part.inlineData
              if (!inline?.data) continue
              emit({
                type: 'audio',
                data: base64ToBytes(inline.data),
                sampleRate: rateFromMimeType(inline.mimeType)
              })
            }
          }

          if (message.toolCall?.functionCalls) {
            const calls = message.toolCall.functionCalls
              .filter(
                (call): call is { name: string; args?: Record<string, unknown> } =>
                  typeof call.name === 'string' && call.name.length > 0
              )
              .map((call) => ({ name: call.name, args: call.args ?? {} }))
            if (calls.length > 0) emit({ type: 'toolCall', calls })
          }

          if (message.usageMetadata) {
            const usage = toUsage(message.usageMetadata)
            if (usage) emit({ type: 'usage', usage })
          }
        },
        onerror: (event) => emit({ type: 'error', error: event }),
        onclose: (event) => emit({ type: 'closed', reason: String(event?.reason ?? '') })
      }
    })

    if (options.history && options.history.length > 0) {
      session.sendClientContent({
        turns: options.history.map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.text }]
        })) as never,
        turnComplete: false
      })
    }

    return {
      sendAudio: (pcm) => {
        session.sendRealtimeInput({
          audio: {
            data: bytesToBase64(pcm),
            mimeType: `audio/pcm;rate=${16_000}`
          }
        })
      },
      sendText: (text) => {
        session.sendRealtimeInput({ text })
      },
      sendToolResponse: (responses) => {
        session.sendToolResponse({
          functionResponses: responses.map((response) => ({
            name: response.name,
            response: response.response
          }))
        } as never)
      },
      interrupt: () => {
        // Atividade de usuário interrompe a resposta por padrão
        // (`ActivityHandling.START_OF_ACTIVITY_INTERRUPTS`).
        session.sendRealtimeInput({ activityStart: {} })
      },
      close: () => {
        session.close()
      }
    }
  }
}
