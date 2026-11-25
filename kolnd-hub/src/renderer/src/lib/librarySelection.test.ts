import { describe, expect, it } from 'vitest'
import { pruneSelected, toggleSelectAllVisible, toggleSelected } from './librarySelection'

describe('toggleSelected', () => {
  it('marca e desmarca sem mutar o conjunto original', () => {
    const selected = new Set(['a'])
    const added = toggleSelected(selected, 'b')
    expect([...added]).toEqual(['a', 'b'])
    expect(selected).toEqual(new Set(['a']))

    const removed = toggleSelected(added, 'a')
    expect([...removed]).toEqual(['b'])
    expect(added).toEqual(new Set(['a', 'b']))
  })
})

describe('toggleSelectAllVisible', () => {
  it('marca todos os visíveis quando falta algum', () => {
    const selected = new Set(['fora'])
    expect([...toggleSelectAllVisible(selected, ['a', 'b'])]).toEqual(['fora', 'a', 'b'])
  })

  it('desmarca só os visíveis quando todos já estão marcados', () => {
    const selected = new Set(['a', 'b', 'fora'])
    expect([...toggleSelectAllVisible(selected, ['a', 'b'])]).toEqual(['fora'])
  })

  it('marca todos quando só parte dos visíveis está selecionada', () => {
    const selected = new Set(['a'])
    expect([...toggleSelectAllVisible(selected, ['a', 'b', 'c'])]).toEqual(['a', 'b', 'c'])
  })

  it('lista visível vazia não altera a seleção', () => {
    const selected = new Set(['a'])
    expect([...toggleSelectAllVisible(selected, [])]).toEqual(['a'])
  })
})

describe('pruneSelected', () => {
  it('devolve a MESMA instância quando todos os ids existem', () => {
    const selected = new Set(['a', 'b'])
    expect(pruneSelected(selected, ['a', 'b', 'c'])).toBe(selected)
  })

  it('descarta ids que sumiram da biblioteca', () => {
    const selected = new Set(['a', 'b', 'c'])
    expect([...pruneSelected(selected, ['b'])]).toEqual(['b'])
  })

  it('seleção vazia continua sendo a mesma instância', () => {
    const selected = new Set<string>()
    expect(pruneSelected(selected, ['a'])).toBe(selected)
  })
})
