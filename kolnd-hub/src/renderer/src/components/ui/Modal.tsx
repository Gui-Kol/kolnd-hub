// Modal — casca única de diálogo do Hub (tarefa 2.0/13.6).
//
// Padrão fixed inset (o app NÃO usa createPortal hoje) com backdrop --bg-sunken
// translúcido (~78%) + blur leve, painel surface-3 com raio --radius-card e
// shadow-elevation-3. Entrada: fade + slide curto (240 ms) via transições Tailwind/tokens;
// com prefers-reduced-motion as transições são desligadas (motion-reduce:transition-none).
//
// Acessibilidade:
//   - role="dialog" + aria-modal; nome acessível OBRIGATÓRIO em tempo de compilação
//     (via `title` ou `ariaLabel` — um dos dois é exigido).
//   - Foco preso no painel (Tab/Shift+Tab ciclam) — reutiliza lib/useFocusTrap, que
//     também DEVOLVE o foco ao gatilho ao desmontar.
//   - Esc fecha; clique no backdrop fecha — EXCETO com `disableClose` (modais
//     destrutivos: Esc/backdrop/botão X são ignorados). O trap já recebe onEscape só
//     quando !disableClose.
//   - `closeOnEsc={false}` (fluxos críticos sem affordance de teclado/X, ex.: exit
//     modal): Esc e o botão X são desligados/ocultados — o backdrop CONTINUA
//     fechando e os botões do rodapé permanecem. Default: true.
//
// Montagem: o pai renderiza condicionalmente ({aberto && <Modal onClose={…}>});
// a SAÍDA é instantânea (este componente não é motion; AnimatePresence não se aplica).
//
// Slots: `title` (header), children (corpo), `footer` (rodapé de ações).
// Uso: <Modal title="Excluir app" footer={<><Button onClick={onClose}>Cancelar</Button>…</>} onClose={…}>…</Modal>
import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../lib/useFocusTrap'
import { IconButton } from './IconButton'

type ModalA11y =
  | {
      /** Header do diálogo; vira o nome acessível (aria-labelledby). */ title: ReactNode
      ariaLabel?: string
    }
  | { title?: undefined; /** Nome acessível quando não há `title` visível. */ ariaLabel: string }

export type ModalProps = ModalA11y & {
  /** Fecha o diálogo (Esc/backdrop/X). Ignorado quando disableClose. */
  onClose: () => void
  /** Desativa Esc, clique no backdrop e o botão X (modais destrutivos/fluxos críticos). */
  disableClose?: boolean
  /** Permite fechar com Esc (e exibe o X). Padrão: true. false = só backdrop + botões (ex.: exit modal). */
  closeOnEsc?: boolean
  /** Slot de rodapé — tipicamente os botões de ação. */
  footer?: ReactNode
  /** aria-label do backdrop e do botão fechar. Padrão: "Fechar". */
  closeLabel?: string
  /** Classes extras do painel (ex.: sobrescrever a largura). */
  className?: string
  /** Corpo do diálogo. */
  children?: ReactNode
}

const BACKDROP_CLASSES =
  'absolute inset-0 bg-[color-mix(in_srgb,var(--bg-sunken)_78%,transparent)] backdrop-blur-[6px] transition-opacity duration-2 ease-standard motion-reduce:transition-none'

export function Modal({
  onClose,
  disableClose = false,
  closeOnEsc = true,
  footer,
  closeLabel = 'Fechar',
  className = '',
  children,
  ...a11y
}: ModalProps): JSX.Element {
  const titleId = useId()
  const hasTitle = a11y.title != null
  const [visible, setVisible] = useState(false)

  // Monta oculto e revela no próximo frame para disparar a transição de entrada.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true))
    return (): void => cancelAnimationFrame(raf)
  }, [])

  // Esc só entra no trap quando o fluxo permite saída por teclado.
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: true,
    onEscape: disableClose || !closeOnEsc ? undefined : onClose
  })

  const handleBackdropClose = disableClose ? undefined : onClose

  const panelClasses = [
    'relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card',
    'border border-[var(--border-subtle)] bg-surface-3 shadow-elevation-3',
    'transition-all duration-3 ease-standard motion-reduce:transition-none',
    visible ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.98] opacity-0',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-8">
      {/* Backdrop — botão acessível (padrão do App.tsx); some quando disableClose. */}
      {disableClose ? (
        <div
          aria-hidden="true"
          className={`${BACKDROP_CLASSES} ${visible ? 'opacity-100' : 'opacity-0'}`}
        />
      ) : (
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeLabel}
          onClick={handleBackdropClose}
          className={`${BACKDROP_CLASSES} cursor-default ${visible ? 'opacity-100' : 'opacity-0'}`}
        />
      )}

      {/* Painel */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-label={hasTitle ? undefined : a11y.ariaLabel}
        className={panelClasses}
      >
        {!disableClose && closeOnEsc && (
          <IconButton
            variant="ghost"
            size="sm"
            aria-label={closeLabel}
            onClick={onClose}
            className="absolute right-3 top-3 z-10"
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        )}

        {hasTitle && (
          <header
            className={`border-b border-[var(--border-subtle)] px-6 py-4 ${!disableClose && closeOnEsc ? 'pr-14' : ''}`}
          >
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink-primary">
              {a11y.title}
            </h2>
          </header>
        )}

        <div className="overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
