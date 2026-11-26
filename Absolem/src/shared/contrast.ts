import { normalizeHexColor } from './theme'

/**
 * Contraste WCAG entre o avatar e o fundo escuro do overlay.
 *
 * O usuário continua livre para escolher qualquer cor; a UI apenas avisa quando
 * o corpo fica difícil de ver e oferece uma correção assistida que atinge 3:1.
 * O alfa do corpo nunca chega a zero, para o avatar não desaparecer.
 */

export const OVERLAY_BACKGROUND = '#0b0f14'
export const MIN_AVATAR_CONTRAST = 3
export const MIN_BODY_ALPHA = 0.08

export interface RgbColor {
  r: number
  g: number
  b: number
}

function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeHexColor(hex, '#000000')
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16)
  }
}

function rgbToHex({ r, g, b }: RgbColor): string {
  const part = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function channelToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

/** Luminância relativa WCAG (0..1). */
export function relativeLuminance(color: string): number {
  const { r, g, b } = hexToRgb(color)
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

/** Razão de contraste WCAG (1..21). */
export function contrastRatio(colorA: string, colorB: string): number {
  const a = relativeLuminance(colorA)
  const b = relativeLuminance(colorB)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

export function contrastWithOverlay(
  color: string,
  background: string = OVERLAY_BACKGROUND
): number {
  return contrastRatio(color, background)
}

export function hasEnoughContrast(
  color: string,
  background: string = OVERLAY_BACKGROUND,
  minimum: number = MIN_AVATAR_CONTRAST
): boolean {
  return contrastWithOverlay(color, background) >= minimum
}

function mix(color: RgbColor, target: RgbColor, factor: number): RgbColor {
  return {
    r: color.r + (target.r - color.r) * factor,
    g: color.g + (target.g - color.g) * factor,
    b: color.b + (target.b - color.b) * factor
  }
}

/**
 * Correção assistida: mistura a cor para branco (fundo escuro) ou preto (fundo
 * claro) até atingir o contraste mínimo. Busca binária no fator de mistura;
 * devolve a cor original se ela já passa.
 */
export function fixContrast(
  color: string,
  background: string = OVERLAY_BACKGROUND,
  minimum: number = MIN_AVATAR_CONTRAST
): string {
  const normalized = normalizeHexColor(color, '#000000')
  if (hasEnoughContrast(normalized, background, minimum)) return normalized

  const source = hexToRgb(normalized)
  const backgroundLuminance = relativeLuminance(background)
  const target: RgbColor =
    backgroundLuminance < 0.5 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }
  const fallback = rgbToHex(target)

  let low = 0
  let high = 1
  let best = fallback
  for (let step = 0; step < 24; step += 1) {
    const factor = (low + high) / 2
    const candidate = rgbToHex(mix(source, target, factor))
    if (hasEnoughContrast(candidate, background, minimum)) {
      best = candidate
      high = factor
    } else {
      low = factor
    }
  }
  return best
}

/** Alfa do corpo nunca é zero: brilho mínimo ainda desenha o holograma. */
export function clampBodyAlpha(input: number): number {
  const value = Number.isFinite(input) ? input : 0
  return Math.min(1, Math.max(MIN_BODY_ALPHA, value))
}
