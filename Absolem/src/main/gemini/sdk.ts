import type {
  GeminiContent,
  GeminiFunctionCall,
  GeminiGenerateResult,
  GeminiRequest,
  GeminiStreamChunk,
  GeminiTransport,
  GeminiUsageMetadata
} from './transport'

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

type GenAiModule = typeof import('@google/genai')

let loaded: Promise<GenAiModule> | null = null

/** Carrega o SDK uma única vez por processo. */
function loadSdk(): Promise<GenAiModule> {
  if (!loaded) loaded = import('@google/genai')
  return loaded
}

function toContents(contents: GeminiContent[]): Array<Record<string, unknown>> {
  return contents.map((content) => ({
    role: content.role === 'model' ? 'model' : 'user',
    parts: [{ text: content.text }]
  }))
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

function buildConfig(request: GeminiRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    temperature: request.temperature,
    systemInstruction: { parts: [{ text: request.systemInstruction }] },
    abortSignal: request.abortSignal
  }
  if (typeof request.maxOutputTokens === 'number') {
    config.maxOutputTokens = request.maxOutputTokens
  }
  if (request.tools && request.tools.length > 0) {
    config.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }))
      }
    ]
  }
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
          : undefined
    }
  }
}
