import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Minus, Square, X, Zap } from 'lucide-react'
import { Page } from '../types'

interface LayoutProps {
  children: ReactNode
  currentPage: Page
  onNavigate: (page: Page) => void
  runningCount: number
  pcName?: string | null
  onExit?: () => void
  onEnterBigPicture?: () => void
}

export function Layout({
  children,
  currentPage,
  onNavigate,
  runningCount,
  pcName,
  onExit,
  onEnterBigPicture
}: LayoutProps): JSX.Element {
  return (
    <div className="h-screen flex flex-col">
      {/* ── Scanlines (efeito arcade/console) ────────── */}
      <div className="scanlines" />

      {/* ── Title bar ────────────────────────────────── */}
      <div className="title-bar h-12 flex items-center justify-between px-5 bg-white/[0.02] backdrop-blur-md border-b border-white/[0.05] z-40">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-kloud-500 to-nintendo-500 flex items-center justify-center shadow-glow-orange">
            <Zap size={14} className="text-white" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold text-white tracking-tight gradient-text gradient-kloud">
              Kolnd Hub
            </span>
            {runningCount > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30 animate-pulse-slow">
                {runningCount} ativo{runningCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Window controls */}
        <div className="title-bar-no-drag flex items-center gap-1">
          <button
            onClick={() => window.api.minimizeWindow()}
            className="p-2 rounded-lg hover:bg-white/[0.08] text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Minimizar"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={() => window.api.maximizeWindow()}
            className="p-2 rounded-lg hover:bg-white/[0.08] text-slate-500 hover:text-slate-200 transition-colors"
            aria-label="Maximizar"
          >
            <Square size={10} />
          </button>
          <button
            onClick={() => window.api.closeWindow()}
            className="p-2 rounded-lg hover:bg-red-600/90 text-white transition-colors shadow-glow-red"
            aria-label="Fechar"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Main content area ────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentPage={currentPage}
          onNavigate={onNavigate}
          pcName={pcName}
          onExit={onExit}
          onEnterBigPicture={onEnterBigPicture}
        />
        <main className="flex-1 overflow-y-auto p-8 pb-12">{children}</main>
      </div>
    </div>
  )
}
