// Select — primitivo único de seleção do Hub (tarefa 2.0/13.6).
//
// <select> nativo estilizado (o app não usa lib de select — não adicionar dependência):
// fundo sunken, borda sutil, appearance-none + chevron lucide decorativo à direita.
// Foco via borda --accent-border (anel 2px --focus-ring vem do :focus-visible global).
//
// Props extras sobre o <select> nativo (mesma API do Input):
//   error         — estado de erro: borda danger.
//   errorMessage  — mensagem abaixo (implica error); liga aria-invalid e aria-describedby.
//   disabled      — opacity 50%, cursor not-allowed.
//
// Uso: <Select value={v} onChange={…}><option value="a">A</option></Select>
import { forwardRef, useId } from 'react'
import type { ReactNode, Ref, SelectHTMLAttributes } from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Estado de erro: borda danger. */
  error?: boolean
  /** Mensagem de erro exibida abaixo do campo (implica error). */
  errorMessage?: ReactNode
}

export const Select = forwardRef(function Select(
  { error = false, errorMessage, id, className = '', disabled, children, ...rest }: SelectProps,
  ref: Ref<HTMLSelectElement>
): JSX.Element {
  const autoId = useId()
  const selectId = id ?? autoId
  const messageId = `${selectId}-error`
  const hasError = error || errorMessage != null

  const fieldClasses = [
    'w-full appearance-none rounded-control py-2.5 pl-4 pr-10 text-sm transition-colors duration-2 ease-standard',
    'bg-surface-sunken border text-ink-primary',
    'focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
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
        <select
          ref={ref}
          id={selectId}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={errorMessage != null ? messageId : undefined}
          className={fieldClasses}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
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
