import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MAX_EXTRACT_CHARS, TRUNCATION_MARKER, extractReadable } from './extract'

function fixture(name: string): string {
  return readFileSync(new URL(`../../../tests/fixtures/html/${name}`, import.meta.url), 'utf8')
}

describe('extração de conteúdo legível', () => {
  it('remove script, style, noscript, svg, iframe e form', () => {
    const page = extractReadable(fixture('scripts.html'))

    expect(page.text).toContain('Conteúdo visível')
    expect(page.text).toContain('Este parágrafo é o conteúdo real da página.')
    for (const hidden of [
      'TOKEN_DO_SCRIPT_NAO_DEVE_APARECER',
      'ATIVAR_JAVASCRIPT_NAO_DEVE_APARECER',
      'SENHA_DO_FORMULARIO',
      'SVG_NAO_DEVE_APARECER',
      'IFRAME_NAO_DEVE_APARECER',
      'background: #000'
    ]) {
      expect(page.text).not.toContain(hidden)
    }
  })

  it('prefere article ao body (menu e rodapé ficam fora)', () => {
    const page = extractReadable(fixture('article.html'), 'https://example.test/satelites')

    expect(page.title).toBe('Artigo sobre satélites')
    expect(page.text).toContain('Como os satélites ficam em órbita')
    expect(page.text).toContain('velocidade lateral equilibra')
    expect(page.text).not.toContain('Links patrocinados')
    expect(page.text).not.toContain('Rodapé do site')
    expect(page.text).not.toContain('Início | Notícias')
  })

  it('preserva título, títulos internos e parágrafos', () => {
    const page = extractReadable(fixture('title.html'))

    expect(page.title).toBe('Título do documento')
    expect(page.text).toContain('Título principal')
    expect(page.text).toContain('Primeiro parágrafo')
    expect(page.text).toContain('Terceiro parágrafo')
    expect(page.text).toContain(
      'Primeiro parágrafo com texto suficiente para ser preservado.\n\nSegundo'
    )
    expect(page.truncated).toBe(false)
  })

  it('corta em 8.000 caracteres com marcador de truncamento', () => {
    const page = extractReadable(fixture('long.html'))

    expect(page.truncated).toBe(true)
    expect(page.text.length).toBeLessThanOrEqual(MAX_EXTRACT_CHARS)
    expect(page.text.endsWith(TRUNCATION_MARKER)).toBe(true)
    expect(page.chars).toBe(page.text.length)
  })
})
