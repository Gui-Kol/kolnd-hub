import { describe, expect, it } from 'vitest'
import { isAllowedNavigationUrl } from './navigation'

describe('navegação permitida', () => {
  it('em dev permite apenas a origem do renderer', () => {
    expect(isAllowedNavigationUrl('http://localhost:5173/outra', 'http://localhost:5173')).toBe(
      true
    )
    expect(isAllowedNavigationUrl('https://example.com', 'http://localhost:5173')).toBe(false)
    expect(isAllowedNavigationUrl('http://localhost:5174', 'http://localhost:5173')).toBe(false)
  })

  it('em produção bloqueia tudo', () => {
    expect(isAllowedNavigationUrl('file:///C:/Absolem/out/renderer/index.html')).toBe(false)
    expect(isAllowedNavigationUrl('https://example.com', null)).toBe(false)
    expect(isAllowedNavigationUrl('https://example.com', '')).toBe(false)
  })

  it('URL inválida é bloqueada', () => {
    expect(isAllowedNavigationUrl('não-é-url', 'http://localhost:5173')).toBe(false)
    expect(isAllowedNavigationUrl('', 'http://localhost:5173')).toBe(false)
  })
})
