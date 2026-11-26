import { GeminiClient } from './client'
import { GeminiError, classifyError } from './errors'
import type { ChatHistory } from './history'
import { buildContextWindow } from './history'
import { buildSystemPrompt, PROMPT_VERSION } from './prompts'
import type {
  GeminiFunctionCall,
  GeminiFunctionResponse,
  GeminiImage,
  GeminiToolDeclaration,
  GeminiTransport
} from './transport'
import type { ToolCallResult } from './tools/router'
import type { ToolDefinition } from '../../shared/tools'
import { clampCap, quotaMessage, resolveUsage, type UsageMeter } from './usage'
import type { ChatUsagePayload, GeminiErrorSummary, GeminiStatusInfo } from '../../shared/gemini'

export type { ChatUsagePayload } from '../../shared/gemini'

/**
 * `GeminiEngine`: ponto único do app que fala com o Gemini.
 *
 * Responsabilidades:
 * - estado da chave (`configured`, `lastError`, `disabledReason`);
 * - bloqueio limpo sem chave (nunca rede) e por teto mensal (antes do transporte);
 * - streaming de texto por callbacks (o IPC traduz para os pushes de chat);
 * - uma conversa por vez: um requestId novo cancela o anterior;
 * - contabilização de tokens e histórico só em sucesso.
 *
 * O engine não conhece Electron, store nem IPC: recebe as dependências
 * (transporte, chaves, config, usage, histórico, logger) no construtor.
 */

export interface SecretReader {
  getApiKey: () => string | null
  hasApiKey: () => boolean
  setApiKey: (value: unknown) => { ok: boolean; error?: string }
  clearApiKey: () => { ok: boolean; error?: string }
}

export interface GeminiEngineConfig {
  model: string
  temperature: number
  monthlyTokenCap: number
}

export interface EngineLogger {
  debug: (scope: string, message: unknown, ...args: unknown[]) => void
  info: (scope: string, message: unknown, ...args: unknown[]) => void
  warn: (scope: string, message: unknown, ...args: unknown[]) => void
  error: (scope: string, message: unknown, ...args: unknown[]) => void
}

export interface GeminiEngineOptions {
  transport: GeminiTransport
  keys: SecretReader
  config: () => GeminiEngineConfig
  usage: UsageMeter
  history: ChatHistory
  logger?: EngineLogger
  now?: () => Date
  defaultLanguage?: string
  promptVersion?: string
  maxTextChars?: number
  /**
   * Ferramentas disponíveis nesta sessão (task 08, T10b). Sem `tools` e
   * `route`, o engine mantém o comportamento de texto puro.
   */
  tools?: () => readonly ToolDefinition[]
  /** Roteador de ferramentas já composto (permissão → confirmação → execução). */
  route?: (call: GeminiFunctionCall) => Promise<ToolCallResult>
  /** Continuações após uma chamada de ferramenta (default 2). */
  maxToolContinuations?: number
}

export const DEFAULT_MAX_TOOL_CONTINUATIONS = 2

/** Resposta estruturada devolvida ao modelo; nunca lança por falha de tool. */
function functionResponsePayload(result: ToolCallResult): Record<string, unknown> {
  if (result.ok) {
    return { ok: true, result: result.result ?? null }
  }
  return { ok: false, error: result.error }
}

function toolErrorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300)
}

export interface ChatSinks {
  delta: (text: string) => void
  done: (usage: ChatUsagePayload) => void
  error: (error: GeminiErrorSummary) => void
  /** Chamadas de ferramenta pedidas pelo modelo (entrada não confiável). */
  functionCalls?: (calls: GeminiFunctionCall[]) => void
}

/** Extensão multimodal de `send` (visão de tela, task 07). */
export interface GeminiSendOptions {
  images?: GeminiImage[]
  /** Regras adicionais de sistema (envelope/conteúdo de tela). */
  systemInstructionAppend?: string
  /** Tokens estimados da imagem, contabilizados logo após o envio. */
  imageTokens?: number
}

export type GeminiStatus = GeminiStatusInfo

export interface TestKeyResult {
  ok: boolean
  model?: string
  error?: GeminiErrorSummary
  usage?: ChatUsagePayload
  durationMs?: number
}

