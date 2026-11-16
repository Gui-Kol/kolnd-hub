// Input — primitivo único de campo de texto do Hub (tarefa 2.0/13.6).
//
// Base única tokenizada (substitui .input-gamer): fundo sunken, borda sutil,
// texto primary, placeholder tertiary; foco com borda --accent-border (o anel
// de 2px --focus-ring vem do :focus-visible global em index.css).
//
// Props extras sobre o <input> nativo:
//   icon          — ícone lucide à esquerda (ex.: Search); campo ganha padding à esquerda.
//   error         — estado de erro: borda danger.
//   errorMessage  — mensagem abaixo do campo (implica error); liga aria-invalid e
//                   aria-describedby automaticamente.
//   disabled      — opacity 50%, cursor not-allowed.
//
// Uso: <Input placeholder="Nome" error={!!msg} errorMessage={msg} />
import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle } from 'lucide-react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Ícone lucide renderizado à esquerda do campo. */
  icon?: LucideIcon
  /** Estado de erro: borda danger. */
  error?: boolean
  /** Mensagem de erro exibida abaixo do campo (implica error). */
  errorMessage?: ReactNode
}

export const Input = forwardRef(function Input(
  { icon: Icon, error = false, errorMessage, id, className = '', disabled, ...rest }: InputProps,
  ref: Ref<HTMLInputElement>
): JSX.Element {
  const autoId = useId()
  const inputId = id ?? autoId
  const messageId = `${inputId}-error`
  const hasError = error || errorMessage != null

  const fieldClasses = [
    'w-full rounded-control px-4 py-2.5 text-sm transition-colors duration-2 ease-standard',
    'bg-surface-sunken border text-ink-primary placeholder:text-ink-tertiary',
    'focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
    Icon ? 'pl-10' : '',
    hasError
      ? 'border-[var(--danger)] focus:border-[var(--danger)]'
      : 'border-[var(--border-subtle)] focus:border-[var(--accent-border)]',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="w-full">
      <div className="relative">
        {Icon && (
          <Icon
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
          />
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={errorMessage != null ? messageId : undefined}
          className={fieldClasses}
          {...rest}
        />
      </div>
      {errorMessage != null && (
        <p
          id={messageId}
          role="alert"
          className="mt-1.5 flex items-center gap-1.5 text-xs text-danger"
        >
          <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
          <span>{errorMessage}</span>
        </p>
      )}
    </div>
  )
})
