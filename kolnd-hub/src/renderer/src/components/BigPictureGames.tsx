import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Gamepad2, AlertTriangle, Library, Square, Star } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Game } from '../types'
import {
  useBigPictureFocus,
  useFocusedId,
  useFocusable,
  BP_FOCUS_RING,
  BP_FOCUSED_RING
} from './BigPictureFocus'
import { useWindowedGrid } from '../hooks/useWindowedGrid'
import { useGamesRunning } from '../hooks/useGamesRunning'
import { playSfx } from '../lib/sfx'
import {
  nextIconRetryIds,
  pruneIconsForReload,
  requestIconsForIds,
  retryDelayForAttempt
} from '../lib/libraryIcons'
import { announce, formatFocusItem } from '../lib/useAnnouncer'
import { Badge, Spinner } from './ui'

interface BigPictureGamesProps {
  /** Notificação amigável exibida no canto (toast local do Big Picture). */
  notify: (text: string) => void
}

interface GameCardProps {
  game: Game
  icon: string | null | undefined
  cover: string | null | undefined
  launching: boolean
  /** Há um processo do jogo aberto (habilita o botão "Encerrar"). */
  running: boolean
  onLaunch: (game: Game) => void
  onStop: (game: Game) => void
  /** Posição 1-based na grade (para o anúncio de leitor de tela). */
  position: number
  /** Total de jogos na grade (para o anúncio de leitor de tela). */
  total: number
}

/** Botão "Encerrar" do card — focável pelo controle, mas só quando o jogo está aberto. */
function CardStopButton({
  id,
  confirming,
  gameName,
  onActivate
}: {
  id: string
  confirming: boolean
  gameName: string
  onActivate: () => void
}): JSX.Element {
  const { ref, focused, focus } = useFocusable(id, () =>
    confirming ? `Confirmar encerramento de ${gameName}` : `Jogos, Encerrar ${gameName}`
  )

  // Tinta danger-muted assada sobre surface-1 (danger 12% + surface-1, opaca) —
  // equivalente exato ao valor que ficava hardcoded antes; a translúcida ficaria
  // abaixo de 4.5 para o rótulo "Confirmar?" (10px bold).
  return (
    <button
      ref={ref}
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onActivate()
      }}
      onMouseEnter={focus}
      onFocus={focus}
      title={confirming ? 'Pressione de novo para encerrar o jogo' : 'Encerrar jogo'}
      aria-label="Encerrar jogo"
      aria-pressed={confirming}
      className={`absolute top-3 right-3 z-10 inline-flex h-12 min-w-12 items-center justify-center rounded-control border px-2 transition-all duration-2 ease-standard cursor-pointer focus:outline-none ${BP_FOCUS_RING} ${
        confirming
          ? 'border-danger-border bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface-1))] text-danger'
          : focused
            ? `border-danger-border bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface-1))] text-danger ${BP_FOCUSED_RING}`
            : 'border-[var(--border-subtle)] bg-surface-2 text-ink-secondary hover:border-danger-border hover:text-danger'
      }`}
    >
      {confirming ? (
        <span className="text-[10px] 3xl:text-sm font-bold uppercase tracking-wide leading-tight text-center">
          Confirmar?
        </span>
      ) : (
        <Square size={16} strokeWidth={2.25} aria-hidden="true" />
      )}
    </button>
  )
}

/**
 * Card de jogo — `memo` de propósito: a grade re-renderiza a cada mudança de
 * janela/scroll, mas os cards fora do foco não podem pagar por isso. Todas as
 * props são estáveis (handlers vêm do pai via useCallback e recebem o jogo).
 *
 * O descritor do `useFocusable` continua re-registrado a cada render: com memo,
 * props iguais ⇒ a closure registrada já lê o estado atual (posição, total,
 * nome) — não fica obsoleta.
 */
