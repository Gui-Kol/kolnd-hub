// Switch — primitivo único de alternância booleana do Hub (tarefa 2.0/13.6).
//
// Extrai o .toggle-console para um componente de primeira classe: role="switch",
// aria-checked, knob tokenizado (unchecked: ink-secondary sobre track sunken;
// checked: accent-contrast sobre acento sólido). Foco visível via anel global.
//
// Controlado: `checked` + `onCheckedChange(next)`. onClick nativo também dispara
// (útil para telemetria/migração). Teclado: Space/Enter (padrão de <button>).
// Estados: checked/unchecked, disabled (opacity 50%).
//
// Uso: <Switch checked={v} onCheckedChange={setV} aria-label="Iniciar com o Windows" />
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'aria-checked'
> {
  /** Estado atual (controlado). */
  checked: boolean
  /** Chamado com o novo valor ao alternar. */
  onCheckedChange?: (checked: boolean) => void
}

export const Switch = forwardRef(function Switch(
  { checked, onCheckedChange, onClick, className = '', type = 'button', ...rest }: SwitchProps,
  ref: Ref<HTMLButtonElement>
): JSX.Element {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (!event.currentTarget.disabled) onCheckedChange?.(!checked)
    onClick?.(event)
  }

  const trackClasses = [
    'relative inline-flex h-6 w-12 shrink-0 cursor-pointer items-center rounded-pill border',
    'transition-colors duration-2 ease-standard',
    'disabled:cursor-not-allowed disabled:opacity-50',
    checked ? 'border-transparent bg-accent' : 'border-[var(--border-subtle)] bg-surface-sunken',
    className
  ]
    .filter(Boolean)
    .join(' ')

  const knobClasses = [
    'pointer-events-none absolute left-0.5 top-1/2 inline-block h-5 w-5 -translate-y-1/2 rounded-full shadow-sm',
    'transition-all duration-2 ease-standard',
    checked ? 'translate-x-6 bg-accent-contrast' : 'translate-x-0 bg-ink-secondary'
  ].join(' ')

  return (
    <button
      ref={ref}
      type={type}
      role="switch"
      aria-checked={checked}
      onClick={handleClick}
      className={trackClasses}
      {...rest}
    >
      <span aria-hidden="true" className={knobClasses} />
    </button>
  )
})
