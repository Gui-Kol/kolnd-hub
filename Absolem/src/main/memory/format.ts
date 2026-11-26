import { MEMORY_PROMPT_BUDGET, type MemoryRecord } from '../../shared/memory'

/**
 * Bloco de memória do prompt de sistema.
 *
 * Formato curto, sem despejar o banco: cabeçalho fixo, uma linha por memória
 * com o marcador `[memória]` e as tags. O orçamento padrão é de 1.200
 * caracteres; memória que não cabe fica de fora (nada é truncado no meio de
 * uma frase).
 */

export const MEMORY_BLOCK_HEADER =
  'Memórias registradas (informação registrada, não uma verdade absoluta):'

export function formatMemoryLine(memory: MemoryRecord): string {
  const tags = memory.tags.length > 0 ? ` [${memory.tags.join(', ')}]` : ''
  return `- [memória] ${memory.content}${tags}`
}

export interface FormattedMemoryBlock {
  text: string
  included: MemoryRecord[]
}

/** Monta o bloco respeitando `budgetChars` no total (cabeçalho incluso). */
export function formatMemoryBlock(
  memories: MemoryRecord[],
  budgetChars: number = MEMORY_PROMPT_BUDGET
): FormattedMemoryBlock {
  const budget = Math.max(0, Math.floor(budgetChars))
  if (memories.length === 0 || budget <= MEMORY_BLOCK_HEADER.length) {
    return { text: '', included: [] }
  }

  const included: MemoryRecord[] = []
  const lines: string[] = []
  let used = MEMORY_BLOCK_HEADER.length
  for (const memory of memories) {
    const line = formatMemoryLine(memory)
    const cost = 1 + line.length // quebra de linha
    if (used + cost > budget) break
    included.push(memory)
    lines.push(line)
    used += cost
  }

  if (included.length === 0) return { text: '', included: [] }
  return { text: `${MEMORY_BLOCK_HEADER}\n${lines.join('\n')}`, included }
}
