import { describe, expect, it } from 'vitest'
import { nearestInDirection, type SpatialCandidate } from './spatialNav'

// DOMRect em ambiente node: literais cobrindo todos os campos de DOMRect.
function rect(x: number, y: number, w = 100, h = 50): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    toJSON: (): Record<string, never> => ({})
  } as DOMRect
}

function candidate(id: string, x: number, y: number, w?: number, h?: number): SpatialCandidate {
  return { id, rect: rect(x, y, w, h) }
}

// Grade 3×3 com células de 100×50 separadas por 20 px de gap.
const GRID = [
  candidate('a', 0, 0),
  candidate('b', 120, 0),
  candidate('c', 240, 0),
  candidate('d', 0, 70),
  candidate('e', 120, 70),
  candidate('f', 240, 70),
  candidate('g', 0, 140),
  candidate('h', 120, 140),
  candidate('i', 240, 140)
]
const CENTER_E = GRID[4]!.rect
const ALL_BUT_E = GRID.filter((c) => c.id !== 'e')

describe('nearestInDirection — grade 3×3', () => {
  it('a partir do centro navega para as 4 direções', () => {
    expect(nearestInDirection(CENTER_E, ALL_BUT_E, 'left')).toBe('d')
    expect(nearestInDirection(CENTER_E, ALL_BUT_E, 'right')).toBe('f')
    expect(nearestInDirection(CENTER_E, ALL_BUT_E, 'up')).toBe('b')
    expect(nearestInDirection(CENTER_E, ALL_BUT_E, 'down')).toBe('h')
  })

  it('a partir de um canto só há candidatos para dentro', () => {
    const from = GRID[0]!.rect // 'a'
    const rest = GRID.filter((c) => c.id !== 'a')
    expect(nearestInDirection(from, rest, 'right')).toBe('b')
    expect(nearestInDirection(from, rest, 'down')).toBe('d')
    expect(nearestInDirection(from, rest, 'left')).toBeNull()
    expect(nearestInDirection(from, rest, 'up')).toBeNull()
  })

  it('a partir do canto oposto (i) idem', () => {
    const from = GRID[8]!.rect // 'i'
    const rest = GRID.filter((c) => c.id !== 'i')
    expect(nearestInDirection(from, rest, 'left')).toBe('h')
    expect(nearestInDirection(from, rest, 'up')).toBe('f')
    expect(nearestInDirection(from, rest, 'right')).toBeNull()
    expect(nearestInDirection(from, rest, 'down')).toBeNull()
  })

  it('bordas intermediárias: topo (b) sobe → null, desce → centro (e)', () => {
    const from = GRID[1]!.rect // 'b'
    const rest = GRID.filter((c) => c.id !== 'b')
    expect(nearestInDirection(from, rest, 'up')).toBeNull()
    expect(nearestInDirection(from, rest, 'down')).toBe('e')
    // Horizontal a partir de (b): 'a' e 'c' estão no mesmo eixo — a linha
    // reta alinhada vence o diagonal adjacente.
    expect(nearestInDirection(from, rest, 'left')).toBe('a')
    expect(nearestInDirection(from, rest, 'right')).toBe('c')
  })
})

describe('nearestInDirection — semiplano e bordas', () => {
  it('retorna null quando não há candidato no semiplano', () => {
    const from = rect(0, 0, 100, 50)
    const onlyRight = [candidate('x', 400, 0), candidate('y', 600, 80)]
    expect(nearestInDirection(from, onlyRight, 'left')).toBeNull()
  })

  it('candidato na mesma linha não vale para up/down (dy === 0 é excluído)', () => {
    const from = rect(0, 0, 100, 50) // centro y = 25
    const sameRow = [candidate('x', 200, 0)] // centro y = 25
    expect(nearestInDirection(from, sameRow, 'up')).toBeNull()
    expect(nearestInDirection(from, sameRow, 'down')).toBeNull()
    expect(nearestInDirection(from, sameRow, 'right')).toBe('x')
  })

  it('lista vazia de candidatos → null', () => {
    expect(nearestInDirection(rect(0, 0), [], 'right')).toBeNull()
  })

  it('candidato sobreposto (distância < 1 px) é ignorado', () => {
    const from = rect(0, 0, 100, 50)
    const overlapping = [{ id: 'same', rect: rect(0, 0, 100, 50) }]
    expect(nearestInDirection(from, overlapping, 'right')).toBeNull()
  })
})

describe('nearestInDirection — desempate pelo eixo perpendicular', () => {
  // A partir de (0,0,100,50), centro (50,25). O candidato diagonal anda 100 px
  // no eixo e 50 px perpendicular; o "quase alinhado" anda ~153,5 px no eixo com
  // apenas 10 px perpendicular. Os scores ficam dentro de 0,5 px — o alinhado vence.
  const from = rect(0, 0, 100, 50)
  const diagonal = candidate('diagonal', 100, 50) // centro (150, 75): dx 100, dy 50
  const aligned = candidate('aligned', 153.5, 10) // centro (203.5, 35): dx 153.5, dy 10

  it('empate (score dentro de ε) resolve pelo eixo perpendicular mais alinhado', () => {
    expect(nearestInDirection(from, [diagonal, aligned], 'right')).toBe('aligned')
    // Sem interferência, o diagonal venceria o score por uma margem mínima.
    // A regra de empate inverte o resultado para o candidato alinhado.
  })

  it('alinhado próximo vence o diagonal com folga (score claramente menor)', () => {
    const nearAligned = candidate('near', 140, 20) // centro (190,45): dx 140, dy 20 — bem alinhado
    expect(nearestInDirection(from, [diagonal, nearAligned], 'right')).toBe('near')
  })

  it('empate simétrico (perp igual) não quebra: retorna um candidato determinístico', () => {
    const from = rect(0, 0, 100, 50) // centro y = 25
    // Simétricos exatos em relação ao eixo X (centro y = -30 e 80 → dy = -55 e +55).
    const symUp = candidate('sym-up', 200, -55) // centro y = -30
    const symDown = candidate('sym-down', 200, 55) // centro y = 80
    const result = nearestInDirection(from, [symUp, symDown], 'right')
    expect(result === 'sym-up' || result === 'sym-down').toBe(true)
  })
})
