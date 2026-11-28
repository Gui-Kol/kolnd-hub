import { createHash } from 'crypto'
import type { ToolDefinition } from '../../../shared/tools'
import { sanitizeSafeArgs } from '../../audit/actions'
import type { GeminiFunctionCall } from '../transport'
import type { ToolRegistry } from './registry'
import type { ToolHandler } from './internal'

/**
 * Roteador de ferramentas.
 *
 * Toda chamada é entrada não confiável (o modelo pode ser induzido por conteúdo
 * de tela/web). Ordem: schema -> permissão -> confirmação -> execução com
 * timeout. Ferramenta sensível ou categoria sem `allow` abre confirmação
 * nativa; sem resposta em 30 s, nega. Cada execução gera auditoria com hash dos
 * argumentos (nunca os valores) e volta ao modelo como resultado estruturado:
 * falha de ferramenta não derruba o stream.
 */

export type PermissionDecision = 'allow' | 'ask' | 'deny'

export type AuditDecision =
  'allow' | 'ask-accepted' | 'ask-denied' | 'denied' | 'invalid' | 'unknown'

export interface AuditEvent {
  at: string
  tool: string
  argsHash: string
  decision: AuditDecision
  ok: boolean
  durationMs: number
}

/**
 * Contexto extra para a auditoria local de ações (task 08). O evento do
 * roteador mantém as chaves originais; o segundo parâmetro só é lido por quem
 * precisa de categoria/`safeArgs`.
 */
export interface AuditContext {
  category: string
  safeArgs: Record<string, unknown>
}

export interface ConfirmationRequest {
  tool: ToolDefinition
  args: Record<string, unknown>
}

export type ConfirmationHandler = (request: ConfirmationRequest) => Promise<boolean>

export type ToolCallErrorKind = 'invalid' | 'denied' | 'not-found' | 'timeout' | 'quota' | 'failed'

export type ToolCallResult =
  { ok: true; result: unknown } | { ok: false; error: { kind: ToolCallErrorKind; message: string } }

export interface ToolRouterOptions {
  registry: ToolRegistry
  getHandler: (name: string) => ToolHandler | null
  /** Permissão por categoria; default `ask` (tudo confirma). */
  getPermission?: (category: string) => PermissionDecision
  confirm: ConfirmationHandler
  confirmTimeoutMs?: number
  audit?: (event: AuditEvent, context?: AuditContext) => void
  now?: () => number
  hash?: (text: string) => string
  /** Cancelamento do turno inteiro; aborta o sinal entregue ao handler. */
  signal?: AbortSignal
}

export const DEFAULT_CONFIRM_TIMEOUT_MS = 30_000

export function shortArgsHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/**
 * Auditoria de produção: `logger.info('audit', evento)` com `at`, `tool`,
 * `argsHash`, `decision`, `ok`, `durationMs` - nunca os valores dos argumentos.
 */
export function createLoggerAudit(logger: {
  info: (scope: string, message: unknown, ...args: unknown[]) => void
}): (event: AuditEvent) => void {
  return (event) => logger.info('audit', event)
}

function stableArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {})
  } catch {
    return '{}'
  }
}

interface TimeoutRace<T> {
  timedOut: boolean
  value?: T
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<TimeoutRace<T>> {
  return new Promise<TimeoutRace<T>>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ timedOut: true })
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ timedOut: false, value })
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300)
  return String(err).slice(0, 300)
}

function timeoutMessage(tool: ToolDefinition): string {
  const seconds = Math.round(tool.timeoutMs / 1000)
  if (tool.name === 'web_search') {
    return `A pesquisa na internet demorou mais de ${seconds} s e foi interrompida. Tente novamente.`
  }
  if (tool.name === 'fetch_url') {
    return `A abertura da página demorou mais de ${seconds} s e foi interrompida.`
  }
  return `A ferramenta não respondeu em ${tool.timeoutMs} ms.`
}

