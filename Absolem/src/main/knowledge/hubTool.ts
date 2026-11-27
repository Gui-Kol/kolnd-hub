import type { ToolEntry } from '../gemini/tools/internal'
import { resolveHubVersion } from '../../shared/version'
import { searchHubKnowledge, type HubKnowledgeTopicBody } from './hubKnowledge'

/**
 * Ferramenta `hub_help` (task 35): detalhe sob demanda da base do Kolnd Hub.
 *
 * O prompt já carrega `buildHubOverview()`; esta ferramenta só devolve as
 * seções que casarem com o tema (no máximo 2) para não inflar a resposta.
 * Sem resultado, devolve o overview e a lista de tópicos disponíveis.
 */

export const HUB_HELP_TOOL_NAME = 'hub_help'
export const HUB_HELP_MAX_SECTIONS = 2
export const HUB_HELP_MAX_SECTION_CHARS = 1_500

export interface HubKnowledgeToolOptions {
  /** Ambiente injetável (teste puro); produção passa `process.env`. */
  readonly env?: { readonly [key: string]: string | undefined }
}

export interface HubHelpResult {
  readonly sections: readonly HubKnowledgeTopicBody[]
  readonly overview: string
  readonly hubVersion: string
  /** Presente somente quando nenhuma seção casou. */
  readonly topics?: ReadonlyArray<{ readonly id: string; readonly title: string }>
}

function fitSections(matched: readonly HubKnowledgeTopicBody[]): HubKnowledgeTopicBody[] {
  const sections: HubKnowledgeTopicBody[] = []
  let used = 0
  for (const section of matched) {
    if (sections.length >= HUB_HELP_MAX_SECTIONS) break
    const remaining = HUB_HELP_MAX_SECTION_CHARS - used
    if (remaining <= 0) break
    const body = section.body.length <= remaining ? section.body : section.body.slice(0, remaining)
    sections.push({ id: section.id, title: section.title, body })
    used += body.length
  }
  return sections
}

export function createHubKnowledgeTool(options: HubKnowledgeToolOptions = {}): ToolEntry {
  return {
    definition: {
      name: HUB_HELP_TOOL_NAME,
      description:
        'Consulta a base de conhecimento do Kolnd Hub (páginas, fluxos, limites e o que é ' +
        'destrutivo) por tema. Use para dúvidas sobre como usar o Hub; devolve no máximo 2 seções.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description:
              'Tema em texto, por exemplo "instalar o Kloud Games", "HUD", "desinstalar" ou "biblioteca".',
            minLength: 1,
            maxLength: 120
          }
        },
        required: ['topic'],
        additionalProperties: false
      },
      sensitive: false,
      category: 'internal',
      timeoutMs: 5_000
    },
    handler: (args): HubHelpResult => {
      const topic = typeof args.topic === 'string' ? args.topic.trim() : ''
      const hubVersion = resolveHubVersion(options.env, 'desconhecida')
      const result = searchHubKnowledge(topic, { limit: HUB_HELP_MAX_SECTIONS })
      const sections = fitSections(result.sections)

      if (sections.length === 0) {
        return {
          sections,
          overview: result.overview,
          hubVersion,
          topics: result.topics
        }
      }
      return { sections, overview: result.overview, hubVersion }
    }
  }
}
