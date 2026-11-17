import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Gamepad2, Search } from 'lucide-react'
import { MegaMenu } from './MegaMenu'
import { Badge, IconButton } from './ui'
import type { Page } from '../types'

export interface TopbarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  runningCount: number
  /** Total de ferramentas configuradas — mesmo número do card "Sessão" do mega. */
  toolCount: number
  pcName?: string | null
  onOpenSearch: () => void
  onExit?: () => void
  onEnterBigPicture?: () => void
}

// Ordem da topbar (plano 3.1): Ferramentas · Biblioteca · Meu PC · Configurações.
// O nome real do PC fica na titlebar e no mega menu — aqui o rótulo é estável.
const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Ferramentas' },
  { id: 'biblioteca', label: 'Biblioteca' },
  { id: 'inicializacao', label: 'Meu PC' },
  { id: 'settings', label: 'Configurações' }
]

const MENU_ID = 'topbar-mais-menu'

/**
 * Topbar do shell "Estação" (56 px): navegação horizontal, status de ativos,
 * busca global, Big Picture e o botão "Mais" que abre o mega menu.
 * Todos os destinos/ações já existiam na sidebar — nenhuma rota nova.
 */
export function Topbar({
  currentPage,
  onNavigate,
  runningCount,
  toolCount,
  pcName,
  onOpenSearch,
  onExit,
  onEnterBigPicture
}: TopbarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Fecha o mega menu. `restoreFocus` devolve o foco ao botão "Mais" (Esc e
  // escolha de um item por teclado); clique fora não rouba o foco do alvo.
  const closeMenu = (restoreFocus: boolean): void => {
    setMenuOpen(false)
    if (restoreFocus) menuButtonRef.current?.focus()
  }

  // Fechamento do mega: Esc devolve o foco ao botão "Mais"; clique fora só fecha.
  // O pointerdown ignora o próprio botão para o toggle do clique não ser cancelado.
  useEffect(() => {
    if (!menuOpen) return

    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target)) return
      if (menuButtonRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return (): void => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <header className="relative z-chrome flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-surface-1 pl-4 pr-2 min-[980px]:pl-5 min-[980px]:pr-3">
      {/* ── Navegação principal ───────────────────────────── */}
      <nav aria-label="Navegação principal" className="flex h-full items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = currentPage === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex h-full items-center px-2.5 text-[12.5px] font-medium transition-colors duration-1 min-[1100px]:px-3.5 ${
                active
                  ? 'text-ink-primary'
                  : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
              }`}
            >
              {item.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-pill bg-accent"
                />
              )}
            </button>
          )
        })}
      </nav>

      {/* ── Status · busca · Big Picture · Mais ───────────── */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* aria-live preserva o anúncio do badge de ativos que vivia na titlebar */}
        <Badge
          tone={runningCount > 0 ? 'success' : 'neutral'}
          role="status"
          aria-live="polite"
          className="px-2 py-1 min-[1100px]:px-2.5"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-pill ${
              runningCount > 0 ? 'bg-success' : 'bg-ink-tertiary'
            }`}
          />
          <span className="tnum">
            {runningCount} ativo{runningCount === 1 ? '' : 's'}
          </span>
        </Badge>

        {/* Abaixo de 1100 px vira só ícone (aria-label mantém o nome acessível) */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Buscar no Hub (atalho /)"
          className="flex h-9 items-center gap-1.5 rounded-control border border-[var(--border-subtle)] bg-surface-sunken px-2 text-[12.5px] text-ink-secondary transition-colors duration-1 hover:border-[var(--border-strong)] hover:text-ink-primary min-[1100px]:px-2.5"
        >
          <Search size={15} aria-hidden="true" />
          <span className="hidden min-[1100px]:inline">Buscar…</span>
          <kbd className="hidden rounded-sm border border-[var(--border-subtle)] bg-surface-2 px-1 text-[10px] font-bold text-ink-tertiary min-[1100px]:inline">
            /
          </kbd>
        </button>

        {/* Big Picture sai da topbar abaixo de 980 px — continua no mega menu */}
        {onEnterBigPicture && (
          <IconButton
            size="sm"
            onClick={onEnterBigPicture}
            aria-label="Entrar no modo Big Picture"
            className="hidden min-[980px]:inline-flex"
          >
            <Gamepad2 size={16} />
          </IconButton>
        )}

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-controls={MENU_ID}
          className={`flex h-9 items-center gap-1 rounded-control border px-2.5 text-[12.5px] font-medium transition-colors duration-1 ${
            menuOpen
              ? 'border-[var(--border-strong)] bg-surface-2 text-ink-primary'
              : 'border-[var(--border-subtle)] text-ink-secondary hover:border-[var(--border-strong)] hover:text-ink-primary'
          }`}
        >
          Mais
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`transition-transform duration-2 motion-reduce:transition-none ${menuOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {menuOpen && (
        <MegaMenu
          ref={menuRef}
          id={MENU_ID}
          currentPage={currentPage}
          pcName={pcName}
          runningCount={runningCount}
          toolCount={toolCount}
          onNavigate={onNavigate}
          onOpenSearch={onOpenSearch}
          onExit={onExit}
          onEnterBigPicture={onEnterBigPicture}
          onClose={() => closeMenu(true)}
        />
      )}
    </header>
  )
}
