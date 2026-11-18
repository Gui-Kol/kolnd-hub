// Overlays do Big Picture — extraídos de `BigPicture.tsx` (divisão mecânica,
// sem mudança de comportamento/visual). São componentes de baixo movimento
// (só aparecem com um diálogo aberto); memoizados para não re-renderizar
// com o relógio/foco da home.

import { memo } from 'react'
import { Gamepad, LogOut, Undo2 } from 'lucide-react'
import { Spinner } from './ui'
import { useFocusable } from './BigPictureFocus'
import { formatFocusItem } from '../lib/useAnnouncer'

/** Botão de overlay — mesma anatomia do foco (mouse = gamepad = teclado). */
const OverlayButton = memo(function OverlayButton({
  id,
  icon: Icon,
  label,
  danger,
  onClick,
  area,
  position,
  total
}: {
  id: string
  icon: typeof LogOut
  label: string
  danger?: boolean
  onClick: () => void
  /** Área do anúncio (ex.: "Opções", "Sair do Big Picture"). */
  area: string
  position: number
  total: number
}): JSX.Element {
  const { ref, focused, focus } = useFocusable(id, () =>
    formatFocusItem(area, position, total, label)
  )

  const palette = danger
    ? focused
      ? 'border-red-400/60 bg-red-500/15 text-red-200 ring-4 ring-red-400/50'
      : 'border-red-500/25 bg-red-500/5 text-red-300 hover:bg-red-500/10'
    : focused
      ? 'border-accent-border bg-accent-muted text-accent ring-4 ring-accent-border'
      : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.06]'

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={focus}
      onFocus={focus}
      className={`flex w-full items-center gap-4 rounded-2xl border px-6 py-5 text-xl font-semibold tracking-tight transition-all duration-150 focus:outline-none ${palette}`}
    >
      <Icon size={24} strokeWidth={1.75} className="shrink-0" />
      <span className="min-w-0">{label}</span>
    </button>
  )
})

/** Overlay "Opções" (Start/Menu): configuração de controle ou sair. */
export const OptionsOverlay = memo(function OptionsOverlay({
  onOpenControls,
  onQuit,
  onClose
}: {
  onOpenControls: () => void
  onQuit: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Opções do Big Picture"
    >
      <button
        type="button"
        aria-label="Fechar opções"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-[30rem] max-w-[90vw] space-y-4 rounded-3xl border border-white/[0.08] bg-surface-sunken/95 p-6 shadow-2xl shadow-black/60">
        <h2 className="px-1 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Opções</h2>
        <OverlayButton
          id="options:controls"
          icon={Gamepad}
          label="Configuração de controle"
          onClick={onOpenControls}
          area="Opções"
          position={1}
          total={2}
        />
        <OverlayButton
          id="options:quit"
          icon={LogOut}
          label="Sair do Big Picture"
          danger
          onClick={onQuit}
          area="Opções"
          position={2}
          total={2}
        />
        <p className="px-1 pt-1 text-[11px] 3xl:text-base font-medium uppercase tracking-widest text-slate-400">
          Esc também fecha
        </p>
      </div>
    </div>
  )
})

/** Confirmação de saída ("B" na raiz, Esc, ou item do rail). */
export const ExitOverlay = memo(function ExitOverlay({
  onCancel,
  onConfirm
}: {
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Sair do Big Picture?"
    >
      <button
        type="button"
        aria-label="Fechar confirmação de saída"
        className="absolute inset-0 cursor-default"
        onClick={onCancel}
      />
      <div className="relative w-[32rem] max-w-[90vw] space-y-6 rounded-3xl border border-white/[0.08] bg-surface-sunken/95 p-8 text-center shadow-2xl shadow-black/60">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10">
          <LogOut size={36} strokeWidth={1.5} className="text-red-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-black tracking-tight text-white">Sair do Big Picture?</h2>
          <p className="text-base leading-relaxed text-slate-400">
            Você voltará ao Hub normal. Nada será fechado — seus programas e a bandeja continuam
            exatamente como estão.
          </p>
        </div>
        <div className="flex gap-3">
          <OverlayButton
            id="exit:cancel"
            icon={Undo2}
            label="Continuar no Big Picture"
            onClick={onCancel}
            area="Sair do Big Picture"
            position={1}
            total={2}
          />
          <OverlayButton
            id="exit:quit"
            icon={LogOut}
            label="Sair do Big Picture"
            danger
            onClick={onConfirm}
            area="Sair do Big Picture"
            position={2}
            total={2}
          />
        </div>
      </div>
    </div>
  )
})

/**
 * Overlay de "Controle desconectado" (T8) — exibido quando o controle some no
 * meio da sessão. Não-bloqueante para o mouse (pointer-events-none em tudo):
 * o rail e a grade seguem clicáveis por trás, enquanto o gamepad fica inerte
 * por construção (sem pad, nenhuma ação dispara). Some sozinho ao reconectar.
 */
export const DisconnectOverlay = memo(function DisconnectOverlay(): JSX.Element {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[56] flex items-center justify-center"
      role="alertdialog"
      aria-live="assertive"
      aria-label="Controle desconectado"
    >
      <div className="flex max-w-lg flex-col items-center gap-5 rounded-3xl border border-white/[0.1] bg-surface-sunken/90 px-12 py-10 text-center shadow-2xl shadow-black/70 backdrop-blur-xl">
        <Spinner size={44} label="Reconectando controle" className="[&_svg]:text-accent" />
        <h2 className="text-3xl font-black tracking-tight text-white">Controle desconectado</h2>
        <p className="text-lg leading-relaxed text-slate-300">
          Reconecte o controle ou use o mouse
        </p>
      </div>
    </div>
  )
})
