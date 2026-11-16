import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { Activity, Cpu, Gamepad2, Wifi, Code, Clock, LayoutGrid, AppWindow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AppCard } from './AppCard'
import { AppDetailModal } from './AppDetailModal'
import { Badge } from './ui'
import { AppConfig, AppState } from '../types'

interface DashboardProps {
  apps: AppConfig[]
  appStates: Record<string, AppState>
  onLaunch: (app: AppConfig) => void
  onStop: (appId: string) => void
}

// Grupos diferenciam-se por ÍCONE, não por cor saturada (13.9): ai→acento,
// demais→neutro. Todos os blocos são surface-2 com borda hairline — sem glow.
const categoryMeta: Record<string, { label: string; icon: LucideIcon; iconClass: string }> = {
  ai: {
    label: 'Inteligência Artificial',
    icon: Cpu,
    iconClass: 'text-accent'
  },
  gaming: {
    label: 'Gaming',
    icon: Gamepad2,
    iconClass: 'text-ink-secondary'
  },
  streaming: {
    label: 'Streaming',
    icon: Wifi,
    iconClass: 'text-ink-secondary'
  },
  dev: {
    label: 'Development',
    icon: Code,
    iconClass: 'text-ink-secondary'
  }
}

// Converte #rgb/#rrggbb em rgba() com o alpha pedido — usado pelo hero dinâmico.
// Cor fora do formato hex → null (o hero cai para surface-1 puro, sem gradiente).
function hexWithAlpha(hex: string | undefined, alpha: number): string | null {
  if (!hex) return null
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  let h = match[1]
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const int = parseInt(h, 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function Dashboard({ apps, appStates, onLaunch, onStop }: DashboardProps): JSX.Element {
  const [selectedApp, setSelectedApp] = useState<AppConfig | null>(null)
  // Entradas decorativas (header, grupos em cascata, cards) viram fade curto com reduce.
  const reduced = useReducedMotion()

  const runningCount = Object.values(appStates).filter((s) => s.status === 'running').length
  const stoppedCount = apps.length - runningCount

  // Assinatura B (aprovada em 13.2): gradiente 120° derivado da cor do app em foco —
  // primeiro app em execução, senão o primeiro app. Discreto (~10%/4% de opacidade).
  const focusedApp = apps.find((a) => appStates[a.id]?.status === 'running') ?? apps[0]
  const heroFrom = focusedApp ? hexWithAlpha(focusedApp.color, 0.1) : null
  const heroMid = focusedApp ? hexWithAlpha(focusedApp.color, 0.04) : null
  const heroBackground =
    heroFrom && heroMid
      ? `linear-gradient(120deg, ${heroFrom} 0%, ${heroMid} 38%, transparent 65%), var(--surface-1)`
      : 'var(--surface-1)'

  const categories = ['ai', 'gaming', 'streaming', 'dev'] as const
  const groupedApps = categories
    .map((cat) => ({
      category: cat,
      ...categoryMeta[cat],
      apps: apps.filter((a) => a.category === cat)
    }))
    .filter((g) => g.apps.length > 0)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ── Header-hero (assinatura B) ──────────────────── */}
      <motion.header
        {...entranceProps(reduced, { y: -10 })}
        className="overflow-hidden rounded-card border border-[var(--border-subtle)]"
        style={{ background: heroBackground }}
      >
        <div className="flex flex-col justify-between gap-4 px-6 pb-4 pt-5 md:flex-row md:items-end">
          <div>
            <h2 className="text-[28px] font-bold leading-9 tracking-tight text-ink-primary md:text-[32px] md:leading-10">
              Ferramentas
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-secondary">
              Seus programas do ecossistema, num só lugar
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral" className="px-3 py-1 text-[11px]">
              <LayoutGrid size={12} aria-hidden="true" />
              <span className="tnum">{apps.length} títulos</span>
            </Badge>
            <Badge
              tone={runningCount > 0 ? 'success' : 'neutral'}
              role="status"
              aria-live="polite"
              className="px-3 py-1 text-[11px]"
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-pill ${
                  runningCount > 0 ? 'animate-pulse bg-success' : 'bg-ink-tertiary'
                }`}
              />
              <span className="tnum">{runningCount} online</span>
            </Badge>
          </div>
        </div>

        {/* Faixa de status — "Latência: 12ms" é decorativa e mantida por paridade (13.9) */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] px-6 py-3 text-xs text-ink-secondary"
          aria-label="Status geral"
        >
          <span className="flex items-center gap-2">
            <Activity size={13} className="text-success" aria-hidden="true" />
            Todos os sistemas operacionais
          </span>
          <span aria-hidden="true" className="h-4 w-px bg-[var(--border-subtle)]" />
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-ink-tertiary" />
            <span>
              <span className="tnum font-semibold text-ink-primary">{stoppedCount}</span> offline
            </span>
          </span>
          <span aria-hidden="true" className="h-4 w-px bg-[var(--border-subtle)]" />
          <span className="flex items-center gap-2">
            <Clock size={13} className="text-ink-tertiary" aria-hidden="true" />
            Latência: <span className="tnum font-semibold text-ink-primary">12ms</span>
          </span>
        </div>
      </motion.header>

      {/* ── Estado vazio (apps não configurados) ────────── */}
      {apps.length === 0 && (
        <div className="rounded-card border border-[var(--border-subtle)] bg-surface-1 px-6 py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2">
            <AppWindow size={20} className="text-ink-secondary" aria-hidden="true" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-ink-primary">
            Nenhum programa configurado
          </h3>
          <p className="mt-1 text-sm text-ink-secondary">
            Configure em Configurações para adicionar os programas do ecossistema.
          </p>
        </div>
      )}

      {/* ── Grupos por categoria ─────────────────────────── */}
      {groupedApps.map((group, gi) => {
        const Icon = group.icon
        return (
          <motion.section
            key={group.category}
            aria-label={group.label}
            {...entranceProps(reduced, { y: 20 }, { delay: 0.1 + gi * 0.05 })}
            className="space-y-3"
          >
            {/* Cabeçalho do grupo: ícone em bloco surface-2, label caption, contador chip */}
            <div className="flex items-center gap-3">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--border-subtle)] bg-surface-2 ${group.iconClass}`}
              >
                <Icon size={15} aria-hidden="true" />
              </div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                {group.label}
              </h3>
              <span className="tnum rounded-pill border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-ink-tertiary">
                {group.apps.length}
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
            </div>

            {/* Cards em grade */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.apps.map((app, i) => (
                <AppCard
                  key={app.id}
                  app={app}
                  state={appStates[app.id]}
                  onLaunch={() => onLaunch(app)}
                  onStop={() => onStop(app.id)}
                  onClick={() => setSelectedApp(app)}
                  delay={0.15 + gi * 0.05 + i * 0.03}
                />
              ))}
            </div>
          </motion.section>
        )
      })}

      {/* ── Detalhe modal ────────────────────────────── */}
      <AnimatePresence>
        {selectedApp && (
          <AppDetailModal
            app={selectedApp}
            state={appStates[selectedApp.id]}
            onLaunch={() => onLaunch(selectedApp)}
            onStop={() => onStop(selectedApp.id)}
            onClose={() => setSelectedApp(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
