import type { ToolDefinition } from '../../../shared/tools'

/** Mantém a primeira definição de cada nome ao compor registros de ferramentas. */
export function deduplicateTools(tools: readonly ToolDefinition[]): ToolDefinition[] {
  const seen = new Set<string>()
  const unique: ToolDefinition[] = []
  for (const tool of tools) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    unique.push(tool)
  }
  return unique
}