/** Erros tipados da pesquisa preservam `quota`; o resto é falha comum. */
function toolErrorKind(err: unknown): ToolCallErrorKind {
  if (err && typeof err === 'object' && (err as { kind?: unknown }).kind === 'quota') {
    return 'quota'
  }
  return 'failed'
}

export async function routeToolCall(
  options: ToolRouterOptions,
  call: GeminiFunctionCall
): Promise<ToolCallResult> {
  const now = options.now ?? (() => Date.now())
  const startedAt = now()
  const hash = options.hash ?? shortArgsHash
  const getPermission = options.getPermission ?? (() => 'ask')
  const confirmTimeoutMs = options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS
  const name = typeof call?.name === 'string' ? call.name : ''
  const args = call?.args && typeof call.args === 'object' ? call.args : {}
  const argsHash = hash(stableArgs(args))

  const finish = (decision: AuditDecision, ok: boolean, result: ToolCallResult): ToolCallResult => {
    try {
      options.audit?.(
        {
          at: new Date(now()).toISOString(),
          tool: name,
          argsHash,
          decision,
          ok,
          durationMs: Math.max(0, now() - startedAt)
        },
        { category: tool?.category ?? '', safeArgs: sanitizeSafeArgs(args) }
      )
    } catch {
      // Auditoria é best-effort: falha de log não muda o resultado da ferramenta.
    }
    return result
  }

  const tool = options.registry.getTool(name)
  if (!tool) {
    return finish('unknown', false, {
      ok: false,
      error: { kind: 'not-found', message: `Ferramenta desconhecida: ${name || '(vazia)'}` }
    })
  }

  const validation = options.registry.validateArguments(name, args)
  if (!validation.ok) {
    return finish('invalid', false, {
      ok: false,
      error: { kind: 'invalid', message: `Argumentos inválidos: ${validation.errors.join('; ')}` }
    })
  }

  const permission = getPermission(tool.category)
  if (permission === 'deny') {
    return finish('denied', false, {
      ok: false,
      error: { kind: 'denied', message: `Permissão negada para a categoria ${tool.category}.` }
    })
  }

  let decision: AuditDecision = 'allow'
  if (permission !== 'allow') {
    let accepted: boolean
    try {
      const confirmation = await raceTimeout(
        Promise.resolve().then(() => options.confirm({ tool, args: validation.value })),
        confirmTimeoutMs
      )
      accepted = confirmation.timedOut !== true && confirmation.value === true
    } catch {
      accepted = false
    }
    if (!accepted) {
      return finish('ask-denied', false, {
        ok: false,
        error: { kind: 'denied', message: 'Ação não confirmada pelo usuário.' }
      })
    }
    decision = 'ask-accepted'
  }

  const handler = options.getHandler(tool.name)
  if (!handler) {
    return finish(decision, false, {
      ok: false,
      error: { kind: 'failed', message: 'Ferramenta sem executor registrado.' }
    })
  }

  const controller = new AbortController()
  const onExternalAbort = (): void => controller.abort()
  const external = options.signal
  if (external) {
    if (external.aborted) {
      return finish(decision, false, {
        ok: false,
        error: { kind: 'failed', message: 'A ferramenta foi cancelada.' }
      })
    }
    external.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    const execution = await raceTimeout(
      Promise.resolve().then(() => handler(validation.value, { signal: controller.signal })),
      tool.timeoutMs
    )
    if (execution.timedOut) {
      // Para o handler de verdade: sem isso a requisição de rede continuaria
      // consumindo depois que o modelo já recebeu o timeout.
      controller.abort()
      return finish(decision, false, {
        ok: false,
        error: {
          kind: 'timeout',
          message: timeoutMessage(tool)
        }
      })
    }
    return finish(decision, true, { ok: true, result: execution.value })
  } catch (err) {
    return finish(decision, false, {
      ok: false,
      error: { kind: toolErrorKind(err), message: `Falha na ferramenta: ${errorMessage(err)}` }
    })
  } finally {
    external?.removeEventListener('abort', onExternalAbort)
  }
}