const DEFAULT_MAX_TEXT_CHARS = 32_000
const TEST_PROMPT = 'Responda apenas com a palavra ok.'
const TEST_SYSTEM_INSTRUCTION = 'Você é um teste de conectividade. Responda em uma palavra.'
const NO_KEY_MESSAGE = 'Chave do Gemini não configurada.'

export class GeminiEngine {
  private readonly client: GeminiClient
  private readonly keys: SecretReader
  private readonly config: () => GeminiEngineConfig
  private readonly usage: UsageMeter
  private readonly history: ChatHistory
  private readonly logger?: EngineLogger
  private readonly now: () => Date
  private readonly defaultLanguage: string
  private readonly promptVersion: string
  private readonly maxTextChars: number
  private readonly tools?: () => readonly ToolDefinition[]
  private readonly route?: (call: GeminiFunctionCall) => Promise<ToolCallResult>
  private readonly maxToolContinuations: number

  private lastError: GeminiErrorSummary | null = null
  private active: { requestId: string; controller: AbortController } | null = null

  constructor(options: GeminiEngineOptions) {
    this.client = new GeminiClient({ transport: options.transport })
    this.keys = options.keys
    this.config = options.config
    this.usage = options.usage
    this.history = options.history
    this.logger = options.logger
    this.now = options.now ?? (() => new Date())
    this.defaultLanguage = options.defaultLanguage ?? 'pt-BR'
    this.promptVersion = options.promptVersion ?? PROMPT_VERSION
    this.maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS
    this.tools = options.tools
    this.route = options.route
    this.maxToolContinuations = Math.max(
      0,
      options.maxToolContinuations ?? DEFAULT_MAX_TOOL_CONTINUATIONS
    )
  }

  getPromptVersion(): string {
    return this.promptVersion
  }

  isConfigured(): boolean {
    try {
      return this.keys.hasApiKey()
    } catch {
      return false
    }
  }

  status(): GeminiStatus {
    const configured = this.isConfigured()
    const usage = this.usage.snapshot()
    let disabledReason: string | null = null
    if (!configured) disabledReason = NO_KEY_MESSAGE
    else if (usage.month >= usage.cap) disabledReason = quotaMessage(usage.month, usage.cap)
    return {
      configured,
      model: this.config().model,
      lastError: this.lastError,
      disabledReason,
      usage
    }
  }

  /** Valida tipo/tamanho e grava via `secrets.setApiKey`; nunca devolve o valor. */
  setKey(value: unknown): { ok: boolean; error?: string } {
    if (typeof value !== 'string') {
      return { ok: false, error: 'Chave inválida: era esperado texto.' }
    }
    const key = value.trim()
    if (key.length < 8) return { ok: false, error: 'Chave inválida: curta demais.' }
    if (key.length > 4096) return { ok: false, error: 'Chave inválida: longa demais.' }
    const result = this.keys.setApiKey(key)
    if (result.ok) {
      this.lastError = null
      this.logger?.info('gemini', 'chave configurada')
    }
    return result
  }

  clearKey(): { ok: boolean; error?: string } {
    const result = this.keys.clearApiKey()
    if (result.ok) {
      this.lastError = null
      this.logger?.info('gemini', 'chave apagada')
    }
    return result
  }

  /**
   * Chamada mínima que prova a chave. Custo é contabilizado como qualquer
   * chamada; sem chave ou com teto estourado, nenhuma rede acontece.
   */
  async testKey(options?: { signal?: AbortSignal }): Promise<TestKeyResult> {
    const startedAt = Date.now()
    try {
      this.assertEnabled()
      const config = this.config()
      const result = await this.client.generateText(
        {
          apiKey: this.requireKey(),
          model: config.model,
          temperature: 0,
          systemInstruction: TEST_SYSTEM_INSTRUCTION,
          contents: [{ role: 'user', text: TEST_PROMPT }],
          maxOutputTokens: 32
        },
        { signal: options?.signal }
      )
      const amounts = resolveUsage(TEST_PROMPT + TEST_SYSTEM_INSTRUCTION, result.text, result.usage)
      this.usage.record(amounts)
      this.lastError = null
      const durationMs = Date.now() - startedAt
      this.logger?.info('gemini', 'test-key ok', {
        model: config.model,
        promptChars: TEST_PROMPT.length,
        outputChars: result.text.length,
        tokens: amounts.total,
        estimated: amounts.estimated,
        durationMs
      })
      return {
        ok: true,
        model: config.model,
        usage: {
          input: amounts.input,
          output: amounts.output,
          total: amounts.total,
          estimated: amounts.estimated
        },
        durationMs
      }
    } catch (err) {
      const error = classifyError(err)
      this.lastError = { kind: error.kind, message: error.message }
      this.logger?.warn('gemini', 'test-key falhou', {
        kind: error.kind,
        status: error.status
      })
      return { ok: false, error: { kind: error.kind, message: error.message } }
    }
  }

