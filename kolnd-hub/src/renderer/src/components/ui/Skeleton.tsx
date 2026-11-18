// Skeleton — placeholder de carregamento do Hub (tarefa 2.0/13.6).
//
// Shimmer SUTIL (gradiente frio superfície 2 → 3 sobre tokens), nunca animate-pulse
// chapado. O keyframe `skeleton-shimmer` vive em index.css e é desligado com
// prefers-reduced-motion (ver bloco "13.6 — Skeleton shimmer").
// Decorativo por definição: aria-hidden — quem anuncia carregamento é o estado
// da tela (ex.: Spinner com role="status"), não o placeholder.
//
// Dimensione via className (w/h) — o componente não impõe tamanho.
// Uso: <Skeleton className="h-4 w-40" />  |  <Skeleton rounded="pill" className="h-6 w-24" />
import { forwardRef } from 'react'
import type { HTMLAttributes, Ref } from 'react'

export type SkeletonRounded = 'sm' | 'control' | 'card' | 'pill'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Raio do placeholder. Padrão: card (12px). */
  rounded?: SkeletonRounded
}

const ROUNDED_CLASSES: Record<SkeletonRounded, string> = {
  sm: 'rounded-sm',
  control: 'rounded-control',
  card: 'rounded-card',
  pill: 'rounded-pill'
}

export const Skeleton = forwardRef(function Skeleton(
  { rounded = 'card', className = '', ...rest }: SkeletonProps,
  ref: Ref<HTMLDivElement>
): JSX.Element {
  const classes = ['skeleton-shimmer', ROUNDED_CLASSES[rounded], className]
    .filter(Boolean)
    .join(' ')

  return <div ref={ref} aria-hidden="true" className={classes} {...rest} />
})
