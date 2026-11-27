import { Color } from 'three'
import { clampBodyAlpha } from '../../../../shared/contrast'
import type {
  ParticleDensity,
  ThemeAccessory,
  ThemeConfig,
  ThemeOutfit,
  ThemeStyle
} from '../../../../shared/theme'
import { resolveAvatarLook } from './looks'
import type { AvatarLook } from './looks'
import { clampOutlineStrength } from './outline'

/**
 * Adaptador tema -> parâmetros do avatar.
 *
 * É o único módulo que interpreta os campos do `ThemeConfig`: traduz cores para
 * linear RGB (o espaço de trabalho do `three`), estilo para flags de geometria,
 * roupa/acessórios para peças montadas, densidade para contagem de partículas e
 * escala para o grupo raiz.
 *
 * O estado do avatar (`AvatarState`, expressões, lip-sync) NÃO entra aqui:
 * tema e estado são ortogonais. Por isso a função recebe só o tema.
 */

/** Contagem máxima por densidade; a degradação da cena ainda pode reduzir. */
export const PARTICLE_COUNT_BY_DENSITY: Record<ParticleDensity, number> = {
  off: 0,
  low: 120,
  medium: 180,
  high: 240
}

export { MIN_BODY_ALPHA, clampBodyAlpha } from '../../../../shared/contrast'

/** Cor em linear RGB (espaço de trabalho do three) mais o hex original. */
export interface AvatarLinearColor {
  r: number
  g: number
  b: number
  hex: string
}

export interface AvatarGeometryParams {
  wireframe: boolean
  /** Preenchimento do corpo; desligado no estilo wireframe. */
  fill: boolean
  /** Segmentos radiais das esferas (custo de malha). */
  radialSegments: number
  /** Segmentos ao longo do corpo; menor no wireframe. */
  bodySegments: number
}

export interface AvatarParticlesParams {
  density: ParticleDensity
  /** 0 desliga as partículas por completo. */
  count: number
}

export interface AvatarMaterialParams {
  /** Piso de alfa: brilho 0 nunca apaga o corpo por completo. */
  bodyAlpha: number
  hologramIntensity: number
  noise: number
}

export interface AvatarParams {
  primary: AvatarLinearColor
  effect: AvatarLinearColor
  belly: AvatarLinearColor
  detail: AvatarLinearColor
  shadow: AvatarLinearColor
  debugColor: AvatarLinearColor
  glowIntensity: number
  outlineStrength: number
  look: AvatarLook
  style: ThemeStyle
  outfit: ThemeOutfit
  accessories: ThemeAccessory[]
  particles: AvatarParticlesParams
  scale: number
  reducedMotion: boolean
  geometry: AvatarGeometryParams
  materials: AvatarMaterialParams
}

/** `three` converte o hex sRGB para o espaço linear ao construir a `Color`. */
function linearColor(hex: string): AvatarLinearColor {
  const color = new Color(hex)
  return { r: color.r, g: color.g, b: color.b, hex }
}

/** Tradução pura; a mesma entrada sempre produz os mesmos parâmetros. */
export function toAvatarParams(theme: ThemeConfig): AvatarParams {
  const wireframe = theme.style === 'wireframe'
  const glow = Math.min(1, Math.max(0, theme.glowIntensity))

  return {
    primary: linearColor(theme.primaryColor),
    effect: linearColor(theme.effectColor),
    belly: linearColor(theme.bellyColor),
    detail: linearColor(theme.detailColor),
    // Buracos (pupila/boca) e o HUD de debug não vêm do tema; ficam no
    // adaptador para o código de comportamento não guardar cor literal.
    shadow: linearColor('#0b1220'),
    debugColor: linearColor('#93c5fd'),
    glowIntensity: glow,
    outlineStrength: clampOutlineStrength(theme.outlineStrength),
    look: resolveAvatarLook(theme.look),
    style: theme.style,
    outfit: theme.outfit,
    accessories: [...theme.accessories],
    particles: {
      density: theme.particleDensity,
      count: PARTICLE_COUNT_BY_DENSITY[theme.particleDensity]
    },
    scale: theme.scale,
    reducedMotion: theme.reducedMotion,
    geometry: {
      wireframe,
      fill: !wireframe,
      radialSegments: wireframe ? 10 : 14,
      bodySegments: wireframe ? 8 : 10
    },
    materials: {
      bodyAlpha: clampBodyAlpha(0.35 + glow * 0.45),
      hologramIntensity: clampBodyAlpha(glow),
      noise: wireframe ? 0.08 : 0.3
    }
  }
}
