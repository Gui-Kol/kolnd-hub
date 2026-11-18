// Badge — primitivo único de selo/etiqueta do Hub (tarefa 2.0/13.6).
//
// Discreto por definição: texto + borda 1px + fundo translúcido do mesmo tom (≤ 12%).
// Sem glow, sem gradiente. Conteúdo é livre (children); o tom define só a cor.
//
// Tons: neutral (padrão) | success | warning | danger | accent.
// Uso: <Badge tone="success">Em execução</Badge>
import { forwardRef } from 'react'
import type { HTMLAttributes, Ref } from 'react'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Tom semântico. Padrão: neutral. */
  tone?: BadgeTone
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-white/[0.05] border-[var(--border-subtle)] text-ink-tertiary',
  success: 'bg-success-bg border-success-border text-success',
  warning: 'bg-warn-bg border-warn-border text-warn',
  danger: 'bg-danger-bg border-danger-border text-danger',
  accent: 'bg-accent-muted border-accent-border text-accent'
}

export const Badge = forwardRef(function Badge(
  { tone = 'neutral', className = '', ...rest }: BadgeProps,
  ref: Ref<HTMLSpanElement>
): JSX.Element {
  const classes = [
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2.5 py-0.5',
    'text-[10px] font-bold uppercase tracking-wider',
    TONE_CLASSES[tone],
    className
  ]
    .filter(Boolean)
    .join(' ')

  return <span ref={ref} className={classes} {...rest} />
})
