import { ReactNode } from 'react'
import { Minus, Monitor, Square, X, Zap } from 'lucide-react'
import { Topbar } from './Topbar'
import { IconButton } from './ui'
import { Page } from '../types'

interface LayoutProps {
  children: ReactNode
  currentPage: Page
  onNavigate: (page: Page) => void
  runningCount: number
  /** Total de ferramentas configuradas — mostrado no card "Sessão" do mega menu. */
  toolCount: number
  pcName?: string | null
  onExit?: () => void
  onEnterBigPicture?: () => void
  /** Abre a busca global existente (o App é dono do estado `searchOpen`). */
  onOpenSearch: () => void
  /** Faixa de atualização (App decide quando existe e quando foi adiada). */
  updateBanner?: ReactNode
  /**
   * Sem padding interno e sem rolagem: usado só pela página Chat, cujo
   * <webview> ocupa a área toda (p-8/overflow-y-auto quebrariam o tamanho).
   */
  fullBleed?: boolean
}

/**
 * Shell do Hub — moldura horizontal "Estação": titlebar 40 px, topbar 56 px
 * com mega menu e conteúdo em largura total. A topbar fica FORA do container
 * rolável; só o `<main>` rola.
 */
export function Layout({
  children,
  currentPage,
  onNavigate,
  runningCount,
  toolCount,
  pcName,
  onExit,
  onEnterBigPicture,
  onOpenSearch,
  updateBanner,
  fullBleed = false
}: LayoutProps): JSX.Element {
  return (
    <div className="h-screen flex flex-col">
      {/* ── Skip-link (WCAG 2.4.1): primeiro elemento tabular; só visível com
          foco de teclado. Fora da tela por transform (sem sr-only, para a
          transição/foco serem determinísticos). Alvo: <main id="conteudo">. ── */}
      <a
        href="#conteudo"
        className="absolute left-4 top-2 z-[110] -translate-y-[200%] rounded-control border border-[var(--border-strong)] bg-surface-3 px-4 py-2 text-sm font-semibold text-ink-primary shadow-elevation-2 transition-transform duration-2 ease-standard focus:translate-y-0 motion-reduce:transition-none"
      >
        Pular para o conteúdo
      </a>
      {/* ── Title bar (40 px): marca · nome do PC · controles da janela ── */}
      <div className="title-bar flex h-10 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-surface-sunken pl-4 pr-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent">
            <Zap size={13} className="text-accent-contrast" aria-hidden="true" />
          </div>
          <span className="shrink-0 text-[13px] font-semibold tracking-tight text-ink-primary">
            Kolnd Hub
          </span>
          {pcName && (
            <span
              className="flex min-w-0 items-center gap-1.5 rounded-pill border border-[var(--border-subtle)] bg-surface-1 px-2 py-0.5 text-[10.5px] text-ink-tertiary"
              title={pcName}
            >
              <Monitor size={11} aria-hidden="true" className="shrink-0" />
              <span className="max-w-[180px] truncate">{pcName}</span>
            </span>
          )}
        </div>

        {/* Window controls */}
        <div className="title-bar-no-drag flex shrink-0 items-center gap-1">
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

      {/* ── Topbar (56 px): navegação horizontal, status, busca, BP e mega ── */}
      <Topbar
        currentPage={currentPage}
        onNavigate={onNavigate}
        runningCount={runningCount}
        toolCount={toolCount}
        pcName={pcName}
        onOpenSearch={onOpenSearch}
        onExit={onExit}
        onEnterBigPicture={onEnterBigPicture}
      />

      {/* Faixa de atualização: fica fora do <main> rolável, logo abaixo da topbar. */}
      {updateBanner}

      {/* ── Main content area — largura total, único container rolável ── */}
      {/* tabIndex={-1}: permite o skip-link levar o foco para o conteúdo por teclado */}
      <main
        id="conteudo"
        tabIndex={-1}
        className={fullBleed ? 'flex-1 overflow-hidden p-0' : 'flex-1 overflow-y-auto p-8 pb-12'}
      >
        {children}
      </main>
    </div>
  )
}
