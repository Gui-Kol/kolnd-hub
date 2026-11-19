import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { Activity, Cpu, Gamepad2, Wifi, Code, Clock, LayoutGrid, AppWindow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AppCard } from './AppCard'
import { AppDetailModal } from './AppDetailModal'
import { RemoteHelpModal } from './RemoteHelpModal'
import { OpenOfficeCard } from './office/OpenOfficeCard'
import { Badge, EmptyState } from './ui'
import { AppConfig, AppState } from '../types'
import type { RemoteModeReason } from '../../../shared/remote'
import { bestRemoteAddress, parseRemoteStatus } from '../lib/remoteAccess'

interface DashboardProps {
  apps: AppConfig[]
  appStates: Record<string, AppState>
  onLaunch: (app: AppConfig) => void
  onStop: (appId: string) => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
  /** Navega para Configurações (seção Acesso remoto) a partir da ajuda. */
  onOpenSettings: () => void
  /** Navega para a página OpenOffice (card do grupo Inteligência Artificial). */
  onOpenOffice: () => void
}

const KLOUD_APP_ID = 'kloud-games'

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

export function Dashboard({
  apps,
  appStates,
  onLaunch,
  onStop,
  onToast,
  onOpenSettings,
  onOpenOffice
}: DashboardProps): JSX.Element {
  const [selectedApp, setSelectedApp] = useState<AppConfig | null>(null)
  // Entradas decorativas (header, grupos em cascata, cards) viram fade curto com reduce.
  const reduced = useReducedMotion()
  // Modo remoto do Kloud Games: lido do store (null = carregando).
  const [remoteMode, setRemoteMode] = useState<boolean | null>(null)
  const [remoteAddress, setRemoteAddress] = useState<string | null>(null)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [remoteHelp, setRemoteHelp] = useState<{ blockedReason?: RemoteModeReason } | null>(null)

  const kloudApp = apps.find((app) => app.id === KLOUD_APP_ID) ?? null
  const kloudRunning = appStates[KLOUD_APP_ID]?.status === 'running'

  // Estado inicial do modo remoto (persistido). Se estiver ligado, busca o
  // endereço da rede ZeroTier para exibir no card — sem polling.
  useEffect(() => {
    let alive = true
    window.api
      .remoteGetMode()
      .then(async (enabled) => {
        if (!alive) return
        setRemoteMode(enabled)
        if (!enabled) return
        try {
          const parsed = parseRemoteStatus(await window.api.remoteStatus())
          // Só exibe um endereço utilizável: se o ZeroTier caiu/saiu da rede
          // depois de ligar o modo, o card mostra o aviso de desconectado.
          if (alive && parsed) {
            setRemoteAddress(parsed.zerotier.connected ? bestRemoteAddress(parsed.zerotier) : null)
          }
        } catch {
          // Mantém o modo; a UI avisa que o ZeroTier está desconectado.
        }
      })
      .catch(() => {
        if (alive) setRemoteMode(false)
      })
    return (): void => {
      alive = false
    }
  }, [])

  const handleToggleRemote = async (): Promise<void> => {
    if (remoteMode === null || remoteBusy) return
    const next = !remoteMode
    setRemoteBusy(true)
    try {
      const result = await window.api.remoteSetMode(next)
      if (!result.success) {
        // O main recusou (sem ZeroTier instalado/conectado): volta ao estado
        // real e abre a ajuda já explicando o que falta.
        setRemoteMode(false)
        setRemoteAddress(null)
        setRemoteHelp({ blockedReason: result.reason })
        return
      }
      setRemoteMode(result.enabled)
      setRemoteAddress(result.address ?? null)
      onToast?.(
        result.enabled
          ? result.address
            ? `Modo remoto ativado — use ${result.address} no Moonlight.`
            : 'Modo remoto ativado.'
          : 'Modo remoto desativado (o ZeroTier continua conectado).',
        'success'
      )
      if (result.enabled && !kloudRunning) {
        onToast?.('Inicie o Kloud Games para receber conexões remotas.', 'info')
      }
    } catch {
      onToast?.('Não foi possível alterar o modo remoto.', 'error')
    } finally {
      setRemoteBusy(false)
    }
  }

  const runningCount = Object.values(appStates).filter((s) => s.status === 'running').length
  const stoppedCount = apps.length - runningCount

  // Assinatura B (aprovada em 13.2; realçada no refresh do Modelo 03): gradiente
  // 120° derivado da cor do app em foco — primeiro app em execução, senão o primeiro.
  const focusedApp = apps.find((a) => appStates[a.id]?.status === 'running') ?? apps[0]
  const heroFrom = focusedApp ? hexWithAlpha(focusedApp.color, 0.16) : null
  const heroMid = focusedApp ? hexWithAlpha(focusedApp.color, 0.05) : null
  const heroBackground =
    heroFrom && heroMid
      ? `linear-gradient(120deg, ${heroFrom} 0%, ${heroMid} 45%, transparent 72%), var(--surface-1)`
      : 'var(--surface-1)'

  const categories = ['ai', 'gaming', 'streaming', 'dev'] as const
  const groupedApps = categories
    .map((cat) => ({
      category: cat,
      ...categoryMeta[cat],
      apps: apps.filter((a) => a.category === cat)
    }))
    // IA nunca some: o card do OpenOffice mora nesse grupo mesmo sem apps de IA.
    .filter((g) => g.category === 'ai' || g.apps.length > 0)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ── Header-hero (assinatura B, refresh Modelo 03) ── */}
      <motion.header
        {...entranceProps(reduced, { y: -10 })}
        className="overflow-hidden rounded-card border border-[var(--border-subtle)]"
        style={{ background: heroBackground }}
      >
        <div className="flex flex-col justify-between gap-5 px-6 pb-6 pt-7 sm:px-8 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
              Central de controle
            </p>
            <h2 className="mt-2 text-[32px] font-bold leading-10 tracking-tight text-ink-primary md:text-[36px] md:leading-[44px]">
              Ferramentas
            </h2>
            <p className="mt-1.5 max-w-xl text-[13.5px] leading-5 text-ink-secondary">
              Seus programas do ecossistema, num só lugar
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            {/* Latência é decorativa e mantida por paridade (13.9) — agora em chip */}
            <Badge
              tone="neutral"
              className="px-3 py-1 text-[11px]"
              aria-label="Latência 12 milissegundos"
            >
              <Clock size={12} aria-hidden="true" />
              <span className="tnum">12 ms</span>
            </Badge>
          </div>
        </div>

        {/* Faixa de status: estado geral + quantos estão offline (a latência
            saiu daqui para o chip acima, sem duplicar o dado). */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] px-6 py-3 text-xs text-ink-secondary sm:px-8"
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
        </div>
      </motion.header>

      {/* ── Estado vazio (apps não configurados) ────────── */}
      {apps.length === 0 && (
        <EmptyState
          icon={AppWindow}
          tone="muted"
          title="Nenhum programa configurado"
          hint="Configure em Configurações para adicionar os programas do ecossistema."
        />
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
                {group.apps.length + (group.category === 'ai' ? 1 : 0)}
              </span>
              <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
            </div>

            {/* Cards em grade */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.category === 'ai' && (
                <OpenOfficeCard onOpen={onOpenOffice} delay={0.15 + gi * 0.05} />
              )}
              {group.apps.map((app, i) => (
                <AppCard
                  key={app.id}
                  app={app}
                  state={appStates[app.id]}
                  onLaunch={() => onLaunch(app)}
                  onStop={() => onStop(app.id)}
                  onClick={() => setSelectedApp(app)}
                  delay={0.15 + gi * 0.05 + i * 0.03}
                  remote={
                    app.id === KLOUD_APP_ID
                      ? {
                          enabled: remoteMode === true,
                          loading: remoteMode === null,
                          busy: remoteBusy,
                          address: remoteAddress,
                          onToggle: () => void handleToggleRemote(),
                          onHelp: () => setRemoteHelp({})
                        }
                      : undefined
                  }
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

      {/* ── Ajuda: conectar no Moonlight (local/remoto) ── */}
      {remoteHelp && (
        <RemoteHelpModal
          blockedReason={remoteHelp.blockedReason}
          kloudRunning={kloudRunning}
          onStartKloud={() => {
            if (kloudApp) onLaunch(kloudApp)
          }}
          onOpenSettings={() => {
            setRemoteHelp(null)
            onOpenSettings()
          }}
          onClose={() => setRemoteHelp(null)}
          onToast={onToast}
        />
      )}
    </div>
  )
}
