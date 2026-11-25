import { describe, expect, it } from 'vitest'
import {
  buildGeneratedIcon,
  escapeXml,
  GENERATED_ICON_LIGHTNESS,
  generatedIconHue,
  generatedIconInitials
} from './iconGenerated'

describe('generatedIconInitials', () => {
  it('usa até 3 iniciais e ignora palavras vazias', () => {
    expect(generatedIconInitials('The Binding of Isaac: Rebirth')).toBe('BIR')
    expect(generatedIconInitials('Minecraft Launcher')).toBe('ML')
    expect(generatedIconInitials('Subnautica 2')).toBe('S2')
    expect(generatedIconInitials('Ação & Aventura')).toBe('AA')
    expect(generatedIconInitials('The')).toBe('T')
    expect(generatedIconInitials('')).toBe('J')
  })
})

describe('generatedIconHue', () => {
  it('é estável por id e fica no intervalo 0–359', () => {
    expect(generatedIconHue('steam-1962700')).toBe(generatedIconHue('steam-1962700'))
    for (const id of ['a', 'steam-1', 'custom-abc', '']) {
      expect(generatedIconHue(id)).toBeGreaterThanOrEqual(0)
      expect(generatedIconHue(id)).toBeLessThan(360)
    }
    expect(generatedIconHue('a')).not.toBe(generatedIconHue('b'))
  })
})

describe('buildGeneratedIcon', () => {
  it('é determinístico para o mesmo id+nome', () => {
    const a = buildGeneratedIcon({ id: 'steam-42', name: 'Jogo Teste' })
    const b = buildGeneratedIcon({ id: 'steam-42', name: 'Jogo Teste' })
    expect(a.buffer.equals(b.buffer)).toBe(true)
    expect(a.ext).toBe('.svg')
    expect(a.mime).toBe('image/svg+xml')
  })

  it('mantém a cor e muda as iniciais quando só o nome muda', () => {
    const a = buildGeneratedIcon({ id: 'steam-42', name: 'Jogo Teste' })
    const b = buildGeneratedIcon({ id: 'steam-42', name: 'Outro Nome' })
    const hue = generatedIconHue('steam-42')
    expect(a.buffer.toString()).toContain(`hsl(${hue}, 62%, ${GENERATED_ICON_LIGHTNESS}%)`)
    expect(b.buffer.toString()).toContain(`hsl(${hue}, 62%, ${GENERATED_ICON_LIGHTNESS}%)`)
    expect(a.buffer.toString()).not.toBe(b.buffer.toString())
  })

  it('gera XML bem formado com SVG 256×256 e texto branco', () => {
    const svg = buildGeneratedIcon({ id: 'x', name: 'Bodycam' }).buffer.toString()
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(svg).toContain('<svg ')
    expect(svg).toContain('width="256"')
    expect(svg).toContain('height="256"')
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('font-family="Segoe UI, sans-serif"')
    expect(svg).toContain('>B</text>')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('escapa caracteres especiais de XML', () => {
    expect(escapeXml(`a&<>"'`)).toBe('a&amp;&lt;&gt;&quot;&apos;')
  })
})
