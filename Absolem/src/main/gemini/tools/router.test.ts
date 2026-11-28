import { describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '../../../shared/tools'
import { createDefaultToolRegistry } from './internal'
import {
  createLoggerAudit,
  routeToolCall,
  type AuditEvent,
  type ConfirmationHandler,
  type ToolRouterOptions
} from './router'
import type { ToolHandler } from './internal'

const DANGER: ToolDefinition = {
  name: 'danger_test',
  description: 'Ferramenta sensível de teste.',
  parameters: {
    type: 'object',
    properties: { target: { type: 'string' } },
    required: ['target'],
    additionalProperties: false
  },
  sensitive: true,
  category: 'computer',
  timeoutMs: 1_000
}

function harness(options?: {
  confirmation?: ConfirmationHandler
  permission?: () => 'allow' | 'ask' | 'deny'
}) {
  const { registry, handlers } = createDefaultToolRegistry({ includeEcho: true })
  const dangerHandler = vi.fn(() => ({ done: true }))
  const registered = registry.registerTool(DANGER)
  if (!registered.ok) throw new Error(registered.error)
  handlers.set(DANGER.name, dangerHandler as unknown as ToolHandler)

  const audits: AuditEvent[] = []
  const confirm = vi.fn(options?.confirmation ?? (async () => true))
  const routerOptions: ToolRouterOptions = {
    registry,
    getHandler: (name) => handlers.get(name) ?? null,
    getPermission: options?.permission ?? (() => 'allow'),
    confirm,
    confirmTimeoutMs: 10,
    audit: (event) => audits.push(event),
    now: () => new Date('2026-11-26T12:00:00.000Z').getTime()
  }
  return { registry, handlers, dangerHandler, confirm, audits, routerOptions }
}

describe('roteador de ferramentas', () => {
  it('tool não sensível executa sem diálogo quando a categoria é allow', async () => {
    const { confirm, audits, routerOptions } = harness()

    const result = await routeToolCall(routerOptions, { name: 'echo', args: { text: 'oi' } })

    expect(result).toEqual({ ok: true, result: { echoed: 'oi' } })
    expect(confirm).not.toHaveBeenCalled()
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ tool: 'echo', decision: 'allow', ok: true })
  })

  it('ferramenta sensível em allow executa sem confirmação repetida', async () => {
    const { confirm, dangerHandler, routerOptions } = harness()

    const result = await routeToolCall(routerOptions, {
      name: 'danger_test',
      args: { target: 'janela' }
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(dangerHandler).toHaveBeenCalledWith(
      { target: 'janela' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(result).toEqual({ ok: true, result: { done: true } })
  })

  it('categoria ask continua exigindo confirmação e respeita timeout', async () => {
    const { dangerHandler, audits, routerOptions } = harness({
      permission: () => 'ask',
      confirmation: () => new Promise<boolean>(() => undefined)
    })

    const result = await routeToolCall(routerOptions, {
      name: 'danger_test',
      args: { target: 'janela' }
    })

    expect(result).toEqual({
      ok: false,
      error: { kind: 'denied', message: 'Ação não confirmada pelo usuário.' }
    })
    expect(dangerHandler).not.toHaveBeenCalled()
    expect(audits[0]).toMatchObject({ decision: 'ask-denied', ok: false })
  })

  it('timeout de pesquisa web devolve mensagem clara em pt-BR', async () => {
    const { registry, handlers, routerOptions } = harness()
    const webSearch: ToolDefinition = {
      name: 'web_search',
      description: 'Pesquisa web.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1 } },
        required: ['query'],
        additionalProperties: false
      },
      sensitive: false,
      category: 'web.search',
      timeoutMs: 1_000
    }
    expect(registry.registerTool(webSearch).ok).toBe(true)
    handlers.set(webSearch.name, () => new Promise(() => undefined))

    const result = await routeToolCall(routerOptions, {
      name: 'web_search',
      args: { query: 'modelos de IA do Gemini' }
    })

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'timeout',
        message: 'A pesquisa na internet demorou mais de 1 s e foi interrompida. Tente novamente.'
      }
    })
  })

  it('argumento inválido não executa nem confirma', async () => {
    const { confirm, audits, routerOptions } = harness()

    const result = await routeToolCall(routerOptions, {
      name: 'echo',
      args: { text: 'oi', extra: 'não permitido' }
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('invalid')
    expect(confirm).not.toHaveBeenCalled()
    expect(audits[0]).toMatchObject({ decision: 'invalid', ok: false })
  })

  it('auditoria grava decisão sem valores dos argumentos', async () => {
    const { audits, routerOptions } = harness()
    const segredo = 'SEGREDO_PESSOAL_XYZ'

    await routeToolCall(routerOptions, { name: 'echo', args: { text: segredo } })

    expect(audits[0]).toBeDefined()
    const event = audits[0] as AuditEvent
    expect(Object.keys(event).sort()).toEqual([
      'argsHash',
      'at',
      'decision',
      'durationMs',
      'ok',
      'tool'
    ])
    expect(event.argsHash).toMatch(/^[0-9a-f]{16}$/)
    expect(event.at).toBe('2026-11-26T12:00:00.000Z')
    expect(JSON.stringify(event)).not.toContain(segredo)
  })

  it('categoria sem allow confirma mesmo em ferramenta não sensível', async () => {
    const { confirm, routerOptions } = harness({ permission: () => 'ask' })

    await routeToolCall(routerOptions, { name: 'echo', args: { text: 'oi' } })

    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('permissão deny não confirma e devolve erro estruturado', async () => {
    const { confirm, audits, routerOptions } = harness({ permission: () => 'deny' })

    const result = await routeToolCall(routerOptions, { name: 'echo', args: { text: 'oi' } })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('denied')
    expect(confirm).not.toHaveBeenCalled()
    expect(audits[0]).toMatchObject({ decision: 'denied', ok: false })
  })

  it('falha da ferramenta volta como resultado, sem lançar', async () => {
    const { registry, handlers, routerOptions } = harness()
    const failing: ToolDefinition = {
      name: 'fail_test',
      description: 'Ferramenta que falha.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sensitive: false,
      category: 'internal',
      timeoutMs: 1_000
    }
    expect(registry.registerTool(failing).ok).toBe(true)
    handlers.set('fail_test', () => {
      throw new Error('boom interno')
    })

    const result = await routeToolCall(routerOptions, { name: 'fail_test', args: {} })

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'Falha na ferramenta: boom interno' }
    })
  })

  it('auditoria de produção usa o escopo audit do logger', () => {
    const info = vi.fn()
    const audit = createLoggerAudit({ info })
    const event: AuditEvent = {
      at: '2026-11-26T12:00:00.000Z',
      tool: 'echo',
      argsHash: '0123456789abcdef',
      decision: 'allow',
      ok: true,
      durationMs: 2
    }

    audit(event)

    expect(info).toHaveBeenCalledWith('audit', event)
  })

  it('100 chamadas concorrentes terminam sem deadlock nem exceção não tratada', async () => {
    const { audits, routerOptions } = harness()
    const startedAt = performance.now()

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        routeToolCall(routerOptions, { name: 'echo', args: { text: `item-${index}` } })
      )
    )

    expect(performance.now() - startedAt).toBeLessThan(2_000)
    expect(results).toHaveLength(100)
    expect(results.every((result) => result.ok)).toBe(true)
    expect(audits).toHaveLength(100)
    expect(new Set(audits.map((event) => event.argsHash)).size).toBe(100)
  })

  it('timeout não rejeita quando a ferramenta termina depois do prazo', async () => {
    const { registry, handlers, routerOptions } = harness()
    const slow: ToolDefinition = {
      name: 'slow_test',
      description: 'Ferramenta lenta.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sensitive: false,
      category: 'internal',
      timeoutMs: 100
    }
    expect(registry.registerTool(slow).ok).toBe(true)
    handlers.set(
      'slow_test',
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ late: true }), 150)
        }) as never
    )

    const result = await routeToolCall(routerOptions, { name: 'slow_test', args: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('timeout')

    // Deixa a promessa original resolver: nada deve escapar como rejeição.
    await new Promise((resolve) => setTimeout(resolve, 200))
  })

  it('100 confirmações expiradas terminam negadas sem vazar timer', async () => {
    const { dangerHandler, routerOptions } = harness({
      permission: () => 'ask',
      confirmation: () => new Promise<boolean>(() => undefined)
    })

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        routeToolCall(routerOptions, {
          name: 'danger_test',
          args: { target: `janela-${index}` }
        })
      )
    )

    expect(results).toHaveLength(100)
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('denied')
    }
    expect(dangerHandler).not.toHaveBeenCalled()
  })

  it('timeout aborta o sinal entregue ao handler', async () => {
    const { registry, handlers, routerOptions } = harness()
    const tool: ToolDefinition = {
      name: 'abort_test',
      description: 'Ferramenta que espera o abort.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sensitive: false,
      category: 'internal',
      timeoutMs: 100
    }
    expect(registry.registerTool(tool).ok).toBe(true)
    let seen: AbortSignal | undefined
    handlers.set('abort_test', (_args, context) => {
      seen = context?.signal
      return new Promise((_resolve, reject) => {
        context?.signal.addEventListener('abort', () => reject(new Error('abortado')))
      })
    })

    const result = await routeToolCall(routerOptions, { name: 'abort_test', args: {} })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('timeout')
    expect(seen?.aborted).toBe(true)
  })

  it('cancelamento do turno chega ao handler e encerra a espera', async () => {
    const { registry, handlers, routerOptions } = harness()
    const tool: ToolDefinition = {
      name: 'wait_test',
      description: 'Ferramenta cancelável.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sensitive: false,
      category: 'internal',
      timeoutMs: 5_000
    }
    expect(registry.registerTool(tool).ok).toBe(true)
    let seen: AbortSignal | undefined
    let startedResolve!: () => void
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve
    })
    handlers.set('wait_test', (_args, context) => {
      seen = context?.signal
      startedResolve()
      return new Promise((_resolve, reject) => {
        context?.signal.addEventListener('abort', () => reject(new Error('cancelada pelo turno')))
      })
    })

    const external = new AbortController()
    const pending = routeToolCall(
      { ...routerOptions, signal: external.signal },
      { name: 'wait_test', args: {} }
    )
    await started
    external.abort()
    const result = await pending

    expect(seen?.aborted).toBe(true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('cancelada pelo turno')
  })

  it('sinal externo já cancelado não executa o handler', async () => {
    const { dangerHandler, routerOptions } = harness()
    const external = new AbortController()
    external.abort()

    const result = await routeToolCall(
      { ...routerOptions, signal: external.signal },
      { name: 'danger_test', args: { target: 'janela' } }
    )

    expect(result).toEqual({
      ok: false,
      error: { kind: 'failed', message: 'A ferramenta foi cancelada.' }
    })
    expect(dangerHandler).not.toHaveBeenCalled()
  })
})
