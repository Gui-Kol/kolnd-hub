import type { CSSProperties } from 'react'

/**
 * Fallback estático do avatar (task 27).
 *
 * Bola SVG original, desenhada em código, sem arquivo externo e sem animação:
 * entra quando o Canvas2D não existe ou falhou. O desenho usa as cores do tema
 * vigente (`colors.primary` no gradiente, com brilho e aro suaves), então
 * acompanha o preset sem duplicar hex no componente. O gatilho continua sendo a
 * classe `overlay-avatar--fallback` (contrato da task 03) e o desenho é
 * `aria-hidden` porque o rótulo acessível mora na área clicável.
 */
export interface FallbackAvatarColors {
  primary: string
  belly: string
  detail: string
}

type FallbackStyle = CSSProperties & {
  '--avatar-body': string
  '--avatar-belly': string
  '--avatar-detail': string
}

const GRADIENT_ID = 'fallback-avatar-ball-gradient'

export function FallbackAvatar({ colors }: { colors: FallbackAvatarColors }) {
  const style: FallbackStyle = {
    '--avatar-body': colors.primary,
    '--avatar-belly': colors.belly,
    '--avatar-detail': colors.detail,
    color: colors.primary
  }

  return (
    <svg
      className="fallback-avatar"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <defs>
        <radialGradient id={GRADIENT_ID} cx="38%" cy="34%" r="68%">
          <stop offset="0%" stopColor={colors.belly} />
          <stop offset="42%" stopColor={colors.primary} />
          <stop offset="100%" stopColor="#0b1220" stopOpacity="0.82" />
        </radialGradient>
      </defs>
      {/* Halo externo suave, na cor principal do tema. */}
      <circle cx="50" cy="50" r="29" fill={colors.primary} opacity="0.18" />
      {/* Esfera com gradiente radial; diâmetro de 46% do menor lado. */}
      <circle cx="50" cy="50" r="23" fill={`url(#${GRADIENT_ID})`} />
      {/* Aro fino com o detalhe do tema, sem animação. */}
      <circle
        cx="50"
        cy="50"
        r="23"
        fill="none"
        stroke={colors.detail}
        strokeOpacity="0.3"
        strokeWidth="1.2"
      />
    </svg>
  )
}
