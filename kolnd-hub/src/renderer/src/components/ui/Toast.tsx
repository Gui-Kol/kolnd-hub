// Toast — casca única de aviso global do Hub (tarefa 2.0/13.6).
//
// Kinds: success (Check, acento success) | error (AlertTriangle, danger) | info (Info, acento accent).
// Superfície 3 + borda do tom + shadow-elevation-3; posição fixa no canto inferior direito
// (mesma posição/comportamento do noticeToast do App.tsx).
//
// Comportamento: auto-dismiss configurável via `duration` (padrão 7000 ms; 0 desliga);
// botão fechar com aria-label="Fechar aviso"; role="status" + aria-live="polite".
// Entrada: fade + slide curto (180 ms); desligado com prefers-reduced-motion.
//
// O pai controla a visibilidade condicionalmente ({toast && <Toast …/>}); a saída é
// instantânea (não é motion; AnimatePresence não se aplica).
// Uso: <Toast kind="success" message="Salvo!" onClose={() => setToast(null)} />
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'
import { IconButton } from './IconButton'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastProps {
  /** Tom do aviso. Padrão: info. */
  kind?: ToastKind
  /** Conteúdo do aviso (texto ou nó). */
  message: ReactNode
  /** Chamado no auto-dismiss ou no clique no botão fechar. */
  onClose: () => void
  /** Tempo até o auto-dismiss em ms. Padrão: 7000. 0 desliga o auto-dismiss. */
  duration?: number
  /** Classes extras do container. */
  className?: string
}

const KIND_STYLES: Record<ToastKind, { border: string; icon: typeof Info; iconColor: string }> = {
  success: { border: 'border-success-border', icon: Check, iconColor: 'text-success' },
  error: { border: 'border-danger-border', icon: AlertTriangle, iconColor: 'text-danger' },
  info: { border: 'border-[var(--border-strong)]', icon: Info, iconColor: 'text-accent' }
}

export function Toast({
  kind = 'info',
  message,
  onClose,
  duration = 7000,
  className = ''
}: ToastProps): JSX.Element {
  const [visible, setVisible] = useState(false)
  const { border, icon: Icon, iconColor } = KIND_STYLES[kind]

  // Entrada animada: revela no próximo frame.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return (): void => cancelAnimationFrame(raf)
  }, [])

  // Auto-dismiss (0 = desligado).
  useEffect(() => {
    if (duration <= 0) return undefined
    const timer = setTimeout(onClose, duration)
    return (): void => clearTimeout(timer)
  }, [duration, onClose])

  const classes = [
    'fixed bottom-6 right-6 z-toast flex max-w-md items-start gap-3 rounded-card border',
    'bg-surface-3 px-4 py-3 shadow-elevation-3',
    'transition-all duration-2 ease-standard motion-reduce:transition-none',
    visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
    border,
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div role="status" aria-live="polite" className={classes}>
      <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${iconColor}`} />
      <p className="text-xs leading-relaxed text-ink-primary">{message}</p>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label="Fechar aviso"
        onClick={onClose}
        className="ml-1 shrink-0"
      >
        <X size={13} aria-hidden="true" />
      </IconButton>
    </div>
  )
}
