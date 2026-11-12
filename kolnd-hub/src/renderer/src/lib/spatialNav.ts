// Navegação espacial 2-D (Big Picture) — calcula o focável mais próximo em
// uma direção. Pura e testável; quem chama (o contexto de foco) decide *quando*
// computar os rects (apenas na pressão da direção — nunca a cada frame).

export type SpatialDirection = 'up' | 'down' | 'left' | 'right'

export interface SpatialCandidate {
  id: string
  rect: DOMRect
}

interface Center {
  x: number
  y: number
}

const DIRECTION_VECTORS: Record<SpatialDirection, Center> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
}

function centerOf(rect: DOMRect): Center {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 }
}

// Diferença máxima de pontuação para considerar "empate" e desempatar
// pelo alinhamento do eixo perpendicular (a direção contrária ao eixo principal).
const SCORE_EPSILON = 0.5

/**
 * Retorna o `id` do candidato no semiplano da direção com menor
 * `distância × (1 + ânguloDesvio)` — ou `null` quando não há candidato.
 *
 * - Semiplano: `left`/`right` exigem avançar no eixo X; `up`/`down`, no eixo Y.
 * - `ânguloDesvio` = ângulo entre o vetor da direção e o vetor até o candidato
 *   (0 = perfeitamente alinhado).
 * - Empate (diferença de pontuação ≤ 0,5): vence o mais alinhado no eixo
 *   perpendicular (deslocamento perpendicular menor).
 * - Candidatos sobrepostos (distância < 1 px) são ignorados.
 */
export function nearestInDirection(
  from: DOMRect,
  candidates: SpatialCandidate[],
  dir: SpatialDirection
): string | null {
  const fromCenter = centerOf(from)
  const direction = DIRECTION_VECTORS[dir]
  const horizontal = dir === 'left' || dir === 'right'

  let bestId: string | null = null
  let bestScore = Infinity
  let bestPerpendicular = Infinity

  for (const candidate of candidates) {
    const center = centerOf(candidate.rect)
    const dx = center.x - fromCenter.x
    const dy = center.y - fromCenter.y

    // Semiplano da direção.
    if (horizontal) {
      if (dir === 'right' ? dx <= 0 : dx >= 0) continue
    } else {
      if (dir === 'down' ? dy <= 0 : dy >= 0) continue
    }

    const distance = Math.hypot(dx, dy)
    if (distance < 1) continue

    const dot = dx * direction.x + dy * direction.y
    const cosine = Math.min(1, Math.max(-1, dot / distance))
    const angle = Math.acos(cosine)
    const score = distance * (1 + angle)
    const perpendicular = Math.abs(horizontal ? dy : dx)

    if (
      score < bestScore - SCORE_EPSILON ||
      (Math.abs(score - bestScore) <= SCORE_EPSILON && perpendicular < bestPerpendicular)
    ) {
      bestId = candidate.id
      bestScore = score
      bestPerpendicular = perpendicular
    }
  }

  return bestId
}
