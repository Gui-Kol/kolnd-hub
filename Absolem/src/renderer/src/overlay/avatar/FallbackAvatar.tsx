import type { CSSProperties } from 'react'

/**
 * Fallback estático do avatar (task 22, T4).
 *
 * Silhueta SVG original, desenhada em código, sem arquivo externo e sem
 * animação: entra quando o WebGL não existe ou o contexto foi perdido. As cores
 * vêm do tema vigente por CSS vars (corpo, barriga e detalhes), então o desenho
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
      viewBox="0 0 120 160"
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <g
        stroke="var(--avatar-outline, #0b1220)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* Cauda e segmentos do corpo, do menor ao maior. */}
        <circle cx="20" cy="124" r="9" fill="currentColor" />
        <circle cx="33" cy="128" r="11" fill="currentColor" />
        <circle cx="48" cy="126" r="12" fill="currentColor" />
        <ellipse cx="42" cy="114" rx="27" ry="22" fill="currentColor" />
        {/* Barriga clara, sobreposta ao corpo. */}
        <ellipse
          cx="46"
          cy="118"
          rx="15"
          ry="13"
          fill="var(--avatar-belly, #ade4ef)"
          stroke="none"
        />
        {/* Cabeça e pescoço. */}
        <ellipse cx="62" cy="62" rx="27" ry="25" fill="currentColor" />
        <path d="M46 86 Q62 96 78 86" fill="none" />
        {/* Turbante, listra e nó. */}
        <path
          d="M35 51 Q33 21 61 20 Q89 19 90 49 Q74 39 61 45 Q47 39 35 51 Z"
          fill="currentColor"
        />
        <path
          d="M37 38 Q61 27 88 36"
          fill="none"
          stroke="var(--avatar-detail, #f06292)"
          strokeWidth="5"
        />
        <circle cx="91" cy="42" r="5" fill="var(--avatar-detail, #f06292)" />
        {/* Olho, pupila e brilho. */}
        <ellipse cx="70" cy="62" rx="9" ry="7" fill="var(--avatar-belly, #ade4ef)" />
        <circle cx="71" cy="63" r="3.4" fill="#0b1220" stroke="none" />
        <circle cx="72.4" cy="61.4" r="1.1" fill="#ffffff" stroke="none" />
        <path d="M60 50 Q70 46 80 51" fill="none" />
        {/* Boca e cachimbo. */}
        <path d="M62 75 Q70 79 78 74" fill="none" />
        <path
          d="M79 76 Q95 78 99 90"
          fill="none"
          stroke="var(--avatar-detail, #f06292)"
          strokeWidth="3.2"
        />
        <ellipse cx="101" cy="94" rx="6" ry="4.6" fill="var(--avatar-detail, #f06292)" />
      </g>
    </svg>
  )
}
