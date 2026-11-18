// Spinner — indicador de progresso indeterminado do Hub (tarefa 2.0/13.6).
//
// Loader2 do lucide com animate-spin; com prefers-reduced-motion a animação é
// desligada (motion-reduce:animate-none) — o ícone continua visível como indicador
// estático, acompanhado do nome acessível.
// role="status" + aria-label (padrão "Carregando").
//
// Uso: <Spinner />  |  <Spinner size={32} label="Salvando…" />
import { Loader2 } from 'lucide-react'

export interface SpinnerProps {
  /** Tamanho do ícone em px. Padrão: 20. */
  size?: number
  /** Nome acessível (o que está acontecendo). Padrão: "Carregando". */
  label?: string
  /** Classes extras (ex.: cor/alinhamento no contexto). */
  className?: string
}

export function Spinner({
  size = 20,
  label = 'Carregando',
  className = ''
}: SpinnerProps): JSX.Element {
  return (
    <span role="status" aria-label={label} className={`inline-flex shrink-0 ${className}`.trim()}>
      <Loader2
        size={size}
        aria-hidden="true"
        className="animate-spin text-ink-secondary motion-reduce:animate-none"
      />
    </span>
  )
}
