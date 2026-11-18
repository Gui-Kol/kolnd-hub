// EmptyState — estado vazio único do Hub (tarefa 2.0/13.19).
//
// Vocabulário visual único para "nada aqui ainda": ícone em bloco tonal +
// título + dica opcional + CTA opcional. Substitui os blocos vazios montados
// à mão (Biblioteca, Inicialização, Dashboard, PcUpdates…).
//
// Tom do bloco do ícone: accent (padrão — há uma ação/sugestão a fazer) |
// success ("tudo em dia") | muted (informativo). O CTA fica a cargo do
// chamador (tipicamente um <Button/> como `action`); textos pt-BR são do
// chamador.
//
// Uso: <EmptyState icon={Gamepad2} title="Sua biblioteca está vazia"
//        hint="Clique em Adicionar Games para começar"
//        action={<Button variant="primary" onClick={…}>Adicionar Games</Button>} />
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from './Card'

export type EmptyStateTone = 'accent' | 'success' | 'muted'

export interface EmptyStateProps {
  /** Ícone lucide exibido acima do título. */
  icon: LucideIcon
  /** Título pt-BR (o que está vazio). */
  title: string
  /** Dica/apoio opcional abaixo do título. */
  hint?: ReactNode
  /** CTA opcional (tipicamente um <Button/>). */
  action?: ReactNode
  /** Tom do bloco do ícone. Padrão: 'accent'. */
  tone?: EmptyStateTone
  /** Classes extras do Card (ex.: padding, borda tracejada). */
  className?: string
}

const TONE_CLASSES: Record<EmptyStateTone, string> = {
  accent: 'border-accent-border bg-accent-muted text-accent',
  success: 'border-success-border bg-success-bg text-success',
  muted: 'border-[var(--border-subtle)] bg-surface-2 text-ink-tertiary'
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  tone = 'accent',
  className = ''
}: EmptyStateProps): JSX.Element {
  return (
    <Card className={`flex flex-col items-center gap-4 p-12 text-center ${className}`.trim()}>
      <div
        aria-hidden="true"
        className={`flex h-16 w-16 items-center justify-center rounded-card border ${TONE_CLASSES[tone]}`}
      >
        <Icon size={32} strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-ink-primary">{title}</h3>
      {hint != null && (
        <p className="-mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">{hint}</p>
      )}
      {action != null && <div className="mt-1">{action}</div>}
    </Card>
  )
}
