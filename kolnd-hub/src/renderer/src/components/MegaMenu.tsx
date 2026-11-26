import { forwardRef } from 'react'
import { motion } from 'framer-motion'
import { Gamepad2, LogOut, MessagesSquare, Monitor, Search, Settings, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useReducedMotion } from '../lib/motion'
import { Button } from './ui'
import type { Page } from '../types'

/**
 * Item do mega menu — modelo único de dados (id, rótulo, descrição, ícone e ação).
 * Colunas futuras reutilizam esta lista; nenhum item é criado fora dela.
 */
export interface MegaMenuItem {
  id: string
  label: string
  description?: string
  icon: LucideIcon
  /** Destino de navegação: recebe o realce de item ativo da topbar. */
  page?: Page
  /** Atalho real do app exibido à direita (hoje só a busca tem um). */
  kbd?: string
  tone?: 'danger'
  action: () => void
}

export interface MegaMenuProps {
  /** Id referenciado pelo `aria-controls` do botão "Mais". */
  id: string
  currentPage: Page
  pcName?: string | null
  runningCount: number
  /** Total de ferramentas configuradas (mesmo `apps.length` do Dashboard). */
  toolCount: number
  onNavigate: (page: Page) => void
  onOpenSearch: () => void
  onExit?: () => void
  onEnterBigPicture?: () => void
  /** Fecha o menu; o Topbar decide o que fazer com o foco. */
  onClose: () => void
}

/**
 * Mega menu do botão "Mais" — três colunas (Navegação · Ações · Status) ancoradas
 * à direita da topbar. Só itens que existem de fato no app; nada de "em breve".
 * Não é modal: sem scrim e sem focus trap — Tab percorre, Esc fecha.
 */
export const MegaMenu = forwardRef<HTMLDivElement, MegaMenuProps>(function MegaMenu(
  {
    id,
    currentPage,
    pcName,
    runningCount,
    toolCount,
    onNavigate,
    onOpenSearch,
    onExit,
    onEnterBigPicture,
    onClose
  }: MegaMenuProps,
  ref
): JSX.Element {
  // Abertura ≤180 ms; com reduce vira fade curto sem deslocamento.
  const reduced = useReducedMotion()

  const navigation: MegaMenuItem[] = [
    {
      id: 'dashboard',
      label: 'Ferramentas',
      description: 'Programas do ecossistema',
      icon: Wrench,
      page: 'dashboard',
      action: () => onNavigate('dashboard')
    },
    {
      id: 'biblioteca',
      label: 'Biblioteca',
      description: 'Jogos instalados',
      icon: Gamepad2,
      page: 'biblioteca',
      action: () => onNavigate('biblioteca')
    },
    {
      id: 'chat',
      label: 'Chat',
      description: 'Grupos e salas do Go Live',
      icon: MessagesSquare,
      page: 'chat',
      action: () => onNavigate('chat')
    },
    {
      id: 'inicializacao',
      label: pcName ?? 'Meu PC',
      description: 'Manutenção e inicialização',
      icon: Monitor,
      page: 'inicializacao',
      action: () => onNavigate('inicializacao')
    },
    {
      id: 'settings',
      label: 'Configurações',
      description: 'Comandos e diretórios',
      icon: Settings,
      page: 'settings',
      action: () => onNavigate('settings')
    }
  ]

  // Ações reais do app. Big Picture só aparece quando existe entrada (o App
  // oculta em ?first-run=1), mesmo comportamento do botão antigo da sidebar.
  const actions: MegaMenuItem[] = [
    {
      id: 'search',
      label: 'Buscar no Hub',
      description: 'Apps e jogos',
      icon: Search,
      kbd: '/',
      action: onOpenSearch
    },
    ...(onEnterBigPicture
      ? [
          {
            id: 'big-picture',
            label: 'Big Picture',
            description: 'Modo console com gamepad',
            icon: Gamepad2,
            action: onEnterBigPicture
          }
        ]
      : []),
    ...(onExit
      ? [
          {
            id: 'exit',
            label: 'Encerrar Hub',
            description: 'Fecha tudo e encerra',
            icon: LogOut,
            tone: 'danger' as const,
            action: onExit
          }
        ]
      : [])
  ]

  // Fecha antes de agir: o menu some e a ação (navegar/buscar/sair) segue no App.
  const runItem = (item: MegaMenuItem): void => {
    onClose()
    item.action()
  }

  const renderItem = (item: MegaMenuItem): JSX.Element => {
    const Icon = item.icon
    const active = item.page !== undefined && item.page === currentPage
    const toneClass =
      item.tone === 'danger'
        ? 'text-danger hover:bg-danger-bg hover:text-danger'
        : active
          ? 'bg-surface-2 text-ink-primary'
          : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => runItem(item)}
        aria-current={active ? 'page' : undefined}
        className={`relative flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors duration-1 ${toneClass}`}
      >
        {active && (
          <span
            aria-hidden="true"
            className="absolute inset-y-2 left-0 w-[2px] rounded-pill bg-accent"
          />
        )}
        <Icon
          size={16}
          aria-hidden="true"
          className={`mt-0.5 shrink-0 ${active ? 'text-accent' : ''}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-4">{item.label}</span>
          {item.description && (
            <span className="mt-0.5 block truncate text-[10.5px] leading-[14px] text-ink-tertiary">
              {item.description}
            </span>
          )}
        </span>
        {item.kbd && (
          <kbd className="mt-0.5 shrink-0 rounded-sm border border-[var(--border-subtle)] bg-surface-2 px-1 text-[10px] font-bold text-ink-tertiary">
            {item.kbd}
          </kbd>
        )}
      </button>
    )
  }

  return (
    <motion.div
      ref={ref}
      id={id}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.12 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="absolute right-3 top-[calc(100%+6px)] z-dropdown max-h-[calc(100vh-120px)] w-[900px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-card border border-[var(--border-strong)] bg-surface-1 p-4 shadow-elevation-3"
    >
      <div className="grid grid-cols-2 gap-4 min-[1100px]:grid-cols-[1.05fr_1fr_0.9fr]">
        {/* ── Navegação ───────────────────────────────── */}
        <div>
          <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            Navegação
          </p>
          <div className="space-y-0.5">{navigation.map(renderItem)}</div>
        </div>

        {/* ── Ações reais ─────────────────────────────── */}
        <div>
          <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            Ações
          </p>
          <div className="space-y-0.5">{actions.map(renderItem)}</div>
        </div>

        {/* ── Status da sessão (largura inteira abaixo de 1100 px) ── */}
        <div className="col-span-2 min-[1100px]:col-span-1">
          <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
            Status
          </p>
          <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
              Sessão
            </p>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="tnum text-2xl font-semibold leading-none text-ink-primary">
                {runningCount}
              </span>
              <span className="text-[11px] text-ink-secondary">de {toolCount} ferramentas</span>
            </p>
            <p className="mt-1 text-[10.5px] text-ink-tertiary">
              {runningCount > 0 ? 'em execução' : 'nenhuma em execução'}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              onClick={() => {
                onClose()
                onNavigate('dashboard')
              }}
            >
              <Wrench size={13} aria-hidden="true" />
              Ver ferramentas
            </Button>
          </div>
        </div>
      </div>

      {/* Rodapé com versão (antes no rodapé da sidebar) */}
      <p className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-center text-[10px] text-ink-tertiary">
        Kolnd Hub · v{__APP_VERSION__}
      </p>
    </motion.div>
  )
})
