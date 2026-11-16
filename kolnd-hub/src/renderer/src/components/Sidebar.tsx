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
    <aside className="w-60 border-r border-white/[0.05] bg-slate-950/80 backdrop-blur-2xl shrink-0 flex flex-col z-30">
      {/* ── Logo Kolnd Hub ─────────────────────────── */}
      <div className="p-6 pb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-kloud-500 to-nintendo-500 flex items-center justify-center shadow-glow-orange relative overflow-hidden">
            <Zap size={20} className="text-white z-10" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight gradient-text gradient-kloud text-shadow">
              Kolnd Hub
            </h1>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
              Central de Controle
            </p>
          </div>
        </div>
      </div>

      {/* ── PC do usuário ────────────────────────────── */}
      {pcName && (
        <div className="px-4 mb-6">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-3">
            Este computador
          </p>
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-slate-300 truncate group"
            title={pcName}
          >
            <Monitor
              size={14}
              className="shrink-0 text-slate-400 group-hover:text-playstation-400 transition-colors"
            />
            <span className="min-w-0 truncate">{pcName}</span>
          </div>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────── */}
      <nav className="flex-1 px-4">
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-4">
          Menu
        </p>
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            // Ativo = acento único (13.2/13.4): todas as páginas compartilham o mesmo estado
            const activeColor = 'text-accent bg-accent-muted border-accent-border'
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border-l-2 focus-visible:ring-2 focus-visible:ring-neon-cyan/70 ${
                  isActive
                    ? `${activeColor} text-slate-100`
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                }`}
              >
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
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/15 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-neon-cyan/70"
          aria-label="Sair do Kolnd Hub"
        >
          <LogOut size={18} className="shrink-0" />
          <span className="min-w-0 truncate">Sair</span>
        </button>
      )}

      {/* ── Footer ───────────────────────────────────── */}
      <div className="p-4 border-t border-white/[0.05] bg-white/[0.02]">
        {/* ── Big Picture: entrada para o modo console ── */}
        {onEnterBigPicture && (
          <button
            type="button"
            onClick={onEnterBigPicture}
            aria-label="Entrar no modo Big Picture"
            className="w-full flex items-center gap-3 px-4 py-3 mb-3 rounded-xl text-sm font-medium text-neon-cyan border border-neon-cyan/25 bg-neon-cyan/5 transition-all duration-200 hover:bg-neon-cyan/10 hover:border-neon-cyan/40 hover:shadow-glow-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/70"
          >
            <Gamepad2 size={18} className="shrink-0" />
            <span className="min-w-0 truncate">Big Picture</span>
          </button>
        )}
        {/* Atalho da busca global — um único lugar, discreto */}
        <p className="mb-3 text-center text-[9px] text-slate-400">
          Pressione{' '}
          <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1 font-bold text-slate-400">
            /
          </kbd>{' '}
          para buscar
        </p>
        <div className="text-center">
          <p className="text-[10px] font-bold text-slate-400 tracking-tight">Kolnd Hub</p>
          <p className="text-[9px] text-slate-400 mt-0.5">v{__APP_VERSION__} · Gamer Edition</p>
        </div>
      </div>
    </aside>
  )
}