const GameCard = memo(function GameCard({
  game,
  icon,
  cover,
  launching,
  running,
  onLaunch,
  onStop,
  position,
  total
}: GameCardProps): JSX.Element {
  const { ref, focused, focus } = useFocusable(`game:${game.id}`, () =>
    formatFocusItem('Jogos', position, total, game.name)
  )
  const { setFocusedId } = useBigPictureFocus()
  const [confirming, setConfirming] = useState(false)
  const confirmTimeoutRef = useRef<number | null>(null)

  // Jogo fechou (ou foi encerrado): sai do modo de confirmação.
  // (Ajuste de estado durante o render — padrão oficial "you might not need an effect".)
  const [prevRunning, setPrevRunning] = useState(running)
  if (running !== prevRunning) {
    setPrevRunning(running)
    if (!running) setConfirming(false)
  }

  useEffect(
    () => (): void => {
      if (confirmTimeoutRef.current !== null) window.clearTimeout(confirmTimeoutRef.current)
    },
    []
  )

  const activateStop = useCallback((): void => {
    if (!running) return
    if (!confirming) {
      playSfx('move')
      setConfirming(true)
      confirmTimeoutRef.current = window.setTimeout(() => setConfirming(false), 4000)
      announce(`Pressione de novo para encerrar ${game.name}`)
      return
    }
    if (confirmTimeoutRef.current !== null) {
      window.clearTimeout(confirmTimeoutRef.current)
      confirmTimeoutRef.current = null
    }
    setConfirming(false)
    onStop(game)
  }, [confirming, game, onStop, running])

  // Após encerrar, o botão some (jogo fechou): devolve o foco para o card.
  const handleStopClick = useCallback((): void => {
    activateStop()
    if (running) setFocusedId(`game:${game.id}`)
  }, [activateStop, game.id, running, setFocusedId])

  return (
    <div className="relative" data-windowed-item="">
      {running ? (
        <CardStopButton
          id={`game:stop:${game.id}`}
          confirming={confirming}
          gameName={game.name}
          onActivate={handleStopClick}
        />
      ) : (
        <span
          aria-hidden="true"
          title="O jogo não está em execução"
          className="absolute top-3 right-3 z-10 inline-flex h-12 min-w-12 cursor-not-allowed items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 p-2 text-ink-tertiary"
        >
          <Square size={16} strokeWidth={2.25} aria-hidden="true" />
        </span>
      )}
      <button
        ref={ref}
        type="button"
        onClick={() => onLaunch(game)}
        onMouseEnter={focus}
        onFocus={focus}
        disabled={launching}
        title={
          running ? `Jogar ${game.name} (já aberto — traz para a frente)` : `Jogar ${game.name}`
        }
        role="option"
        aria-selected={focused}
        aria-label={`Jogar ${game.name}`}
        aria-setsize={total}
        aria-posinset={position}
        className={`group flex h-full w-full flex-col items-center gap-5 rounded-card border bg-surface-1 p-6 pt-8 text-center shadow-elevation-1 transition-all duration-2 ease-standard hover:scale-[1.03] hover:border-[var(--accent-border)] hover:bg-surface-2 hover:shadow-elevation-2 disabled:opacity-70 min-h-[15rem] focus:outline-none ${BP_FOCUS_RING} focus-visible:scale-[1.03] ${
          focused
            ? `scale-[1.05] border-[var(--accent-border)] bg-surface-2 shadow-elevation-2 ${BP_FOCUSED_RING}`
            : 'border-[var(--border-subtle)]'
        }`}
      >
        {cover ? (
          <div className="aspect-[2/3] w-32 2xl:w-36 rounded-card border border-[var(--border-subtle)] bg-surface-2 flex items-center justify-center overflow-hidden shrink-0 transition-colors duration-2 ease-standard group-hover:border-[var(--accent-border)]">
            <img
              src={cover}
              alt={`Capa de ${game.name}`}
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
        ) : (
          <div className="w-32 h-32 2xl:w-36 2xl:h-36 rounded-card border border-[var(--border-subtle)] bg-surface-2 flex items-center justify-center overflow-hidden shrink-0 transition-colors duration-2 ease-standard group-hover:border-[var(--accent-border)]">
            {icon ? (
              <img
                src={icon}
                alt={`Capa de ${game.name}`}
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <Gamepad2
                size={56}
                strokeWidth={1.5}
                aria-hidden="true"
                className="text-ink-tertiary transition-colors duration-2 ease-standard group-hover:text-ink-secondary"
              />
            )}
          </div>
        )}
        <p className="w-full text-2xl 3xl:text-3xl font-semibold leading-snug tracking-tight text-ink-primary line-clamp-2 min-h-[3.5rem] 3xl:min-h-[4.5rem]">
          {game.name}
        </p>
        <span className="flex flex-wrap items-center justify-center gap-3">
          {running && (
            <span
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-pill border border-success-border bg-success-bg px-4 py-1.5 text-xs 3xl:text-base font-bold uppercase tracking-[0.2em] text-success"
              title="O jogo está aberto (processo detectado)"
            >
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success animate-pulse" />
              Em execução
            </span>
          )}
          {launching ? (
            <Badge tone="accent">
              <Spinner size={12} label="Iniciando…" />
              Iniciando…
            </Badge>
          ) : (
            // tone="neutral" do primitivo mede 3.76–4.12 (ink-tertiary) nos fundos
            // dos cards do BP; ink-secondary mantém a mesma linguagem discreta com AA (6.35–6.97).
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-[var(--border-subtle)] bg-white/[0.05] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
              {game.origin === 'steam'
                ? 'Steam'
                : game.origin === 'epic'
                  ? 'Epic Games'
                  : game.origin === 'minecraft'
                    ? 'Minecraft'
                    : 'Personalizado'}
            </span>
          )}
        </span>
      </button>
    </div>
  )
})

