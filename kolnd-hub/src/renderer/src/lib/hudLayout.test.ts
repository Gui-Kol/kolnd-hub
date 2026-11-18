import { describe, expect, it } from 'vitest'
import { HUD_TWO_COLUMN_MIN_WIDTH, hudColumnCount } from './hudLayout'

// A largura do HUD é livre (180–560) e chega por push; o número de colunas
// precisa ser uma função pura dela para o layout nunca depender de medição.
describe('hudColumnCount', () => {
  it('usa 1 coluna abaixo de 300 px (180–290)', () => {
    expect(hudColumnCount(180)).toBe(1)
    expect(hudColumnCount(290)).toBe(1)
    expect(hudColumnCount(HUD_TWO_COLUMN_MIN_WIDTH - 1)).toBe(1)
  })

  it('usa 2 colunas a partir de 300 px (inclui o padrão 300)', () => {
    expect(hudColumnCount(300)).toBe(2)
    expect(hudColumnCount(330)).toBe(2)
    expect(hudColumnCount(340)).toBe(2)
    expect(hudColumnCount(420)).toBe(2)
    expect(hudColumnCount(560)).toBe(2)
  })

  it('entrada inválida cai em 1 coluna (nunca estoura a janela)', () => {
    expect(hudColumnCount(Number.NaN)).toBe(1)
    expect(hudColumnCount(Number.POSITIVE_INFINITY)).toBe(1)
    expect(hudColumnCount(Number.NEGATIVE_INFINITY)).toBe(1)
    expect(hudColumnCount(undefined as unknown as number)).toBe(1)
    expect(hudColumnCount('420' as unknown as number)).toBe(1)
    expect(hudColumnCount(null as unknown as number)).toBe(1)
  })
})
