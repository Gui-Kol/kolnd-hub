import { describe, expect, it } from 'vitest'
import { composeSystemMemory, MEMORY_BLOCK_HEADER, MEMORY_NOTE_HEADER } from './format'

describe('memória em texto no prompt', () => {
  it('nota vem antes do bloco recuperado', () => {
    const text = composeSystemMemory(
      'Sempre me chame de Gui.',
      `${MEMORY_BLOCK_HEADER}\n- [memória] Gosta de café`
    )

    expect(text.startsWith(MEMORY_NOTE_HEADER)).toBe(true)
    expect(text).toContain('Sempre me chame de Gui.')
    expect(text.indexOf('Sempre me chame de Gui.')).toBeLessThan(text.indexOf(MEMORY_BLOCK_HEADER))
  })

  it('nota sozinha aparece com a memória automática pausada', () => {
    const text = composeSystemMemory('Trabalho na Kolnd.', '')

    expect(text).toBe(`${MEMORY_NOTE_HEADER}\nTrabalho na Kolnd.`)
  })

  it('nota em branco não gera cabeçalho órfão', () => {
    expect(composeSystemMemory('   ', '')).toBe('')
    expect(composeSystemMemory('   ', MEMORY_BLOCK_HEADER)).toBe(MEMORY_BLOCK_HEADER)
  })
})
