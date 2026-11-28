import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '../../../shared/tools'
import { createDefaultToolRegistry, createInternalTools } from './internal'
import { deduplicateTools } from './compose'
import { createToolRegistry } from './registry'

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'echo_test',
    description: 'Ferramenta de teste.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' }
      },
      additionalProperties: false
    },
    sensitive: false,
    category: 'internal',
    timeoutMs: 1_000,
    ...overrides
  }
}

describe('registro de ferramentas', () => {
  it('nome duplicado é rejeitado', () => {
    const registry = createToolRegistry()
    expect(registry.registerTool(tool()).ok).toBe(true)
    expect(registry.registerTool(tool())).toEqual({
      ok: false,
      error: 'ferramenta já registrada: echo_test'
    })
    expect(registry.listTools()).toHaveLength(1)
  })

  it('schema sem required é aceito', () => {
    const registry = createToolRegistry()
    const definition = tool({
      parameters: {
        type: 'object',
        properties: { timezone: { type: 'string', maxLength: 64 } },
        additionalProperties: false
      }
    })

    expect(registry.registerTool(definition)).toEqual({ ok: true })
    expect(registry.validateArguments('echo_test', {})).toEqual({ ok: true, value: {} })
  })

  it('argumento extra é rejeitado quando additionalProperties false', () => {
    const registry = createToolRegistry()
    registry.registerTool(tool())

    const result = registry.validateArguments('echo_test', { text: 'oi', extra: 1 })

    expect(result).toEqual({ ok: false, errors: ['args.extra: argumento não permitido'] })
  })

  it('listTools devolve cópia imutável', () => {
    const registry = createToolRegistry()
    registry.registerTool(tool())

    const list = registry.listTools()
    expect(Object.isFrozen(list)).toBe(true)
    expect(Object.isFrozen(list[0])).toBe(true)
    expect(Object.isFrozen(list[0]?.parameters)).toBe(true)
    expect(() => {
      ;(list as ToolDefinition[]).push(tool({ name: 'outro' }))
    }).toThrow()
    expect(() => {
      ;(list[0] as ToolDefinition).description = 'alterado'
    }).toThrow()

    expect(registry.getTool('echo_test')?.description).toBe('Ferramenta de teste.')
    expect(registry.listTools()).toHaveLength(1)
  })

  it('schema fora do subset suportado é rejeitado no registro', () => {
    const registry = createToolRegistry()
    const result = registry.registerTool(
      tool({
        parameters: {
          type: 'object',
          properties: { text: { type: 'string', pattern: '^a' } }
        }
      })
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('keyword não suportado: pattern')
  })

  it('enum, mínimo e máximo são validados nos argumentos', () => {
    const registry = createToolRegistry()
    registry.registerTool(
      tool({
        name: 'tunable',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['fast', 'safe'] },
            level: { type: 'integer', minimum: 1, maximum: 3 }
          },
          required: ['mode'],
          additionalProperties: false
        }
      })
    )

    expect(registry.validateArguments('tunable', { mode: 'fast', level: 2 })).toEqual({
      ok: true,
      value: { mode: 'fast', level: 2 }
    })
    expect(registry.validateArguments('tunable', { mode: 'other' }).ok).toBe(false)
    expect(registry.validateArguments('tunable', { mode: 'fast', level: 9 }).ok).toBe(false)
    expect(registry.validateArguments('tunable', { level: 2 }).ok).toBe(false)
  })

  it('ferramentas internas: get_current_time sempre, echo só no modo teste', () => {
    const production = createDefaultToolRegistry()
    expect(production.registry.listTools().map((entry) => entry.name)).toEqual(['get_current_time'])

    const testRegistry = createDefaultToolRegistry({ includeEcho: true })
    expect(testRegistry.registry.listTools().map((entry) => entry.name)).toEqual([
      'get_current_time',
      'echo'
    ])
    expect(createInternalTools({ includeEcho: true })).toHaveLength(2)
  })

  it('deduplica a composição Live por nome e mantém a primeira implementação', () => {
    const actions = createDefaultToolRegistry()
    const capture = createDefaultToolRegistry()
    const tools = deduplicateTools([
      ...actions.registry.listTools(),
      ...capture.registry.listTools()
    ])

    expect(tools.map((tool) => tool.name)).toEqual(['get_current_time'])
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length)
  })
})
