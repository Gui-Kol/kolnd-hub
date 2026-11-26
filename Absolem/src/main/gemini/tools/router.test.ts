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

  it('ferramenta sensível pede confirmação e executa após aceite', async () => {
    const { confirm, dangerHandler, routerOptions } = harness()

    const result = await routeToolCall(routerOptions, {
      name: 'danger_test',
      args: { target: 'janela' }
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({
      tool: { name: 'danger_test' },
      args: { target: 'janela' }
    })
    expect(dangerHandler).toHaveBeenCalledWith({ target: 'janela' })
    expect(result).toEqual({ ok: true, result: { done: true } })
  })

  it('timeout de confirmação nega e não executa', async () => {
    const { dangerHandler, audits, routerOptions } = harness({
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
})