  /**
   * Envia um turno e entrega a resposta em deltas. Um requestId novo cancela o
   * anterior; nenhum delta sai depois do cancelamento.
   */
  async send(
    requestId: string,
    text: string,
    sinks: ChatSinks,
    options: GeminiSendOptions = {}
  ): Promise<void> {
    if (typeof requestId !== 'string' || requestId.length === 0) {
      sinks.error({ kind: 'invalid', message: 'requestId inválido.' })
      return
    }
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (!trimmed) {
      sinks.error({ kind: 'invalid', message: 'Mensagem vazia.' })
      return
    }
    if (trimmed.length > this.maxTextChars) {
      sinks.error({
        kind: 'invalid',
        message: `Mensagem longa demais (máximo ${this.maxTextChars} caracteres).`
      })
      return
    }

    this.cancelActive()

    try {
      this.assertEnabled()
    } catch (err) {
      const error = classifyError(err)
      this.lastError = { kind: error.kind, message: error.message }
      sinks.error({ kind: error.kind, message: error.message })
      return
    }

    const controller = new AbortController()
    const entry = { requestId, controller }
    this.active = entry

    const config = this.config()
    const toolDefinitions = this.tools?.() ?? []
    const toolDeclarations: GeminiToolDeclaration[] = toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }))
    const promptTools = toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category
    }))
    const append = options.systemInstructionAppend?.trim()
    const basePrompt = buildSystemPrompt({
      defaultLanguage: this.defaultLanguage,
      ...(promptTools.length > 0 ? { tools: promptTools } : {})
    })
    const systemInstruction = append ? `${basePrompt}\n\n${append}` : basePrompt
    const baseContents = buildContextWindow(this.history.getTurns(), trimmed)
    const images = Array.isArray(options.images) ? options.images : []
    const contents =
      images.length > 0
        ? baseContents.map((part, index) =>
            index === baseContents.length - 1 ? { ...part, images } : part
          )
        : baseContents
    const imageTokens =
      typeof options.imageTokens === 'number' &&
      Number.isFinite(options.imageTokens) &&
      options.imageTokens > 0
        ? Math.floor(options.imageTokens)
        : 0
    const promptChars = contents.reduce((total, part) => total + part.text.length, 0)

    let pendingText = ''
    let modelText = ''
    let totalInput = 0
    let totalOutput = 0
    let estimated = false
    let callIndex = 0
    let continuations = 0
    let toolCallCount = 0
    let callContents = contents
    const startedAt = Date.now()
    this.logger?.debug('gemini', 'chat:send', {
      chars: promptChars,
      turns: contents.length,
      model: config.model,
      images: images.length,
      imageTokens,
      tools: toolDeclarations.length
    })

    try {
      // Custo de imagem entra no medidor imediatamente após o envio, antes da
      // resposta; o total do provedor (se vier) já inclui a imagem e por isso
      // ela é descontada da entrada do PRIMEIRO turno para não contar duas vezes.
      if (imageTokens > 0) {
        try {
          this.usage.record({ input: imageTokens, output: 0 })
        } catch (err) {
          this.logger?.warn('gemini', 'falha ao registrar tokens de imagem', err)
        }
      }

      for (;;) {
        if (controller.signal.aborted) {
          throw new GeminiError('cancelled', 'Chamada cancelada.')
        }
        pendingText = ''
        const streamResult = await this.client.streamText(
          {
            apiKey: this.requireKey(),
            model: config.model,
            temperature: config.temperature,
            systemInstruction,
            contents: callContents,
            ...(toolDeclarations.length > 0 ? { tools: toolDeclarations } : {})
          },
          {
            signal: controller.signal,
            onDelta: (delta) => {
              if (entry.controller.signal.aborted) return
              pendingText += delta
              sinks.delta(delta)
            }
          }
        )
        const amounts = resolveUsage(
          systemInstruction + pendingText,
          streamResult.text,
          streamResult.usage
        )
        const adjustedInput =
          callIndex === 0 && imageTokens > 0 && !amounts.estimated
            ? Math.max(0, amounts.input - imageTokens)
            : amounts.input
        totalInput += adjustedInput
        totalOutput += amounts.output
        estimated = estimated || amounts.estimated
        this.usage.record({ input: adjustedInput, output: amounts.output })
        pendingText = ''
        modelText += streamResult.text
        callIndex += 1
        const calls = streamResult.functionCalls ?? []
        if (calls.length === 0) break

        toolCallCount += calls.length
        sinks.functionCalls?.(calls)

        if (
          !this.route ||
          toolDeclarations.length === 0 ||
          continuations >= this.maxToolContinuations
        ) {
          break
        }

        continuations += 1
        const responses: GeminiFunctionResponse[] = []
        for (const call of calls) {
          if (controller.signal.aborted) break
          let callResult: ToolCallResult
          try {
            callResult = await this.route(call)
          } catch (err) {
            callResult = {
              ok: false,
              error: { kind: 'failed', message: toolErrorMessage(err) }
            }
          }
          if (controller.signal.aborted) break
          responses.push({ name: call.name, response: functionResponsePayload(callResult) })
        }
        if (controller.signal.aborted) {
          throw new GeminiError('cancelled', 'Chamada cancelada.')
        }
        callContents = [
          ...callContents,
          { role: 'model', text: streamResult.text, functionCalls: calls },
          { role: 'user', text: '', functionResponses: responses }
        ]
      }

      if (controller.signal.aborted) {
        throw new GeminiError('cancelled', 'Chamada cancelada.')
      }
      this.history.append('user', trimmed)
      if (modelText.length > 0) this.history.append('model', modelText)
      this.lastError = null
      const durationMs = Date.now() - startedAt
      this.logger?.info('gemini', 'chat:done', {
        model: config.model,
        chars: modelText.length,
        tokens: totalInput + totalOutput,
        estimated,
        imageTokens,
        tools: toolCallCount,
        continuations,
        durationMs
      })
      sinks.done({
        input: totalInput,
        output: totalOutput,
        total: totalInput + totalOutput,
        estimated,
        ...(imageTokens > 0 ? { imageTokens, imageEstimated: true } : {})
      })
    } catch (err) {
      const error = classifyError(err)
      if (pendingText.length > 0) {
        const amounts = resolveUsage(systemInstruction + pendingText, pendingText)
        this.usage.record({ input: amounts.input, output: amounts.output })
      }
      if (error.kind !== 'cancelled') {
        this.lastError = { kind: error.kind, message: error.message }
        this.logger?.warn('gemini', 'chat falhou', {
          kind: error.kind,
          status: error.status
        })
      }
      sinks.error({ kind: error.kind, message: error.message })
    } finally {
      if (this.active === entry) this.active = null
    }
  }

  /** Aborta a conversa ativa (opcionalmente só se o requestId bater). */
  cancel(requestId?: string): boolean {
    const entry = this.active
    if (!entry) return false
    if (requestId !== undefined && entry.requestId !== requestId) return false
    entry.controller.abort()
    return true
  }

  getActiveRequestId(): string | null {
    return this.active?.requestId ?? null
  }

  private cancelActive(): void {
    if (this.active) {
      this.logger?.debug('gemini', 'cancelando request anterior', {
        requestId: this.active.requestId
      })
      this.active.controller.abort()
      this.active = null
    }
  }

  /** Sem chave ou acima do teto: erro limpo, sem tocar no transporte. */
  private assertEnabled(): void {
    if (!this.isConfigured()) {
      throw new GeminiError('auth', NO_KEY_MESSAGE)
    }
    this.usage.checkBudget()
  }

  private requireKey(): string {
    const key = this.keys.getApiKey()
    if (!key) throw new GeminiError('auth', NO_KEY_MESSAGE)
    return key
  }
}

/** Teto normalizado a partir da configuração persistida. */
export function capFromConfig(gemini: { monthlyTokenCap: number }): number {
  return clampCap(gemini.monthlyTokenCap)
}
