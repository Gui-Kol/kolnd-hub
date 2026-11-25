import { createHash } from 'crypto'
import type { StoredGame } from '../store'

/**
 * Fallback garantido: gera um SVG 256×256 determinístico com as iniciais do
 * jogo e uma cor derivada do SHA-256 do `id`. É o último recurso da cascata —
 * com ele o card nunca fica sem imagem, mesmo offline e sem arte local.
 *
 * Módulo puro (sem `electron`, sem rede), testável como unidade.
 */

/** Luminosidade fixa: escura o bastante para contraste AA com texto branco. */
export const GENERATED_ICON_LIGHTNESS = 26
/** Saturação da cor de fundo. */
export const GENERATED_ICON_SATURATION = 62

/** Palavras ignoradas ao montar as iniciais ("The Binding…" → "B…"). */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'e',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'em',
  'para'
])

export interface GeneratedIcon {
  buffer: Buffer
  ext: '.svg'
  mime: 'image/svg+xml'
}

/** Remove acentos e caracteres especiais para montar as iniciais. */
function wordsOf(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Iniciais do nome (até 3 letras), sem acento e ignorando palavras vazias.
 * Sem nenhuma palavra útil, usa a primeira letra do próprio nome ou "J".
 */
export function generatedIconInitials(name: string): string {
  const initials = wordsOf(name)
    .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 3)
    .map((word) => word.charAt(0).toUpperCase())
    .join('')
  if (initials) return initials
  const fallback = wordsOf(name)[0]?.charAt(0).toUpperCase()
  return fallback || 'J'
}

/** Matiz (0–359) derivado do SHA-256 do id — estável entre execuções. */
export function generatedIconHue(id: string): number {
  const digest = createHash('sha256').update(id).digest()
  return ((digest[0] << 8) | digest[1]) % 360
}

/** Escapa texto para conteúdo/atributo XML. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * SVG determinístico do fallback. Mesmo `id`+`name` → exatamente os mesmos
 * bytes; nomes diferentes com o mesmo id mantêm a cor e mudam as iniciais.
 */
export function buildGeneratedIcon(game: Pick<StoredGame, 'id' | 'name'>): GeneratedIcon {
  const hue = generatedIconHue(game.id)
  const initials = escapeXml(generatedIconInitials(game.name))
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="${initials}">
  <rect width="256" height="256" rx="36" fill="hsl(${hue}, ${GENERATED_ICON_SATURATION}%, ${GENERATED_ICON_LIGHTNESS}%)"/>
  <text x="128" y="128" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="96" font-weight="600" text-anchor="middle" dominant-baseline="central">${initials}</text>
</svg>
`
  return { buffer: Buffer.from(svg, 'utf8'), ext: '.svg', mime: 'image/svg+xml' }
}
