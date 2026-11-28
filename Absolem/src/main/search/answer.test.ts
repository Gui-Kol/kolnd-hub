import { describe, expect, it } from 'vitest'
import {
  NO_SOURCES_WARNING,
  SOURCES_HEADER,
  buildSourcesBlock,
  composeWebAnswer,
  sanitizeCitationIndices,
  sanitizeSources
} from './answer'

const sources = [
  { title: 'Notícia A', url: 'https://a.example/noticia' },
  { title: 'Artigo B', url: 'https://b.example/artigo#secao' }
]

describe('resposta com fontes', () => {
  it('coloca o bloco numerado no fim', () => {
    const result = composeWebAnswer('Os satélites ficam em órbita [1][2].', { sources })

    expect(result.text.startsWith('Os satélites')).toBe(true)
    expect(result.text).toContain(
      `\n\n${SOURCES_HEADER}\n[1] Notícia A - https://a.example/noticia`
    )
    expect(result.text).toContain('[2] Artigo B - https://b.example/artigo')
    expect(result.text.trimEnd().endsWith('https://b.example/artigo')).toBe(true)
  })

  it('remove ou corrige número fora da lista', () => {
    expect(sanitizeCitationIndices('Fato [1] e outro [9].', 2)).toBe('Fato [1] e outro.')
    expect(sanitizeCitationIndices('Dois fatos [1,9] e [0].', 2)).toBe('Dois fatos [1] e.')
    expect(sanitizeCitationIndices('Nenhuma fonte [3].', 0)).toBe('Nenhuma fonte.')

    const result = composeWebAnswer('Fato [1] com fonte inventada [7].', { sources })
    expect(result.text).toContain('Fato [1] com fonte inventada.')
    expect(result.text).not.toContain('[7]')
  })

  it('sem fonte mostra aviso em vez de inventar', () => {
    const result = composeWebAnswer('Resposta sem metadata.', { sources: [], noSources: true })

    expect(result.sources).toEqual([])
    expect(result.text).toContain(NO_SOURCES_WARNING)
    expect(result.text).not.toContain(SOURCES_HEADER)
  })

  it('descarta links que não sejam http/https', () => {
    const mixed = [
      { title: 'Boa', url: 'https://ok.example/pagina' },
      { title: 'Ruim', url: 'javascript:alert(1)' },
      { title: 'Arquivo', url: 'file:///C:/segredo.txt' }
    ]
    const valid = sanitizeSources(mixed)
    expect(valid).toEqual([{ title: 'Boa', url: 'https://ok.example/pagina' }])

    const block = buildSourcesBlock(mixed)
    expect(block).toContain('https://ok.example/pagina')
    expect(block).not.toContain('javascript:')
    expect(block).not.toContain('file:')
  })

  it('prefixa avisos antes da resposta', () => {
    const result = composeWebAnswer('Texto.', {
      sources,
      warnings: ['Aviso de injeção.', 'Aviso de página dinâmica.']
    })
    expect(result.text.indexOf('Aviso de injeção.')).toBeLessThan(result.text.indexOf('Texto.'))
    expect(result.text).toContain('Aviso de página dinâmica.')
  })
})
