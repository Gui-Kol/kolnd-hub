import type { ThemeConfig } from '../../../../shared/theme'

/**
 * Adaptador tema -> bola.
 *
 * É o único módulo do avatar que interpreta campos do `ThemeConfig`. Na bola só
 * dois campos têm efeito: a escala do tema (0.8..1.5) e o movimento reduzido.
 * Cores, estilo, roupa, acessórios, acabamento e partículas continuam tipados no
 * contrato, mas são apenas compatibilidade de dados — não entram na geometria.
 */
export interface BallThemeParams {
  scale: number
  reducedMotion: boolean
}

const BALL_SCALE_MIN = 0.8
const BALL_SCALE_MAX = 1.5
const BALL_SCALE_DEFAULT = 1

/** Escala do tema limitada à faixa do schema; valor inválido cai em 1. */
export function clampBallScale(value: number): number {
  if (!Number.isFinite(value)) return BALL_SCALE_DEFAULT
  return Math.min(BALL_SCALE_MAX, Math.max(BALL_SCALE_MIN, value))
}

/** Tradução pura; a mesma entrada sempre produz os mesmos parâmetros. */
export function toBallTheme(theme: ThemeConfig): BallThemeParams {
  return {
    scale: clampBallScale(theme.scale),
    reducedMotion: theme.reducedMotion === true
  }
}
