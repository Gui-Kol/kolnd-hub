import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, parseAllowedExternalUrl } from './search'

describe('allowlist de links externos', () => {
  it('aceita apenas http e https', () => {
    expect(isAllowedExternalUrl('https://example.com/noticia')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com/noticia')).toBe(true)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('file:///C:/Windows/win.ini')).toBe(false)
    expect(isAllowedExternalUrl('data:text/html,<script>')).toBe(false)
    expect(isAllowedExternalUrl('mailto:a@b.com')).toBe(false)
  })

  it('recusa credenciais e URL inválida', () => {
    expect(parseAllowedExternalUrl('https://user:pass@example.com/')).toBeNull()
    expect(parseAllowedExternalUrl('não é uma url')).toBeNull()
    expect(parseAllowedExternalUrl('')).toBeNull()
  })

  it('normaliza a URL aceita', () => {
    expect(parseAllowedExternalUrl('  https://example.com/a?b=1  ')).toBe(
      'https://example.com/a?b=1'
    )
  })
})
