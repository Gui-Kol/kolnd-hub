// Card — primitivo único de superfície elevada do Hub (tarefa 2.0/13.6).
//
// Base: surface-1 + borda sutil + raio --radius-card (12px). Sem glow, sem gradiente.
//   static       — superfície inerte (padrão).
//   interactive  — hover eleva para shadow-elevation-2 + borda --accent-border
//                  (acento sutil). Consumidor decide a semântica (onClick, role, tabIndex).
//
// Uso: <Card variant="interactive" onClick={…} role="button" tabIndex={0}>…</Card>
import { forwardRef } from 'react'
import type { HTMLAttributes, Ref } from 'react'

export type CardVariant = 'static' | 'interactive'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** static (padrão) | interactive (hover com elevação + borda de acento sutil). */
  variant?: CardVariant
}

export const Card = forwardRef(function Card(
  { variant = 'static', className = '', ...rest }: CardProps,
  ref: Ref<HTMLDivElement>
): JSX.Element {
  const classes = [
    'rounded-card border border-[var(--border-subtle)] bg-surface-1',
    variant === 'interactive'
      ? 'transition-all duration-3 ease-standard hover:border-[var(--accent-border)] hover:shadow-elevation-2'
      : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return <div ref={ref} className={classes} {...rest} />
})
