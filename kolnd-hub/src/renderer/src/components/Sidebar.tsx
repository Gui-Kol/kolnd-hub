import { LayoutDashboard, Settings, Monitor, Zap } from 'lucide-react'
import { Page } from '../types'

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  pcName?: string | null
}

export function Sidebar({ currentPage, onNavigate, pcName }: SidebarProps): JSX.Element {
  const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'inicializacao', label: pcName ?? 'Meu PC', icon: Monitor },
    { id: 'settings', label: 'Configurações', icon: Settings }
  ]

  return (
    <aside className="w-56 border-r border-white/[0.04] bg-[#0c0c14] flex flex-col shrink-0">
      {/* ── Logo ─────────────────────────────────────── */}
      <div className="p-5 pb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Kolnd Hub</h1>
            <p className="text-[10px] text-slate-500 font-medium">Central de Controle</p>
          </div>
        </div>
      </div>

      {/* ── PC do usuário ────────────────────────────── */}
      {pcName && (
        <div className="px-3 mb-2">
          <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">
            Este computador
          </p>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs text-slate-300 truncate" title={pcName}>
            <Monitor size={12} className="shrink-0 text-slate-500" />
            <span className="min-w-0 truncate">{pcName}</span>
          </div>
        </div>
      )}

      {/* ── Navigation ───────────────────────────────── */}
      <nav className="flex-1 px-3">
        <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">
          Menu
        </p>
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = currentPage === item.id
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-indigo-500/15 text-indigo-400 shadow-sm shadow-indigo-500/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                <Icon size={16} />
                <span className="min-w-0 truncate" title={item.label}>
                  {item.label}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* ── Footer ───────────────────────────────────── */}
      <div className="p-4 border-t border-white/[0.04]">
        <div className="text-center">
          <p className="text-[10px] text-slate-600">Kolnd Hub v1.0.0</p>
          <p className="text-[9px] text-slate-700 mt-0.5">Electron + React + Tailwind</p>
        </div>
      </div>
    </aside>
  )
}
