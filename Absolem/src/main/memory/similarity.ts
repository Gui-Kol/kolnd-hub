/**
 * Similaridade de trigramas usada na deduplicação de memórias.
 *
 * Normaliza caixa, acentos e pontuação antes de comparar; duas memórias com
 * Dice >= 0.85 são tratadas como a mesma informação. A comparação é local,
 * determinística e não usa modelo.
 */

export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function trigramSet(text: string): Set<string> {
  const normalized = `  ${normalizeForCompare(text)}  `
  const grams = new Set<string>()
  for (let index = 0; index + 3 <= normalized.length; index += 1) {
    grams.add(normalized.slice(index, index + 3))
  }
  return grams
}

/** Coeficiente de Dice entre os trigramas das duas strings (0..1). */
export function trigramSimilarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0
  const left = trigramSet(a)
  const right = trigramSet(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const gram of left) {
    if (right.has(gram)) intersection += 1
  }
  return (2 * intersection) / (left.size + right.size)
}

export const DUPLICATE_SIMILARITY = 0.85

/** `true` quando o conteúdo representa a mesma informação de `other`. */
export function isDuplicateContent(content: string, other: string): boolean {
  if (normalizeForCompare(content) === normalizeForCompare(other)) return true
  return trigramSimilarity(content, other) > DUPLICATE_SIMILARITY
}
