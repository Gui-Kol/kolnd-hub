import { describe, expect, it } from 'vitest'
import { nextIconRetryIds } from './libraryIcons'

const games = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('nextIconRetryIds', () => {
  it('devolve só os ids com null ainda não tentados', () => {
    expect(nextIconRetryIds(games, { a: 'data:', b: null, c: null }, new Set(['c']))).toEqual(['b'])
  })

  it('ignora ids sem resposta, com ícone ou com null já tentado', () => {
    expect(nextIconRetryIds(games, { a: 'data:', b: null }, new Set())).toEqual(['b'])
    expect(nextIconRetryIds(games, { a: 'data:', b: null }, new Set(['b']))).toEqual([])
    expect(nextIconRetryIds(games, {}, new Set())).toEqual([])
  })

  it('não duplica ids repetidos e preserva a ordem dos jogos', () => {
    expect(
      nextIconRetryIds([{ id: 'z' }, { id: 'x' }, { id: 'z' }], { z: null, x: null }, new Set())
    ).toEqual(['z', 'x'])
  })
})
