import { Wrench, Settings, Monitor, Zap, LogOut, Gamepad2 } from 'lucide-react'
import { Page } from '../types'

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  pcName?: string | null
  onExit?: () => void
  /** Abre o modo Big Picture (tela cheia, navegação para gamepad). Oculto em ?first-run=1. */
  onEnterBigPicture?: () => void
}

export function Sidebar({
  currentPage,
  onNavigate,
  pcName,
  onExit,
  onEnterBigPicture
}: SidebarProps): JSX.Element {
  const navItems: { id: Page; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Ferramentas', icon: Wrench },
    { id: 'inicializacao', label: pcName ?? 'Meu PC', icon: Monitor },
    { id: 'biblioteca', label: 'Biblioteca', icon: Gamepad2 },
    { id: 'settings', label: 'Configurações', icon: Settings }
  ]

  return (
    <aside className="w-60 bg-surface-sunken border-r border-[var(--border-subtle)] shrink-0 flex flex-col z-rail">
      {/* ── Logo Kolnd Hub ─────────────────────────── */}
      <div className="p-6 pb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-card bg-accent flex items-center justify-center">
            <Zap size={20} className="text-accent-contrast" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-ink-primary tracking-tight">Kolnd Hub</h1>
            <p className="text-[9px] font-semibold uppercase tracking-widest text-ink-tertiary">
              Central de Controle
            </p>
          </div>
        </div>
      </div>

      {/* ── PC do usuário ────────────────────────────── */}
      {pcName && (
        <div className="px-4 mb-6">
          <p className="text-[9px] font-semibold text-ink-tertiary uppercase tracking-widest px-3 mb-3">
            Este computador
          </p>
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-control bg-surface-1 border border-[var(--border-subtle)] text-xs text-ink-secondary truncate group"
            title={pcName}
          >
            <Monitor
              size={14}
              className="shrink-0 text-ink-tertiary group-hover:text-ink-primary transition-colors"
            />
            <span className="min-w-0 truncate">{pcName}</span>
          </div>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────── */}
      <nav className="flex-1 px-4">
        <p className="text-[9px] font-semibold text-ink-tertiary uppercase tracking-widest px-3 mb-4">
          Menu
        </p>
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            // Ativo = acento único (13.2/13.4): todas as páginas compartilham o mesmo estado
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative w-full flex items-center gap-3 px-4 py-3 rounded-control text-sm font-medium transition-colors duration-2 border border-transparent ${
                  isActive
                    ? 'bg-accent-muted text-accent'
                    : 'text-ink-secondary hover:text-ink-primary hover:bg-surface-2'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-pill bg-accent"
                  />
                )}
                <Icon size={18} className="shrink-0" />
                <span className="min-w-0 truncate font-medium">{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── Ação: Sair ───────────────────────────────── */}
      {onExit && (
        <button
          onClick={onExit}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-control text-sm font-medium transition-colors duration-2 border border-danger-border bg-danger-bg text-danger hover:text-ink-primary hover:border-[var(--danger)]"
          aria-label="Sair do Kolnd Hub"
        >
          <LogOut size={18} className="shrink-0" />
          <span className="min-w-0 truncate">Sair</span>
        </button>
      )}

      {/* ── Footer ───────────────────────────────────── */}
      <div className="p-4 border-t border-[var(--border-subtle)] bg-surface-1">
        {/* ── Big Picture: entrada para o modo console ── */}
        {onEnterBigPicture && (
          <button
            type="button"
            onClick={onEnterBigPicture}
            aria-label="Entrar no modo Big Picture"
            className="w-full flex items-center gap-3 px-4 py-3 mb-3 rounded-control text-sm font-medium text-accent border border-accent-border bg-accent-muted transition-colors duration-2 hover:bg-accent hover:text-accent-contrast hover:border-transparent"
          >
            <Gamepad2 size={18} className="shrink-0" />
            <span className="min-w-0 truncate">Big Picture</span>
          </button>
        )}
        {/* Atalho da busca global — um único lugar, discreto */}
        <p className="mb-3 text-center text-[9px] text-ink-tertiary">
          Pressione{' '}
          <kbd className="rounded-sm border border-[var(--border-subtle)] bg-surface-2 px-1 font-bold text-ink-secondary">
            /
          </kbd>{' '}
          para buscar
        </p>
        <div className="text-center">
          <p className="text-[10px] font-semibold text-ink-secondary tracking-tight">Kolnd Hub</p>
          <p className="text-[9px] text-ink-tertiary mt-0.5">v{__APP_VERSION__} · Gamer Edition</p>
        </div>
      </div>
    </aside>
  )
}
