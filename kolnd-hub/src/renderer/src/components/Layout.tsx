import { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Badge, IconButton } from './ui'
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
      {/* ── Title bar ────────────────────────────────── */}
      <div className="title-bar h-12 flex items-center justify-between px-5 bg-surface-1 border-b border-[var(--border-subtle)] z-chrome">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <Zap size={14} className="text-accent-contrast" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-ink-primary tracking-tight">Kolnd Hub</span>
            {runningCount > 0 && (
              <Badge tone="success" role="status" className="w-fit mt-0.5">
                {runningCount} ativo{runningCount > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        </div>

        {/* Window controls */}
        <div className="title-bar-no-drag flex items-center gap-1">
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => window.api.minimizeWindow()}
            aria-label="Minimizar"
          >
            <Minus size={12} />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => window.api.maximizeWindow()}
            aria-label="Maximizar"
          >
            <Square size={12} />
          </IconButton>
          <IconButton
            variant="subtle-danger"
            size="sm"
            onClick={() => window.api.closeWindow()}
            aria-label="Fechar"
          >
            <X size={12} />
          </IconButton>
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
