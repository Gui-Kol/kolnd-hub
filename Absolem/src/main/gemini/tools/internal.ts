import type { ToolDefinition } from '../../../shared/tools'
import { createToolRegistry, type ToolRegistry } from './registry'

/**
 * Ferramentas internas de teste do motor.
 *
 * `get_current_time` é a ferramenta não sensível de referência;
 * `echo` só é registrada quando `includeEcho` é ligado (desenvolvimento/teste).
 * Ferramentas reais de tela, arquivos, processos, memória e pesquisa pertencem
 * às tasks 07 a 10.
 */

/** Contexto de execução: o roteador aborta quando a ferramenta estoura o tempo. */
export interface ToolHandlerContext {
  signal: AbortSignal
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: ToolHandlerContext
) => Promise<unknown> | unknown

export interface ToolEntry {
  definition: ToolDefinition
  handler: ToolHandler
}

export interface InternalToolOptions {
  now?: () => Date
  includeEcho?: boolean
}

export function createInternalTools(options: InternalToolOptions = {}): ToolEntry[] {
  const now = options.now ?? (() => new Date())

  const entries: ToolEntry[] = [
    {
      definition: {
        name: 'get_current_time',
        description: 'Devolve a data e hora atuais em ISO 8601, opcionalmente num fuso IANA.',
        parameters: {
          type: 'object',
          properties: {
            timezone: {
              type: 'string',
              description: 'Fuso IANA, por exemplo America/Sao_Paulo.',
              maxLength: 64
            }
          },
          required: [],
          additionalProperties: false
        },
        sensitive: false,
        category: 'internal',
        timeoutMs: 2_000
      },
      handler: (args) => {
        const timezone = typeof args.timezone === 'string' ? args.timezone : undefined
        const instant = now()
        if (!timezone) return { iso: instant.toISOString(), timezone: 'UTC' }
        // Fuso inválido lança RangeError; o roteador devolve erro estruturado.
        const formatted = new Intl.DateTimeFormat('sv-SE', {
          timeZone: timezone,
          dateStyle: 'short',
          timeStyle: 'medium'
        }).format(instant)
        return { iso: instant.toISOString(), timezone, local: formatted }
      }
    }
  ]

  if (options.includeEcho) {
    entries.push({
      definition: {
        name: 'echo',
        description: 'Repete o texto recebido. Ferramenta de teste do motor.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Texto a repetir.', maxLength: 2_000 }
          },
          required: ['text'],
          additionalProperties: false
        },
        sensitive: false,
        category: 'internal',
        timeoutMs: 1_000
      },
      handler: (args) => ({ echoed: String(args.text ?? '') })
    })
  }

  return entries
}

/** Registro com as ferramentas internas; `echo` apenas quando pedido. */
export function createDefaultToolRegistry(options: InternalToolOptions = {}): {
  registry: ToolRegistry
  handlers: Map<string, ToolHandler>
} {
  const registry = createToolRegistry()
  const handlers = new Map<string, ToolHandler>()
  for (const entry of createInternalTools(options)) {
    const result = registry.registerTool(entry.definition)
    if (!result.ok) throw new Error(result.error ?? 'falha ao registrar ferramenta interna')
    handlers.set(entry.definition.name, entry.handler)
  }
  return { registry, handlers }
}
