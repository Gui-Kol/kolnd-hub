// Button — primitivo único de botão do Hub (tarefa 2.0/13.6).
//
// Variantes:
//   primary        — acento sólido (--accent) com texto --accent-contrast.
//                    Hover: --accent-hover; ativo: --accent-active. Sem gradiente/glow.
//   secondary      — superfície 2 + borda forte; hover sobe para superfície 3.
//   ghost          — sem borda/fundo; hover ganha superfície 2 discreta.
//   danger         — ação destrutiva FORTE visível: texto+borda danger sobre fundo
//                    translúcido (--danger-muted, nunca vermelho sólido gritante).
//   subtle-danger  — destrutiva DISCRETA (estilo ghost com tom danger): texto danger,
//                    fundo danger translúcido só no hover.
//
// Tamanhos: sm (h-8, alvo de 32 px) | md (h-10, alvo de 40 px, padrão).
// Estados: hover, active (scale 0.98), disabled (opacity 50%, sem hover), focus-visible
// (anel global de 2px --focus-ring definido em index.css).
//
// Uso: <Button variant="primary" size="md" onClick={…}>Salvar</Button>
// Tipo padrão é "button" (não submete formulário sem querer); passe type="submit" se precisar.
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle-danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Esquema visual. Padrão: secondary (ação neutra e segura). */
  variant?: ButtonVariant
  /** sm = 32 px | md = 40 px. Padrão: md. */
  size?: ButtonSize
}

// Exportado para o IconButton reusar os mesmos esquemas (mesma fonte de verdade).
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-contrast border border-transparent enabled:hover:bg-accent-hover enabled:active:bg-accent-active',
  secondary:
    'bg-surface-2 text-ink-secondary border border-[var(--border-strong)] enabled:hover:bg-surface-3 enabled:hover:text-ink-primary',
  ghost:
    'bg-transparent text-ink-secondary border border-transparent enabled:hover:bg-surface-2 enabled:hover:text-ink-primary',
  danger:
    'bg-danger-bg text-danger border border-danger-border enabled:hover:border-[var(--danger)] enabled:hover:text-ink-primary',
  'subtle-danger':
    'bg-transparent text-danger border border-transparent enabled:hover:bg-danger-bg enabled:hover:border-danger-border enabled:hover:text-danger'
}

export const BUTTON_BASE_CLASSES =
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded-control font-bold uppercase tracking-wider transition-all duration-2 ease-standard active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50'

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[11px] gap-1.5',
  md: 'h-10 px-5 text-xs gap-2'
}

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', type = 'button', className = '', ...rest }: ButtonProps,
  ref: Ref<HTMLButtonElement>
): JSX.Element {
  const classes = [
    BUTTON_BASE_CLASSES,
    BUTTON_VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className
  ]
    .filter(Boolean)
    .join(' ')

  return <button ref={ref} type={type} className={classes} {...rest} />
})
