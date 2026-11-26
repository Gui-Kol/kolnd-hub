import {
  validateArguments,
  validateToolDefinition,
  type ArgumentValidation,
  type ToolDefinition
} from '../../../shared/tools'

/**
 * Registro de ferramentas: descreve e valida, não executa nada.
 *
 * Regras:
 * - nome duplicado é rejeitado;
 * - definição com schema fora do subset suportado é rejeitada (nunca valida
 *   pela metade);
 * - `listTools`/`getTool` devolvem cópia imutável: ninguém altera o registro
 *   por referência.
 */

export interface RegisterResult {
  ok: boolean
  error?: string
}

export interface ToolRegistry {
  registerTool: (definition: ToolDefinition) => RegisterResult
  listTools: () => readonly ToolDefinition[]
  getTool: (name: string) => ToolDefinition | null
  validateArguments: (name: string, args: unknown) => ArgumentValidation
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>()

  return {
    registerTool(definition: ToolDefinition): RegisterResult {
      const errors = validateToolDefinition(definition)
      if (errors.length > 0) return { ok: false, error: errors.join('; ') }
      if (tools.has(definition.name)) {
        return { ok: false, error: `ferramenta já registrada: ${definition.name}` }
      }
      const stored = deepFreeze(clone(definition))
      tools.set(stored.name, stored)
      return { ok: true }
    },

    listTools(): readonly ToolDefinition[] {
      return Object.freeze([...tools.values()].map((tool) => deepFreeze(clone(tool))))
    },

    getTool(name: string): ToolDefinition | null {
      const tool = tools.get(name)
      return tool ? deepFreeze(clone(tool)) : null
    },

    validateArguments(name: string, args: unknown): ArgumentValidation {
      const tool = tools.get(name)
      if (!tool) return { ok: false, errors: [`ferramenta desconhecida: ${name}`] }
      return validateArguments(tool.parameters, args)
    }
  }
}
