// Tooltip — balão de ajuda leve para ícones/controles sem texto (tarefa 2.0/13.6).
//
// Próprio (sem lib): abre no hover E no focus, com delay de 400 ms; fecha no
// mouse leave/blur/Esc. O filho (gatilho) recebe aria-describedby apontando
// para o balão SOMENTE enquanto visível. Posicionado acima (padrão) ou abaixo.
//
// Uso: <Tooltip content="Atualizar lista"><IconButton aria-label="Atualizar"><RefreshCw /></IconButton></Tooltip>
// Observação: para texto visível ao lado do controle, prefira texto normal — tooltip
// é só para affordance, nunca porte conteúdo essencial.
import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react'

export interface TooltipProps {
  /** Texto do balão (string simples — sem interativos dentro). */
  content: string
  /** Elemento que dispara o tooltip (tipicamente um IconButton). */
  children: ReactElement
  /** Lado do balão em relação ao gatilho. Padrão: top. */
  side?: 'top' | 'bottom'
  /** Atraso até abrir, em ms. Padrão: 400. */
  delay?: number
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 400
}: TooltipProps): JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  const clearTimer = (): void => {
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
  }

  const scheduleOpen = (): void => {
    clearTimer()
    timerRef.current = window.setTimeout(() => setOpen(true), delay)
  }

  const close = (): void => {
    clearTimer()
    setOpen(false)
  }

  // Limpa o timer ao desmontar (evita setState após unmount).
  useEffect(() => clearTimer, [])

  const childProps = children.props as {
    onMouseEnter?: (event: MouseEvent<HTMLElement>) => void
    onMouseLeave?: (event: MouseEvent<HTMLElement>) => void
    onFocus?: (event: FocusEvent<HTMLElement>) => void
    onBlur?: (event: FocusEvent<HTMLElement>) => void
    onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  }

  // cloneElement injeta aria-describedby e os handlers no gatilho preservando os
  // do próprio filho (chamados primeiro). Nenhuma ref é lida durante o render.
  // eslint-disable-next-line react-hooks/refs
  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(event)
      scheduleOpen()
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(event)
      close()
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(event)
      scheduleOpen()
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(event)
      close()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      childProps.onKeyDown?.(event)
      if (event.key === 'Escape') close()
    }
  })

  const positionClasses =
    side === 'top'
      ? 'bottom-full mb-2 left-1/2 -translate-x-1/2'
      : 'top-full mt-2 left-1/2 -translate-x-1/2'

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute z-dropdown whitespace-nowrap rounded-sm border border-[var(--border-strong)] bg-surface-3 px-2 py-1 text-[11px] font-medium text-ink-primary shadow-elevation-2 ${positionClasses}`}
        >
          {content}
        </span>
      )}
    </span>
  )
}
