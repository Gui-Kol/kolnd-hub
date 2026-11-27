import { describe, expect, it } from 'vitest'
import { createToolRegistry } from '../gemini/tools/registry'
import type { ToolHandler } from '../gemini/tools/internal'
import { registerActionTools } from '../actions/tools'
import {
  HUB_HELP_MAX_SECTION_CHARS,
  HUB_HELP_MAX_SECTIONS,
  HUB_HELP_TOOL_NAME,
  createHubKnowledgeTool,
  type HubHelpResult
} from './hubTool'

function callHubHelp(
  entry: ReturnType<typeof createHubKnowledgeTool>,
  args: Record<string, unknown>
): HubHelpResult {
  return entry.handler(args) as HubHelpResult
}

describe('ferramenta hub_help', () => {
  it('declara a definição da task: internal, não sensível, timeout de 5 s e topic 1–120', () => {
    const entry = createHubKnowledgeTool({ env: {} })

    expect(entry.definition.name).toBe(HUB_HELP_TOOL_NAME)
    expect(entry.definition.category).toBe('internal')
    expect(entry.definition.sensitive).toBe(false)
    expect(entry.definition.timeoutMs).toBe(5_000)
    expect(entry.definition.parameters).toMatchObject({
      required: ['topic'],
      properties: {
        topic: { type: 'string', minLength: 1, maxLength: 120 }
      }
    })
  })

  it('devolve no máximo 2 seções e até 1.500 caracteres de corpo', () => {
    const result = callHubHelp(createHubKnowledgeTool({ env: {} }), {
      topic: 'hub kloud games biblioteca hud'
    })

    expect(result.sections.length).toBeGreaterThan(0)
    expect(result.sections.length).toBeLessThanOrEqual(HUB_HELP_MAX_SECTIONS)
    const chars = result.sections.reduce((sum, section) => sum + section.body.length, 0)
    expect(chars).toBeLessThanOrEqual(HUB_HELP_MAX_SECTION_CHARS)
  })

  it('usa a versão do Hub injetada no ambiente', () => {
    const entry = createHubKnowledgeTool({ env: { ABSOLEM_HUB_VERSION: '1.2.3' } })
    expect(callHubHelp(entry, { topic: 'onde fica o HUD' }).hubVersion).toBe('1.2.3')
  })

  it('sem versão válida usa "desconhecida"', () => {
    const entry = createHubKnowledgeTool({ env: { ABSOLEM_HUB_VERSION: 'qualquer-coisa' } })
    expect(callHubHelp(entry, { topic: 'biblioteca' }).hubVersion).toBe('desconhecida')
  })

  it('acha o HUD e devolve a seção com título e corpo', () => {
    const result = callHubHelp(createHubKnowledgeTool({ env: {} }), { topic: 'onde fica o HUD' })

    expect(result.sections[0]?.id).toBe('hud')
    expect(result.sections[0]?.title).toBe('HUD')
    expect(result.sections[0]?.body).toContain('Shift+Insert')
    expect(result.overview).toContain('Ferramentas')
  })

  it('sem resultado devolve overview e a lista de tópicos, sem seções', () => {
    const result = callHubHelp(createHubKnowledgeTool({ env: {} }), {
      topic: 'receita de bolo de cenoura'
    })

    expect(result.sections).toEqual([])
    expect(result.overview.length).toBeGreaterThan(0)
    expect(result.topics).toHaveLength(13)
    expect(result.topics?.map((topic) => topic.id)).toContain('desinstalacao')
  })

  it('aceita topic com espaços nas pontas e recusa vazio', () => {
    const entry = createHubKnowledgeTool({ env: {} })
    expect(callHubHelp(entry, { topic: '  biblioteca  ' }).sections[0]?.id).toBe('biblioteca')
    const empty = callHubHelp(entry, { topic: '   ' })
    expect(empty.sections).toEqual([])
    expect(empty.topics).toHaveLength(13)
  })

  it('registra no registry via registerActionTools', () => {
    const registry = createToolRegistry()
    const handlers = new Map<string, ToolHandler>()
    const entry = createHubKnowledgeTool({ env: { ABSOLEM_HUB_VERSION: '1.2.3' } })

    const result = registerActionTools(registry, handlers, [entry])

    expect(result).toEqual({ ok: true, errors: [] })
    expect(registry.getTool('hub_help')?.name).toBe('hub_help')
    expect(handlers.get('hub_help')).toBe(entry.handler)
    expect(registry.validateArguments('hub_help', { topic: 'HUD' }).ok).toBe(true)
    expect(registry.validateArguments('hub_help', {}).ok).toBe(false)
  })

  it('recusa registro duplicado de hub_help', () => {
    const registry = createToolRegistry()
    const handlers = new Map<string, ToolHandler>()
    const entry = createHubKnowledgeTool({ env: {} })

    expect(registerActionTools(registry, handlers, [entry]).ok).toBe(true)
    const duplicate = registerActionTools(registry, handlers, [entry])
    expect(duplicate.ok).toBe(false)
    expect(duplicate.errors[0]).toContain('já registrada')
  })
})
