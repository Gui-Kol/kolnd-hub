import { Gamepad2, Gamepad, LogOut } from 'lucide-react'
import { motion } from 'framer-motion'
import { useFocusable, BP_FOCUS_RING, BP_FOCUSED_RING } from './BigPictureFocus'
import { formatFocusItem } from '../lib/useAnnouncer'
import { useReducedMotion } from '../lib/motion'

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

interface RailItemProps {
  id: string
  icon: typeof Gamepad2
  label: string
  active?: boolean
  onClick: () => void
  danger?: boolean
  /** Posição 1-based no rail (para o anúncio de leitor de tela). */
  position: number
  /** Total de itens focáveis do rail (para o anúncio de leitor de tela). */
  total: number
}

/**
 * Item grande do rail — alvo de ponteiro/foco generoso (≥ 64 px de altura),
 * pensado para TV e navegação por controle.
 *
 * Foco (gamepad, teclado ou hover): anel de 4 px (--focus-ring) + fundo
 * acento translúcido — idêntico independentemente da origem do foco.
 * Seção ativa: barra acento deslizante à esquerda (`bp-rail-section`, tween
 * curto com o easing padrão — sem spring/bounce).
 */
function RailItem({
  id,
  icon: Icon,
  label,
  active,
  onClick,
  danger,
  position,
  total
}: RailItemProps): JSX.Element {
  const { ref, focused, focus } = useFocusable(id, () =>
    formatFocusItem('Menu', position, total, label)
  )
  // Indicador desliza só entre itens de seção (games/controls) — o item de
  // sair não participa do layoutId. Com reduce, o salto é instantâneo.
  const reduced = useReducedMotion()
  const lit = active || focused

  const palette = danger
    ? focused
      ? 'border-danger-border bg-danger-bg text-danger'
      : 'border-transparent text-danger hover:bg-danger-bg hover:text-ink-primary'
    : lit
      ? 'border-accent-border bg-accent-muted text-accent'
      : 'border-transparent text-ink-secondary hover:text-ink-primary hover:bg-surface-2'

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active ?? false}
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      onMouseEnter={focus}
      onFocus={focus}
      className={`relative w-full flex items-center gap-4 pl-7 pr-5 py-5 min-h-[4rem] rounded-card border text-2xl 3xl:text-3xl font-semibold tracking-tight transition-colors duration-2 ${
        focused ? BP_FOCUSED_RING : ''
      } ${BP_FOCUS_RING} focus:outline-none ${palette}`}
    >
      {/* Barra acento deslizante (layoutId) — ≤ 240 ms, easing padrão, sem spring */}
      {active && (
        <motion.span
          layoutId="bp-rail-section"
          transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          aria-hidden="true"
          // -mt-5 (metade de h-10) centraliza sem transform — o framer-motion
          // controla o `transform` do layoutId e sobrescreveria o translate-y.
          className="absolute left-0 top-1/2 -mt-5 h-10 w-[3px] rounded-r-full bg-accent"
        />
      )}
      <Icon
        size={30}
        strokeWidth={1.75}
        aria-hidden="true"
        className="shrink-0 transition-colors duration-2"
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/**
 * Rail vertical do Big Picture (à esquerda): logo KOLND no topo, seções
 * principais, indicador de conexão no rodapé e, por fim, a saída para o Hub.
 * Superfície sunken (mesma linguagem do modo normal); largura fluida:
 * 16 rem (1280×800) → 18 rem (xl) → 20 rem (2xl/TVs 4K).
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
      className="relative w-64 xl:w-72 2xl:w-80 shrink-0 flex flex-col border-r border-[var(--border-subtle)] bg-surface-sunken"
    >
      {/* ── Logo KOLND ──────────────────────────────── */}
      <div className="px-7 pt-10 pb-12 select-none">
        <h1 className="text-6xl 2xl:text-7xl font-black tracking-tight text-ink-primary leading-none">
          KOLND
        </h1>
        <p className="mt-3 text-[11px] 3xl:text-base font-bold uppercase tracking-[0.45em] text-accent">
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
          position={1}
          total={3}
        />
        <RailItem
          id="rail:controls"
          icon={Gamepad}
          label="Controle"
          active={section === 'controls'}
          onClick={() => onSelectSection('controls')}
          position={2}
          total={3}
        />
      </div>

      {/* ── Rodapé: conexão + saída ─────────────────── */}
      <div className="px-4 pb-8 pt-4 border-t border-[var(--border-subtle)] space-y-3">
        {connection?.visible && (
          <div
            className="flex items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-surface-2 px-4 py-2.5 min-h-[3rem]"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors duration-2 ${
                connection.connected ? 'bg-success' : 'bg-ink-tertiary'
              }`}
            />
            <span className="text-[11px] 3xl:text-base font-bold uppercase tracking-wider text-ink-secondary">
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
            position={3}
            total={3}
          />
        </div>
        <p className="px-7 text-[10px] 3xl:text-base font-medium uppercase tracking-widest text-ink-tertiary">
          B ou Esc para sair
        </p>
      </div>
    </nav>
  )
}