/** Botão "Tentar novamente" do estado de erro — focável pelo controle. */
function RetryButton({ onClick }: { onClick: () => void }): JSX.Element {
  const { ref, focused, focus } = useFocusable('games:retry', () => 'Jogos, Tentar novamente')
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={focus}
      onFocus={focus}
      className={`mt-2 inline-flex min-h-[3rem] items-center rounded-control border border-[var(--border-strong)] bg-surface-2 px-6 py-3 text-xl font-semibold text-ink-secondary transition-all duration-2 ease-standard hover:bg-surface-3 hover:text-ink-primary cursor-pointer focus:outline-none ${BP_FOCUS_RING} ${
        focused ? `${BP_FOCUSED_RING} text-ink-primary` : ''
      }`}
    >
      Tentar novamente
    </button>
  )
}

type GameFilterKind = 'all' | 'favorites' | 'recent'

/**
 * Chip da barra de filtros do Big Picture. Focável pelo controle e pelo
 * teclado (mesmo contrato do `useFocusable` dos cards).
 */
function FilterChip({
  id,
  label,
  active,
  onSelect,
  icon: Icon
}: {
  id: string
  label: string
  active: boolean
  onSelect: () => void
  icon?: LucideIcon
}): JSX.Element {
  const { ref, focused, focus } = useFocusable(id, () => `Jogos, Filtro ${label}`)
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      onMouseEnter={focus}
      onFocus={focus}
      className={`inline-flex min-h-[2.75rem] items-center gap-2 rounded-pill border px-4 py-2 text-sm font-semibold transition-all duration-2 ease-standard focus:outline-none ${BP_FOCUS_RING} ${
        active
          ? 'border-[var(--accent-border)] bg-accent-muted text-ink-primary'
          : 'border-[var(--border-subtle)] bg-surface-1 text-ink-secondary hover:border-[var(--border-strong)] hover:text-ink-primary'
      } ${focused ? BP_FOCUSED_RING : ''}`}
    >
      {Icon && <Icon size={14} aria-hidden="true" fill={active ? 'currentColor' : 'none'} />}
      {label}
    </button>
  )
}

/**
 * Seção "Jogos" do Big Picture — grade de cards grandes alimentada por
 * `games:get`. Lançar um jogo usa `games:launch` (spawn direto, fora do
 * ProcessManager), então o contador de apps ativos do Hub não é alterado.
 *
 * `memo`: a única prop (`notify`) é estável no pai; a seção só re-renderiza por
 * estado próprio (lista, ícones, janela virtualizada). A navegação em si não
 * re-renderiza a grade — cada card assina só o seu `focused`.
 */
