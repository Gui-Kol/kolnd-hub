import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { Activity, Cpu, Gamepad2, Wifi, Code, Clock, LayoutGrid, AppWindow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AppCard } from './AppCard'
import { AppDetailModal } from './AppDetailModal'
import { RemoteHelpModal } from './RemoteHelpModal'
import { Badge, EmptyState } from './ui'
import { AppConfig, AppState, Game } from '../types'
import type { RemoteModeReason, ZeroTierInfo } from '../../../shared/remote'
import { bestRemoteAddress, parseRemoteStatus } from '../lib/remoteAccess'
import { formatLastPlayed, recentGames } from '../lib/gameStats'
import {
  nextIconRetryIds,
  pruneIconsForReload,
  requestIconsForIds,
  retryDelayForAttempt
} from '../lib/libraryIcons'

interface DashboardProps {
  apps: AppConfig[]
  appStates: Record<string, AppState>
  onLaunch: (app: AppConfig) => void
  onStop: (appId: string) => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
  /** Navega para Configurações (seção Acesso remoto) a partir da ajuda. */
  onOpenSettings: () => void
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
  onOpenSettings
}: DashboardProps): JSX.Element {
  const [selectedApp, setSelectedApp] = useState<AppConfig | null>(null)
  // Entradas decorativas (header, grupos em cascata, cards) viram fade curto com reduce.
  const reduced = useReducedMotion()
  // Modo remoto do Kloud Games: lido do store (null = carregando).
  const [remoteMode, setRemoteMode] = useState<boolean | null>(null)
  const [remoteAddress, setRemoteAddress] = useState<string | null>(null)
  const [remoteZeroTier, setRemoteZeroTier] = useState<ZeroTierInfo | null>(null)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [remoteInstalling, setRemoteInstalling] = useState(false)
  const [remoteHelp, setRemoteHelp] = useState<{ blockedReason?: RemoteModeReason } | null>(null)
  // "Continuar jogando" (T5): o Dashboard busca os jogos sozinho (sem tocar no
  // App.tsx). A faixa some por completo quando não há `lastPlayedAt`.
  const [recent, setRecent] = useState<Game[]>([])
  const [recentIcons, setRecentIcons] = useState<Record<string, string | null>>({})
  const recentIconRequests = useRef<Set<string>>(new Set())
  // Retentativa com backoff: tentativas por id e timers pendentes.
  const recentIconRetryAttempts = useRef<Map<string, number>>(new Map())
  const recentIconRetryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // `true` enquanto o Dashboard está montado. Respostas de IPC antigas NÃO podem
  // ser descartadas só porque o estado mudou: o cleanup de um efeito roda a cada
  // re-render e era o que deixava os cards da faixa sem ícone.
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return (): void => {
      mountedRef.current = false
    }
  }, [])
  const [recentCovers, setRecentCovers] = useState<Record<string, string | null>>({})
  const recentCoverRequests = useRef<Set<string>>(new Set())

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
            setRemoteZeroTier(parsed.zerotier)
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

  // Cancela timer e zera tentativas de um id (ícone chegou).
  const clearRecentIconRetry = useCallback((id: string): void => {
    const timer = recentIconRetryTimers.current.get(id)
    if (timer) clearTimeout(timer)
    recentIconRetryTimers.current.delete(id)
    recentIconRetryAttempts.current.delete(id)
  }, [])

  const clearAllRecentIconRetries = useCallback((): void => {
    for (const timer of recentIconRetryTimers.current.values()) clearTimeout(timer)
    recentIconRetryTimers.current.clear()
    recentIconRetryAttempts.current.clear()
  }, [])

  // Jogos recentes + manutenção dos ícones em segundo plano, uma vez por
  // montagem. Falha silenciosa: a faixa simplesmente não aparece se o IPC falhar.
  // Ao fim do reload, `null`/SVG gerado são descartados para os cards da faixa
  // se atualizarem sem sair da tela.
  const recentReloadDone = useRef(false)

  useEffect(() => {
    let alive = true
    const run = async (): Promise<void> => {
      try {
        const list = await window.api.getGames()
        if (!alive) return
        setRecent(recentGames(list, 6))
      } catch {
        if (!alive) return
        setRecent([])
      }
      if (!recentReloadDone.current) {
        recentReloadDone.current = true
        try {
          await window.api.reloadGameIcons()
        } catch {
          // Recarregar ícones é opcional — a faixa deve aparecer de qualquer jeito.
        }
        if (!alive) return
        clearAllRecentIconRetries()
        recentIconRequests.current.clear()
        recentCoverRequests.current.clear()
        // Re-pede null (sem ícone) e SVG gerado (upgrade para arte real).
        setRecentIcons((prev) => pruneIconsForReload(prev))
        // Capas: só o `null` (sem capa) precisa ser re-pedido.
        setRecentCovers((prev) => {
          const next = { ...prev }
          let changed = false
          for (const [id, value] of Object.entries(prev)) {
            if (value !== null) continue
            delete next[id]
            changed = true
          }
          return changed ? next : prev
        })
      }
    }
    void run()
    return (): void => {
      alive = false
    }
  }, [clearAllRecentIconRetries])

  // Busca os ícones dos jogos recentes que ainda não estão cacheados. A decisão
  // de aplicar é o `mountedRef` — re-render nenhum descarta respostas em voo.
  useEffect(() => {
    const pendingIds = recent
      .filter((game) => !(game.id in recentIcons) && !recentIconRequests.current.has(game.id))
      .map((game) => game.id)
    if (pendingIds.length === 0) return
    for (const id of pendingIds) recentIconRequests.current.add(id)

    void requestIconsForIds(pendingIds, {
      fetchIcon: (id) => window.api.getGameIcon(id),
      apply: (id, dataUrl) => {
        if (dataUrl) clearRecentIconRetry(id)
        setRecentIcons((prev) => ({ ...prev, [id]: dataUrl }))
      },
      onSettled: (id, dataUrl) => {
        // Falha/ausência: libera o id para uma nova tentativa.
        if (!dataUrl) recentIconRequests.current.delete(id)
      },
      isMounted: () => mountedRef.current
    })
  }, [recent, recentIcons, clearRecentIconRetry])

  // Retentativa com backoff (1 s, 2 s, 4 s) para ids que voltaram `null`.
  const scheduleRecentIconRetry = useCallback((id: string): void => {
    if (recentIconRetryTimers.current.has(id)) return
    const attempt = (recentIconRetryAttempts.current.get(id) ?? 0) + 1
    const delay = retryDelayForAttempt(attempt)
    if (delay === null) return
    recentIconRetryAttempts.current.set(id, attempt)
    const timer = setTimeout(() => {
      recentIconRetryTimers.current.delete(id)
      window.api
        .getGameIcon(id)
        .then((dataUrl) => {
          if (!mountedRef.current) return
          if (dataUrl) recentIconRetryAttempts.current.delete(id)
          setRecentIcons((prev) => {
            if (!dataUrl) return { ...prev, [id]: null }
            return prev[id] === dataUrl ? prev : { ...prev, [id]: dataUrl }
          })
        })
        .catch(() => {
          if (!mountedRef.current) return
          setRecentIcons((prev) => ({ ...prev, [id]: null }))
        })
    }, delay)
    recentIconRetryTimers.current.set(id, timer)
  }, [])

  useEffect(() => {
    const retryIds = nextIconRetryIds(
      recent,
      recentIcons,
      recentIconRetryAttempts.current,
      new Set(recentIconRetryTimers.current.keys())
    )
    for (const id of retryIds) scheduleRecentIconRetry(id)
  }, [recent, recentIcons, scheduleRecentIconRetry])

  // Cancela todos os timers ao desmontar (sem setState depois).
  useEffect(() => () => clearAllRecentIconRetries(), [clearAllRecentIconRetries])

  // Capas: mesma estratégia dos ícones (`mountedRef` + liberação em falha).
  useEffect(() => {
    const pendingIds = recent
      .filter((game) => !(game.id in recentCovers) && !recentCoverRequests.current.has(game.id))
      .map((game) => game.id)
    if (pendingIds.length === 0) return
    for (const id of pendingIds) recentCoverRequests.current.add(id)

    void requestIconsForIds(pendingIds, {
      fetchIcon: (id) => window.api.getGameCover(id),
      apply: (id, dataUrl) => {
        setRecentCovers((prev) => ({ ...prev, [id]: dataUrl }))
      },
      onSettled: (id, dataUrl) => {
        if (!dataUrl) recentCoverRequests.current.delete(id)
      },
      isMounted: () => mountedRef.current
    })
  }, [recent, recentCovers])

  const handleContinueGame = async (game: Game): Promise<void> => {
    try {
      const result = await window.api.launchGame(game.id)
      if (!result.ok) {
        onToast?.(
          `Não foi possível iniciar ${game.name}: ${result.error ?? 'erro desconhecido'}`,
          'error'
        )
        return
      }
      if (result.focused) {
        onToast?.(`${game.name} já está aberto — trazendo a janela para frente.`, 'success')
        return
      }
      if (result.alreadyRunning) {
        onToast?.(`${game.name} já está em execução — aguarde a janela.`, 'info')
        return
      }
      onToast?.(`Iniciando ${game.name}…`, 'success')
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Não foi possível iniciar o jogo.', 'error')
    }
  }

  /** Relê o ZeroTier sem adivinhar: selo (serviço/GUI) e IP do card vêm daqui. */
  const syncRemoteStatus = async (): Promise<void> => {
    try {
      const parsed = parseRemoteStatus(await window.api.remoteStatus())
      if (!parsed) return
      setRemoteZeroTier(parsed.zerotier)
      setRemoteAddress(parsed.zerotier.connected ? bestRemoteAddress(parsed.zerotier) : null)
    } catch {
      // Mantém o último estado conhecido; o card avisa que está desconectado.
    }
  }

  const handleToggleRemote = async (): Promise<void> => {
    if (remoteMode === null || remoteBusy || remoteInstalling) return
    const next = !remoteMode
    setRemoteBusy(true)
    try {
      let result = await window.api.remoteSetMode(next)

      // D3: clique com ZeroTier ausente instala a última versão e re-tenta. Nada
      // instala sozinho — só neste clique explícito.
      if (!result.success && result.reason === 'zerotier-missing') {
        setRemoteInstalling(true)
        onToast?.('ZeroTier não encontrado — instalando a versão mais recente…', 'info')
        try {
          const installed = await window.api.remoteInstallZeroTier()
          if (!installed.success) {
            onToast?.(
              `Não foi possível instalar o ZeroTier: ${installed.error ?? 'erro desconhecido'}`,
              'error'
            )
            setRemoteHelp({ blockedReason: 'zerotier-missing' })
            return
          }
          onToast?.('ZeroTier instalado. Tentando ligar o modo remoto…', 'success')
          result = await window.api.remoteSetMode(true)
          if (!result.success) {
            setRemoteMode(false)
            await syncRemoteStatus()
            setRemoteHelp({ blockedReason: result.reason })
            return
          }

          setRemoteMode(true)
          setRemoteAddress(result.address ?? null)
          await syncRemoteStatus()
          onToast?.(
            result.address
              ? `Modo remoto ativado — use ${result.address} no Moonlight.`
              : 'Modo remoto ativado.',
            'success'
          )
          // Após instalar, o tutorial abre sozinho (D4) no passo de entrar na rede.
          setRemoteHelp({})
          return
        } finally {
          setRemoteInstalling(false)
        }
      }

      if (!result.success) {
        // O main recusou (sem rede conectada): volta ao estado real e abre o
        // tutorial já explicando o que falta.
        setRemoteMode(false)
        setRemoteAddress(null)
        setRemoteHelp({ blockedReason: result.reason })
        return
      }

      setRemoteMode(result.enabled)
      setRemoteAddress(result.address ?? null)
      if (result.enabled) await syncRemoteStatus()
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

  const handleCopyRemoteAddress = async (): Promise<void> => {
    if (!remoteAddress) return
    try {
      const result = await window.api.remoteCopy(remoteAddress)
      if (!result.success) throw new Error(result.error ?? 'Não foi possível copiar.')
      onToast?.(`IP do ZeroTier copiado: ${remoteAddress}`, 'success')
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Não foi possível copiar.', 'error')
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
    .filter((g) => g.apps.length > 0)

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

      {/* ── Continuar jogando (T5) ──────────────────────── */}
      {recent.length > 0 && (
        <motion.section
          aria-label="Continuar jogando"
          {...entranceProps(reduced, { y: 16 }, { delay: 0.08 })}
          className="space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--border-subtle)] bg-surface-2 text-accent">
              <Clock size={15} aria-hidden="true" />
            </div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
              Continuar jogando
            </h3>
            <span className="tnum rounded-pill border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-ink-tertiary">
              {recent.length}
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
          </div>

          <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
            {recent.map((game) => {
              const cover = recentCovers[game.id]
              const icon = recentIcons[game.id]
              const visual = cover ?? icon
              const lastPlayed = formatLastPlayed(game.lastPlayedAt)
              return (
                <button
                  key={game.id}
                  type="button"
                  onClick={() => void handleContinueGame(game)}
                  title={`Continuar ${game.name}`}
                  aria-label={`Continuar ${game.name}${lastPlayed ? ` — ${lastPlayed}` : ''}`}
                  className="group flex w-[148px] shrink-0 flex-col gap-2 rounded-card border border-[var(--border-subtle)] bg-surface-1 p-2 text-left shadow-elevation-1 transition-all duration-2 ease-standard hover:border-[var(--accent-border)] hover:bg-surface-2 hover:shadow-elevation-2"
                >
                  <span
                    className="flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-control border border-[var(--border-subtle)]"
                    style={{
                      background:
                        'linear-gradient(165deg, var(--accent-muted) 0%, transparent 75%), var(--surface-2)'
                    }}
                  >
                    {visual ? (
                      <img
                        src={visual}
                        alt={cover ? `Capa de ${game.name}` : `Ícone de ${game.name}`}
                        className={`h-full w-full ${cover ? 'object-cover' : 'object-contain'}`}
                        draggable={false}
                      />
                    ) : (
                      <Gamepad2
                        size={40}
                        aria-hidden="true"
                        className="text-ink-tertiary transition-colors duration-2 ease-standard group-hover:text-ink-secondary"
                      />
                    )}
                  </span>
                  <span className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-ink-primary">
                    {game.name}
                  </span>
                  {lastPlayed && (
                    <span className="text-[11px] text-ink-tertiary">{lastPlayed}</span>
                  )}
                </button>
              )
            })}
          </div>
        </motion.section>
      )}

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
                  remote={
                    app.id === KLOUD_APP_ID
                      ? {
                          enabled: remoteMode === true,
                          loading: remoteMode === null,
                          busy: remoteBusy,
                          installing: remoteInstalling,
                          address: remoteAddress,
                          zerotier: remoteZeroTier,
                          onToggle: () => void handleToggleRemote(),
                          onCopyAddress: () => void handleCopyRemoteAddress(),
                          onHelp: () => {
                            void syncRemoteStatus()
                            setRemoteHelp({})
                          }
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
