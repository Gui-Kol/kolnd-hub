import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  RefObject
} from 'react'
import type { OverlayLayout } from '../../../shared/config'

/**
 * Área do avatar (task 22, T1).
 *
 * O frame do overlay e a área do avatar são a mesma coisa: a `BrowserWindow`
 * nasce com o tamanho do layout (240x260 a 480x560) e o canvas ocupa o frame
 * inteiro. A área de clique não é o frame inteiro: ela é uma elipse centrada,
 * documentada em `docs/avatar-appearance.md`, para que o canto vazio da janela
 * continue atravessável (contrato da task 02 e do clique = voz da task 06).
 *
 * A largura/altura vêm do layout retornado pelo main (`overlay:status` e
 * `overlay:set-layout`) como CSS vars; nenhum número do frame é duplicado no
 * CSS do componente.
 */

/** Fração do frame que recebe o clique: cobre o personagem com folga. */
export const AVATAR_HIT_WIDTH_RATIO = 0.86
export const AVATAR_HIT_HEIGHT_RATIO = 0.9

export interface AvatarHitBox {
  width: number
  height: number
}

/** Caixa de clique em px, derivada do frame e sempre menor que ele. */
export function avatarHitBox(layout: OverlayLayout): AvatarHitBox {
  return {
    width: Math.round(layout.width * AVATAR_HIT_WIDTH_RATIO),
    height: Math.round(layout.height * AVATAR_HIT_HEIGHT_RATIO)
  }
}

type AvatarFrameStyle = CSSProperties & {
  '--overlay-width': string
  '--overlay-height': string
  '--overlay-hit-width': string
  '--overlay-hit-height': string
}

/** Vars do frame a partir do layout do main; o CSS só consome as vars. */
export function avatarFrameStyle(layout: OverlayLayout): AvatarFrameStyle {
  const hit = avatarHitBox(layout)
  return {
    width: 'var(--overlay-width)',
    height: 'var(--overlay-height)',
    '--overlay-width': `${layout.width}px`,
    '--overlay-height': `${layout.height}px`,
    '--overlay-hit-width': `${hit.width}px`,
    '--overlay-hit-height': `${hit.height}px`,
    pointerEvents: 'none'
  }
}

export interface AvatarAreaProps {
  layout: OverlayLayout
  canvasRef: RefObject<HTMLCanvasElement>
  /** Contrato da task 03: a classe liga o fallback estático. */
  fallback?: boolean
  /** Silhueta estática; só é montada quando `fallback` é verdadeiro. */
  fallbackAvatar?: ReactNode
  ariaLabel: string
  ariaPressed: boolean
  title?: string
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
}

export function AvatarArea({
  layout,
  canvasRef,
  fallback = false,
  fallbackAvatar,
  ariaLabel,
  ariaPressed,
  title,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onKeyDown
}: AvatarAreaProps) {
  return (
    <div
      className={`overlay-avatar${fallback ? ' overlay-avatar--fallback' : ''}`}
      style={avatarFrameStyle(layout)}
    >
      <canvas
        ref={canvasRef}
        className="overlay-canvas"
        aria-hidden="true"
        style={{ display: fallback ? 'none' : 'block', pointerEvents: 'none' }}
      />
      {fallback ? fallbackAvatar : null}
      <div
        className="overlay-avatar__hit"
        role="button"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        title={title}
        style={{ pointerEvents: 'auto' }}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