export const BigPictureGames = memo(function BigPictureGames({
  notify
}: BigPictureGamesProps): JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Ícones por id: dataURL cacheada no estado; `null` = sem ícone (fallback).
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const iconRequests = useRef<Set<string>>(new Set())
  // Retentativa com backoff: tentativas por id e timers pendentes.
  const iconRetryAttempts = useRef<Map<string, number>>(new Map())
  const iconRetryTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // `true` enquanto a seção está montada. Respostas de IPC antigas NÃO podem ser
  // descartadas só porque o estado mudou: o cleanup de um efeito roda a cada
  // re-render e era o que deixava só 1 card com ícone no BP.
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return (): void => {
      mountedRef.current = false
    }
  }, [])
  // Capas por id (T6): quando existe, o card mostra 2:3 com object-cover.
  const [covers, setCovers] = useState<Record<string, string | null>>({})
  const coverRequests = useRef<Set<string>>(new Set())
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  // Quais jogos estão com processo aberto (habilita o botão "Encerrar").
  const { runningIds, refresh: refreshRunning } = useGamesRunning(games)
  // Barra de filtros focável (T3): Todos · Favoritos · Recentes + coleções.
  const [filterKind, setFilterKind] = useState<GameFilterKind>('all')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [collections, setCollections] = useState<string[]>([])
  // Referência de tempo do filtro "Recentes" (30 dias) — capturada uma vez por
  // montagem para o useMemo continuar puro durante o render.
  const [filterNow] = useState(() => Date.now())

  // Âncora da virtualização: índice do jogo cujo card está focado. O foco vem
  // do store externo (só a seção re-renderiza; os cards são `memo`), e a linha
  // da âncora é sempre montada para o card nunca sumir no meio da navegação.
  const focusedId = useFocusedId()

  const filteredGames = useMemo(() => {
    const collectionKey = collectionFilter.trim().toLowerCase()
    const cutoff = filterNow - 30 * 24 * 3600_000
    const list = games.filter((game) => {
      if (filterKind === 'favorites' && game.favorite !== true) return false
      if (filterKind === 'recent') {
        const at = game.lastPlayedAt ? Date.parse(game.lastPlayedAt) : Number.NaN
        if (Number.isNaN(at) || at < cutoff) return false
      }
      if (
        collectionKey &&
        !(game.collections ?? []).some((name) => name.trim().toLowerCase() === collectionKey)
      ) {
        return false
      }
      return true
    })
    if (filterKind !== 'recent') return list
    return [...list].sort((a, b) => {
      const aAt = a.lastPlayedAt ? Date.parse(a.lastPlayedAt) : 0
      const bAt = b.lastPlayedAt ? Date.parse(b.lastPlayedAt) : 0
      return bAt - aAt
    })
  }, [games, filterKind, collectionFilter, filterNow])

  const gameIndexById = useMemo(() => {
    const byId = new Map<string, number>()
    filteredGames.forEach((game, index) => byId.set(game.id, index))
    return byId
  }, [filteredGames])
  // `game:stop:<id>` resolve para `stop:<id>` (ausente do mapa) → sem âncora.
  const anchorIndex =
    focusedId && focusedId.startsWith('game:')
      ? (gameIndexById.get(focusedId.slice('game:'.length)) ?? null)
      : null
  const { scrollRef, gridRef, onScroll, range } = useWindowedGrid({
    itemCount: filteredGames.length,
    anchorIndex
  })
  const visibleGames = filteredGames.slice(range.startIndex, range.endIndex)

  // Ao trocar o filtro a grade recomeça do topo (a âncora antiga pode nem
  // existir na lista nova; o foco do controle fica no chip recém-acionado).
  useEffect(() => {
    const scroller = scrollRef.current
    if (scroller) scroller.scrollTop = 0
  }, [filterKind, collectionFilter, scrollRef])

  // Coleções para os chips (falha silenciosa: a barra continua com 3 filtros).
  useEffect(() => {
    let alive = true
    window.api
      .getGameCollections()
      .then((list) => {
        if (alive) setCollections(list)
      })
      .catch(() => {
        // Sem coleções — só os filtros fixos aparecem.
      })
    return (): void => {
      alive = false
    }
  }, [])

  const loadGames = useCallback(async (): Promise<void> => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await window.api.getGames()
      setGames(list)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar sua biblioteca.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Cancela timer e zera tentativas de um id (ícone chegou).
  const clearIconRetry = useCallback((id: string): void => {
    const timer = iconRetryTimers.current.get(id)
    if (timer) clearTimeout(timer)
    iconRetryTimers.current.delete(id)
    iconRetryAttempts.current.delete(id)
  }, [])

  const clearAllIconRetries = useCallback((): void => {
    for (const timer of iconRetryTimers.current.values()) clearTimeout(timer)
    iconRetryTimers.current.clear()
    iconRetryAttempts.current.clear()
  }, [])

  // A lista aparece primeiro; o reparo/aquisição de ícones roda em segundo plano,
  // uma vez por montagem. Quando termina, os `null` (e SVGs gerados) são
  // descartados para os cards se atualizarem sem sair da tela.
  const iconReloadDone = useRef(false)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      await loadGames()
      if (cancelled) return
      if (!iconReloadDone.current) {
        iconReloadDone.current = true
        try {
          await window.api.reloadGameIcons()
        } catch {
          // Recarregar ícones é opcional — a grade deve abrir de qualquer jeito.
        }
        if (cancelled) return
        clearAllIconRetries()
        iconRequests.current.clear()
        coverRequests.current.clear()
        // Re-pede null (sem ícone) e SVG gerado (upgrade para arte real).
        setIcons((prev) => pruneIconsForReload(prev))
        // Capas: só o `null` (sem capa) precisa ser re-pedido.
        setCovers((prev) => {
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
      cancelled = true
    }
  }, [loadGames, clearAllIconRetries])

  // Busca os ícones que ainda não estão cacheados (mesmo padrão da Biblioteca).
  // Cada id é pedido no máximo uma vez por rodada; a decisão de aplicar é o
  // `mountedRef`, não o cleanup do efeito — re-render nenhum descarta respostas.
  useEffect(() => {
    const pendingIds = games
      .filter((game) => !(game.id in icons) && !iconRequests.current.has(game.id))
      .map((game) => game.id)
    if (pendingIds.length === 0) return
    for (const id of pendingIds) iconRequests.current.add(id)

    void requestIconsForIds(pendingIds, {
      fetchIcon: (id) => window.api.getGameIcon(id),
      apply: (id, dataUrl) => {
        if (dataUrl) clearIconRetry(id)
        setIcons((prev) => ({ ...prev, [id]: dataUrl }))
      },
      onSettled: (id, dataUrl) => {
        // Falha/ausência: libera o id para uma nova tentativa.
        if (!dataUrl) iconRequests.current.delete(id)
      },
      isMounted: () => mountedRef.current
    })
  }, [games, icons, clearIconRetry])

  // Retentativa com backoff (1 s, 2 s, 4 s) para ids que voltaram `null`.
  const scheduleIconRetry = useCallback((id: string): void => {
    if (iconRetryTimers.current.has(id)) return
    const attempt = (iconRetryAttempts.current.get(id) ?? 0) + 1
    const delay = retryDelayForAttempt(attempt)
    if (delay === null) return
    iconRetryAttempts.current.set(id, attempt)
    const timer = setTimeout(() => {
      iconRetryTimers.current.delete(id)
      window.api
        .getGameIcon(id)
        .then((dataUrl) => {
          if (!mountedRef.current) return
          if (dataUrl) iconRetryAttempts.current.delete(id)
          setIcons((prev) => {
            if (!dataUrl) return { ...prev, [id]: null }
            return prev[id] === dataUrl ? prev : { ...prev, [id]: dataUrl }
          })
        })
        .catch(() => {
          if (!mountedRef.current) return
          setIcons((prev) => ({ ...prev, [id]: null }))
        })
    }, delay)
    iconRetryTimers.current.set(id, timer)
  }, [])

  useEffect(() => {
    if (loading) return
    const retryIds = nextIconRetryIds(
      games,
      icons,
      iconRetryAttempts.current,
      new Set(iconRetryTimers.current.keys())
    )
    for (const id of retryIds) scheduleIconRetry(id)
  }, [loading, games, icons, scheduleIconRetry])

  // Cancela todos os timers ao desmontar (sem setState depois).
  useEffect(() => () => clearAllIconRetries(), [clearAllIconRetries])

  // Capas: mesma estratégia dos ícones (`mountedRef` + liberação em falha).
  useEffect(() => {
    const pendingIds = games
      .filter((game) => !(game.id in covers) && !coverRequests.current.has(game.id))
      .map((game) => game.id)
    if (pendingIds.length === 0) return
    for (const id of pendingIds) coverRequests.current.add(id)

    void requestIconsForIds(pendingIds, {
      fetchIcon: (id) => window.api.getGameCover(id),
      apply: (id, dataUrl) => {
        setCovers((prev) => ({ ...prev, [id]: dataUrl }))
      },
      onSettled: (id, dataUrl) => {
        if (!dataUrl) coverRequests.current.delete(id)
      },
      isMounted: () => mountedRef.current
    })
  }, [games, covers])

  const handleLaunch = useCallback(
    async (game: Game): Promise<void> => {
      if (launchingId) return
      setLaunchingId(game.id)
      try {
        const result = await window.api.launchGame(game.id)
        if (!result.ok) {
          playSfx('error')
          const message = `Não foi possível iniciar ${game.name}: ${result.error ?? 'erro desconhecido'}`
          notify(message)
          announce(message)
          return
        }
        playSfx('launch')
        const message = result.focused
          ? `${game.name} já está aberto — trazendo a janela para frente.`
          : result.alreadyRunning
            ? `${game.name} já está em execução — aguarde a janela.`
            : `Iniciando ${game.name}…`
        notify(message)
        announce(message)
        void refreshRunning()
      } finally {
        setLaunchingId(null)
      }
    },
    [launchingId, notify, refreshRunning]
  )

  // Encerramento pelo Hub (botão só fica habilitado com o jogo aberto).
  const handleStop = useCallback(
    async (game: Game): Promise<void> => {
      try {
        const result = await window.api.stopGame(game.id)
        if (!result.ok) {
          playSfx('error')
          const message = `Não foi possível encerrar ${game.name}: ${result.error ?? 'erro desconhecido'}`
          notify(message)
          announce(message)
          return
        }
        playSfx('confirm')
        const message = `Encerrando ${game.name}…`
        notify(message)
        announce(message)
        void refreshRunning()
      } catch (err) {
        playSfx('error')
        const message = `Não foi possível encerrar ${game.name}: ${err instanceof Error ? err.message : String(err)}`
        notify(message)
        announce(message)
      }
    },
    [notify, refreshRunning]
  )

  // Handlers estáveis passados aos cards (`memo`): recebem o jogo e evitam
  // lambdas novas a cada render da seção, que anulariam a memoização.
  const launchGame = useCallback(
    (game: Game): void => {
      void handleLaunch(game)
    },
    [handleLaunch]
  )
  const stopGame = useCallback(
    (game: Game): void => {
      void handleStop(game)
    },
    [handleStop]
  )

  return (
    <section aria-label="Jogos" className="flex h-full flex-col">
      {/* ── Cabeçalho com contador ─────────────────────── */}
      <header className="flex items-end justify-between gap-6 pr-40">
        <div>
          <h2 className="text-5xl font-black tracking-tight text-ink-primary">Jogos</h2>
          <p className="mt-2 text-lg text-ink-secondary">Sua biblioteca, pronta para a TV</p>
        </div>
        <div className="rounded-card border border-[var(--border-subtle)] bg-surface-1 px-5 py-3 shadow-elevation-1 flex items-center gap-3">
          <Gamepad2 size={18} aria-hidden="true" className="text-accent" />
          <span className="text-xl font-bold text-ink-primary tabular-nums">
            {games.length} {games.length === 1 ? 'jogo' : 'jogos'}
          </span>
        </div>
      </header>

      {/* ── Barra de filtros focável (T3) ─────────────── */}
      {!loading && !loadError && games.length > 0 && (
        <div
          role="group"
          aria-label="Filtros de jogos"
          className="mt-6 flex flex-wrap items-center gap-3"
        >
          <FilterChip
            id="games:filter:all"
            label="Todos"
            active={filterKind === 'all'}
            onSelect={() => setFilterKind('all')}
          />
          <FilterChip
            id="games:filter:favorites"
            label="Favoritos"
            icon={Star}
            active={filterKind === 'favorites'}
            onSelect={() => setFilterKind('favorites')}
          />
          <FilterChip
            id="games:filter:recent"
            label="Recentes"
            icon={Clock}
            active={filterKind === 'recent'}
            onSelect={() => setFilterKind('recent')}
          />
          {collections.length > 0 && (
            <span aria-hidden="true" className="h-6 w-px bg-[var(--border-subtle)]" />
          )}
          {collections.map((collection) => (
            <FilterChip
              key={collection}
              id={`games:filter:collection:${collection}`}
              label={collection}
              active={collectionFilter === collection}
              onSelect={() =>
                setCollectionFilter((current) => (current === collection ? '' : collection))
              }
            />
          ))}
        </div>
      )}

      {/* ── Conteúdo ─────────────────────────────────── */}
      <div className="mt-8 min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-ink-secondary">
            <Spinner size={40} label="Carregando sua biblioteca…" />
            <p className="text-xl">Carregando sua biblioteca…</p>
          </div>
        ) : loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <AlertTriangle size={40} aria-hidden="true" className="text-danger" />
            <p className="text-xl text-ink-primary">Não foi possível carregar sua biblioteca.</p>
            <p className="text-base text-ink-secondary">{loadError}</p>
            <RetryButton onClick={() => void loadGames()} />
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-card border border-[var(--accent-border)] bg-accent-muted">
              <Library size={52} strokeWidth={1.5} aria-hidden="true" className="text-accent" />
            </div>
            <div className="space-y-2">
              <h3 className="text-3xl font-bold text-ink-primary">
                {games.length === 0 ? 'Sua biblioteca está vazia' : 'Nenhum jogo neste filtro'}
              </h3>
              <p className="text-lg text-ink-secondary max-w-md">
                {games.length === 0
                  ? 'Adicione jogos pelo Hub normal, na aba Biblioteca — eles aparecem aqui.'
                  : 'Ajuste os filtros para encontrar seus jogos.'}
              </p>
            </div>
            {games.length > 0 && (
              <FilterChip
                id="games:filter:clear-empty"
                label="Limpar filtros"
                active={false}
                onSelect={() => {
                  setFilterKind('all')
                  setCollectionFilter('')
                }}
              />
            )}
          </div>
        ) : (
          // Scroller próprio da grade (sem `scrollIntoView`: o reveal mexe
          // só neste container). O `pb-8` fica aqui para o respiro final não
          // entrar na aritmética dos espaçadores.
          <div
            ref={scrollRef}
            onScroll={onScroll}
            data-bp-games-scroller=""
            className="h-full overflow-y-auto overflow-x-hidden pb-8"
          >
            <div
              ref={gridRef}
              role="listbox"
              aria-label="Jogos na sua biblioteca"
              className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6"
              // Espaçadores das linhas fora da janela: a grade ocupa a altura
              // total (barra de rolagem correta) renderizando só as linhas da
              // janela + overscan. Textura/visual dos cards não muda.
              style={{ paddingTop: range.topSpacerPx, paddingBottom: range.bottomSpacerPx }}
            >
              {visibleGames.map((game, offset) => {
                const index = range.startIndex + offset
                return (
                  <GameCard
                    key={game.id}
                    game={game}
                    icon={icons[game.id]}
                    cover={covers[game.id]}
                    launching={launchingId === game.id}
                    running={runningIds.has(game.id)}
                    onLaunch={launchGame}
                    onStop={stopGame}
                    position={index + 1}
                    total={filteredGames.length}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
})
