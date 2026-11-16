import { describe, it, expect } from 'vitest'
import { findMissingGameIds } from './games'

const games = (...ids: string[]): Array<{ id: string }> => ids.map((id) => ({ id }))

describe('findMissingGameIds', () => {
  it('retorna Set vazio sem jogos', () => {
    expect(findMissingGameIds([], [])).toEqual(new Set())
  })

  it('marca apenas os ids cujo flag é exatamente false', () => {
    const missing = findMissingGameIds(games('a', 'b', 'c'), [true, false, true])
    expect(missing).toEqual(new Set(['b']))
  })

  it('trata flags mais curtas que a lista como "existe"', () => {
    const missing = findMissingGameIds(games('a', 'b', 'c'), [false])
    expect(missing).toEqual(new Set(['a']))
  })

  it('trata flag true como existente', () => {
    expect(findMissingGameIds(games('a'), [true])).toEqual(new Set())
  })

  it('marca vários ausentes preservando os ids corretos', () => {
    const missing = findMissingGameIds(games('a', 'b', 'c', 'd'), [false, true, false, false])
    expect(missing).toEqual(new Set(['a', 'c', 'd']))
  })
})
