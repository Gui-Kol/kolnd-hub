import type {
  GeminiFunctionCall,
  GeminiGenerateResult,
  GeminiGroundingChunk,
  GeminiRequest,
  GeminiStreamChunk,
  GeminiTransport,
  GeminiUsageMetadata
} from '../transport'

/**
 * Transporte falso usado por TODOS os testes do motor. Nenhum teste importa o
 * SDK real ou toca na rede: o cliente, a engine, o roteador e o IPC são
 * exercitados contra este arquivo.
 *
 * Cenários são programáveis por tentativa (`streamErrors[0]`, `[1]`, ...) para
 * cobrir retry sem timers reais longos.
 */

export interface FakeStreamStep {
  text?: string
  /** Atraso antes de entregar o chunk; respeita o abortSignal do request. */
  delayMs?: number
  usage?: GeminiUsageMetadata
  blocked?: boolean
  finishReason?: string
  /** Chamadas de ferramenta pedidas por este chunk. */
  functionCalls?: GeminiFunctionCall[]
}

export interface FakeGenerateStep {
  text?: string
  delayMs?: number
  usage?: GeminiUsageMetadata
  blocked?: boolean
  finishReason?: string
  /** Fontes de grounding devolvidas pelo provedor falso. */
  groundingChunks?: GeminiGroundingChunk[]
}

export interface FakeTransportScenario {
  /** Chunks entregues em sequência no `stream` (repetidos em toda tentativa). */
  streamSteps?: FakeStreamStep[]
  /** Chunks por tentativa de `stream` (índice = tentativa - 1). */
  streamStepsByAttempt?: FakeStreamStep[][]
  /** Erro lançado na N-ésima tentativa de `stream` (índice = tentativa - 1). */
  streamErrors?: Array<unknown | undefined>
  /** Resultado de `generate` por tentativa. */
  generateSteps?: FakeGenerateStep[]
  /** Erro lançado na N-ésima tentativa de `generate`. */
  generateErrors?: Array<unknown | undefined>
  /** Nunca resolve nem entrega chunk; só termina pelo abortSignal. */
  hang?: boolean
}

/** Erro no formato que o cliente reconhece como aborto do transporte. */
export function createAbortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

/** Espera `ms`, rejeitando com AbortError se o sinal abortar antes. */
export function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function pick<T>(values: T[] | undefined, attempt: number): T | undefined {
  if (!values || values.length === 0) return undefined
  return values[Math.min(attempt, values.length - 1)]
}

export class FakeTransport implements GeminiTransport {
  readonly requests: GeminiRequest[] = []
  streamAttempts = 0
  generateAttempts = 0

  constructor(public scenario: FakeTransportScenario = {}) {}

  setScenario(scenario: FakeTransportScenario): void {
    this.scenario = scenario
  }

  reset(): void {
    this.requests.length = 0
    this.streamAttempts = 0
    this.generateAttempts = 0
  }

  async *stream(request: GeminiRequest): AsyncIterable<GeminiStreamChunk> {
    this.requests.push(request)
    const attempt = this.streamAttempts
    this.streamAttempts += 1
    if (this.scenario.hang) {
      await new Promise<void>((_resolve, reject) => {
        const signal = request.abortSignal
        if (!signal) return
        if (signal.aborted) {
          reject(createAbortError())
          return
        }
        signal.addEventListener('abort', () => reject(createAbortError()), { once: true })
      })
      return
    }
    const error = pick(this.scenario.streamErrors, attempt)
    if (error !== undefined) throw error
    const steps = this.scenario.streamStepsByAttempt?.[attempt] ?? this.scenario.streamSteps ?? []
    for (const step of steps) {
      await waitFor(step.delayMs ?? 0, request.abortSignal)
      yield {
        text: step.text,
        usage: step.usage,
        blocked: step.blocked,
        finishReason: step.finishReason,
        functionCalls: step.functionCalls
      }
    }
  }

  async generate(request: GeminiRequest): Promise<GeminiGenerateResult> {
    this.requests.push(request)
    const attempt = this.generateAttempts
    this.generateAttempts += 1
    if (this.scenario.hang) {
      await new Promise<void>((_resolve, reject) => {
        const signal = request.abortSignal
        if (!signal) return
        if (signal.aborted) {
          reject(createAbortError())
          return
        }
        signal.addEventListener('abort', () => reject(createAbortError()), { once: true })
      })
    }
    const error = pick(this.scenario.generateErrors, attempt)
    if (error !== undefined) throw error
    const step = pick(this.scenario.generateSteps, attempt) ?? { text: '' }
    await waitFor(step.delayMs ?? 0, request.abortSignal)
    return {
      text: step.text ?? '',
      usage: step.usage,
      blocked: step.blocked,
      finishReason: step.finishReason,
      groundingChunks: step.groundingChunks
    }
  }
}
