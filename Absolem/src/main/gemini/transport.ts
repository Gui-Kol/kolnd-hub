/**
 * Contrato de transporte do motor Gemini.
 *
 * `client.ts` fala apenas com esta interface; `sdk.ts` implementa com o SDK
 * oficial do Gemini e `testing/fakeTransport.ts` implementa para os testes.
 * Nenhum módulo fora de `sdk.ts` importa o pacote do SDK, o que
 * permite trocar de transporte sem tocar em cliente, engine, tools ou IPC.
 *
 * O `abortSignal` viaja dentro do request para manter a assinatura
 * `stream(request)` / `generate(request)` e para que o fake reproduza o mesmo
 * caminho de cancelamento do SDK real.
 */

/** Declaração de ferramenta no formato neutro aceito pelo transporte. */
export interface GeminiToolDeclaration {
  name: string
  description: string
  /** JSON Schema dos argumentos (o mesmo tipo de `src/shared/tools.ts`). */
  parameters: Record<string, unknown>
}

/** Imagem anexada a um turno (base64 já decodificado ou string base64). */
export interface GeminiImage {
  mime: string
  data: Uint8Array | ArrayBuffer | string
}

/** Resultado de uma ferramenta devolvido ao modelo (task 08, T10b). */
export interface GeminiFunctionResponse {
  name: string
  /**
   * `id` da chamada correspondente. O Live exige o `id` devolvido pelo
   * `toolCall`; quando a chamada não trouxer `id`, o campo fica ausente.
   */
  id?: string
  response: Record<string, unknown>
}

/** Turno de conversa enviado ao modelo. */
export interface GeminiContent {
  role: 'user' | 'model'
  text: string
  /** Imagens anexadas a este turno (visão de tela, task 07). */
  images?: GeminiImage[]
  /** Chamadas pedidas pelo modelo neste turno (loop de ferramentas). */
  functionCalls?: GeminiFunctionCall[]
  /** Resultados das ferramentas devolvidos ao modelo. */
  functionResponses?: GeminiFunctionResponse[]
}

/**
 * Referência crua de uma fonte de grounding (web). O `client.ts` normaliza
 * para `WebSource`; o transporte só entrega `uri`/`title` como vieram.
 */
export interface GeminiGroundingChunk {
  uri?: string
  title?: string
}

export interface GeminiRequest {
  apiKey: string
  model: string
  temperature: number
  systemInstruction: string
  contents: GeminiContent[]
  tools?: GeminiToolDeclaration[]
  /** Ativa a ferramenta de busca do Google (grounding, task 10). */
  googleSearch?: boolean
  maxOutputTokens?: number
  /** JSON estruturado (extração de memória, task 09). */
  responseMimeType?: string
  responseSchema?: Record<string, unknown>
  abortSignal?: AbortSignal
}

/** Chamada de função pedida pelo modelo (entrada não confiável). */
export interface GeminiFunctionCall {
  name: string
  args: Record<string, unknown>
  /** `id` da chamada no provedor; deve voltar na `functionResponse`. */
  id?: string
}

/** Contagem de tokens devolvida pelo provedor, quando existir. */
export interface GeminiUsageMetadata {
  input?: number
  output?: number
  total?: number
}

export interface GeminiStreamChunk {
  text?: string
  functionCalls?: GeminiFunctionCall[]
  usage?: GeminiUsageMetadata
  /** `SAFETY`, `RECITATION`, `MAX_TOKENS`, ... (string crua, sem enum do SDK). */
  finishReason?: string
  /** `true` quando o provedor bloqueou a resposta por política. */
  blocked?: boolean
}

export interface GeminiGenerateResult {
  text: string
  functionCalls?: GeminiFunctionCall[]
  usage?: GeminiUsageMetadata
  finishReason?: string
  blocked?: boolean
  /** Fontes de grounding devolvidas pelo provedor (somente web). */
  groundingChunks?: GeminiGroundingChunk[]
}

/**
 * Interface mínima usada pelo `client.ts`. Implementações não devem lançar
 * `GeminiError`: o cliente normaliza qualquer erro do transporte.
 */
export interface GeminiTransport {
  stream(request: GeminiRequest): AsyncIterable<GeminiStreamChunk>
  generate(request: GeminiRequest): Promise<GeminiGenerateResult>
}
