// IconButton — botão exclusivamente de ícone (tarefa 2.0/13.6).
//
// Mesmos esquemas do Button (BUTTON_VARIANT_CLASSES), mas o alvo é quadrado e o
// aria-label é OBRIGATÓRIO em tempo de compilação (ícone sozinho não tem nome acessível):
// variant: primary | secondary | ghost | danger | subtle-danger (ver Button.tsx).
// size: sm = 32 px (alvo mínimo) | md = 40 px (padrão).
//
// Estados: hover, active (scale 0.98), disabled, focus-visible (anel global --focus-ring).
// Uso: <IconButton aria-label="Fechar aviso"><X size={16} /></IconButton>
// Big Picture (alvo de 44 px) fica para depois — aqui só sm/md.
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, Ref } from 'react'
import { BUTTON_BASE_CLASSES, BUTTON_VARIANT_CLASSES } from './Button'
import type { ButtonSize, ButtonVariant } from './Button'

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** Nome acessível OBRIGATÓRIO — descreve a ação (ex.: "Fechar aviso"). */
  'aria-label': string
  /** Esquema visual. Padrão: ghost (ação discreta, típica de ícone). */
  variant?: ButtonVariant
  /** sm = 32 px | md = 40 px. Padrão: md. */
  size?: ButtonSize
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10'
}

export const IconButton = forwardRef(function IconButton(
  { variant = 'ghost', size = 'md', className = '', type = 'button', ...rest }: IconButtonProps,
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
