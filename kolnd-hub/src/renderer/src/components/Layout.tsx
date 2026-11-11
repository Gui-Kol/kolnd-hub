import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Minus, Square, X } from 'lucide-react'
import { Page } from '../types'

interface LayoutProps {
  children: ReactNode
  currentPage: Page
  onNavigate: (page: Page) => void
  runningCount: number
  pcName?: string | null
}

export function Layout({
  children,
  currentPage,
  onNavigate,
  runningCount,
  pcName
}: LayoutProps): JSX.Element {
  return (
    <div className="h-screen flex flex-col">
      {/* ── Title bar ────────────────────────────────── */}
      <div className="title-bar h-10 flex items-center justify-between px-4 bg-[#0a0a0f]/90 backdrop-blur-md border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="text-sm font-semibold text-slate-300 tracking-tight">Kolnd Hub</span>
          {runningCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium border border-emerald-500/20 animate-pulse-slow">
              {runningCount} ativo{runningCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Window controls */}
        <div className="title-bar-no-drag flex items-center gap-0.5">
          <button
            onClick={() => window.api.minimizeWindow()}
            className="p-2 rounded-md hover:bg-white/[0.08] text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Minimizar"
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => window.api.maximizeWindow()}
            className="p-2 rounded-md hover:bg-white/[0.08] text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Maximizar"
          >
            <Square size={11} />
          </button>
          <button
            onClick={() => window.api.closeWindow()}
            className="p-2 rounded-md hover:bg-red-500/80 text-slate-500 hover:text-white transition-colors"
            aria-label="Fechar"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Main content area ────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar currentPage={currentPage} onNavigate={onNavigate} pcName={pcName} />
        <main className="flex-1 overflow-y-auto p-6 pb-10">{children}</main>
      </div>
    </div>
  )
}
