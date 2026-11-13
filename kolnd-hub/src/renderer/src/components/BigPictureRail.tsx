import { Gamepad2, Gamepad, LogOut } from 'lucide-react'
import { useFocusable } from './BigPictureFocus'

export type BigPictureSection = 'games' | 'controls'

export interface BigPictureConnectionStatus {
  connected: boolean
  /** false quando ligado e estável — o indicador some sozinho após 3 s. */
  visible: boolean
}

interface BigPictureRailProps {
  section: BigPictureSection
  onSelectSection: (section: BigPictureSection) => void
  onExit: () => void
  /** Indicador de conexão do controle (ponto no rodapé do rail). */
  connection?: BigPictureConnectionStatus
}

const focusRing = 'focus:outline-none focus-visible:ring-4 focus-visible:ring-neon-cyan/70'

interface RailItemProps {
  id: string
  icon: typeof Gamepad2
  label: string
  active?: boolean
  onClick: () => void
  danger?: boolean
}

/**
 * Item grande do rail — alvo de ponteiro/foco generoso (≥ 64 px de altura),
 * pensado para TV e navegação por controle.
 *
 * Foco (gamepad, teclado ou hover): barra lateral neon à esquerda + ícone aceso
 * + leve fundo — idêntico independentemente da origem do foco.
 */
function RailItem({ id, icon: Icon, label, active, onClick, danger }: RailItemProps): JSX.Element {
  const { ref, focused, focus } = useFocusable(id)
  const lit = active || focused

  const palette = danger
    ? focused
      ? 'text-red-300 bg-red-500/10 ring-2 ring-red-400/60'
      : 'text-red-400/90 hover:text-red-300 hover:bg-red-500/10'
    : lit
      ? 'text-neon-cyan bg-white/[0.05]'
      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active ?? false}
      onClick={onClick}
      onMouseEnter={focus}
      onFocus={focus}
      className={`relative w-full flex items-center gap-4 pl-7 pr-5 py-5 min-h-[4rem] rounded-2xl text-2xl 3xl:text-3xl font-semibold tracking-tight transition-all duration-200 ${focusRing} ${palette}`}
    >
      {lit && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 -translate-y-1/2 h-12 w-1.5 rounded-r-full bg-neon-cyan shadow-glow-cyan"
        />
      )}
      <Icon
        size={30}
        strokeWidth={1.75}
        className={`shrink-0 transition-all duration-200 ${
          lit ? 'text-neon-cyan drop-shadow-[0_0_14px_rgba(0,243,255,0.45)]' : ''
        }`}
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/**
 * Rail vertical do Big Picture (à esquerda): logo KOLND no topo, seções
 * principais, indicador de conexão no rodapé e, por fim, a saída para o Hub.
 * Largura fluida: 16 rem (1280×800) → 18 rem (xl) → 20 rem (2xl/TVs 4K).
 */
export function BigPictureRail({
  section,
  onSelectSection,
  onExit,
  connection
}: BigPictureRailProps): JSX.Element {
  return (
    <nav
      aria-label="Navegação do Big Picture"
      className="relative w-64 xl:w-72 2xl:w-80 shrink-0 flex flex-col border-r border-white/[0.06] bg-black/30 backdrop-blur-xl"
    >
      {/* ── Logo KOLND ──────────────────────────────── */}
      <div className="px-7 pt-10 pb-12 select-none">
        <h1 className="text-6xl 2xl:text-7xl font-black tracking-tight gradient-text gradient-rainbow text-shadow leading-none">
          KOLND
        </h1>
        <p className="mt-3 text-[11px] 3xl:text-base font-bold uppercase tracking-[0.45em] text-neon-cyan/80">
          Big Picture
        </p>
      </div>

      {/* ── Seções ──────────────────────────────────── */}
      <div role="listbox" aria-label="Seções do Big Picture" className="flex-1 px-4 space-y-2">
        <RailItem
          id="rail:games"
          icon={Gamepad2}
          label="Jogos"
          active={section === 'games'}
          onClick={() => onSelectSection('games')}
        />
        <RailItem
          id="rail:controls"
          icon={Gamepad}
          label="Controle"
          active={section === 'controls'}
          onClick={() => onSelectSection('controls')}
        />
      </div>

      {/* ── Rodapé: conexão + saída ─────────────────── */}
      <div className="px-4 pb-8 pt-4 border-t border-white/[0.06] space-y-3">
        {connection?.visible && (
          <div
            className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-2.5 min-h-[3rem]"
            role="status"
            aria-live="polite"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${
                connection.connected
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                  : 'bg-slate-600'
              }`}
            />
            <span className="text-[11px] 3xl:text-base font-bold uppercase tracking-wider text-slate-400">
              {connection.connected ? 'Controle conectado' : 'Sem controle (mouse)'}
            </span>
          </div>
        )}
        <div role="listbox" aria-label="Sair">
          <RailItem
            id="rail:exit"
            icon={LogOut}
            label="Sair do Big Picture"
            onClick={onExit}
            danger
          />
        </div>
        <p className="px-7 text-[10px] 3xl:text-base font-medium uppercase tracking-widest text-slate-500">
          B ou Esc para sair
        </p>
      </div>
    </nav>
  )
}
