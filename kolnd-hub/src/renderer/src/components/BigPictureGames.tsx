import { useCallback, useEffect, useRef, useState } from 'react'
import { Gamepad2, AlertTriangle, Library, Square } from 'lucide-react'
import { Game } from '../types'
import { useBigPictureFocus, useFocusable, BP_FOCUS_RING, BP_FOCUSED_RING } from './BigPictureFocus'
import { useGamesRunning } from '../hooks/useGamesRunning'
import { playSfx } from '../lib/sfx'
import { announce, formatFocusItem } from '../lib/useAnnouncer'
import { Badge, Spinner } from './ui'

interface BigPictureGamesProps {
  /** Notificação amigável exibida no canto (toast local do Big Picture). */
  notify: (text: string) => void
}

interface GameCardProps {
  game: Game
  icon: string | null | undefined
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

function GameCard({
  game,
  icon,
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
    <div className="relative">
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
        className={`group flex h-full w-full flex-col items-center gap-5 rounded-card border bg-surface-1 p-6 pt-8 text-center shadow-elevation-1 transition-all duration-2 ease-standard hover:scale-[1.03] hover:border-[var(--accent-border)] hover:bg-surface-2 hover:shadow-elevation-2 disabled:opacity-70 min-h-[15rem] focus:outline-none ${BP_FOCUS_RING} focus-visible:scale-[1.03] ${
          focused
            ? `scale-[1.05] border-[var(--accent-border)] bg-surface-2 shadow-elevation-2 ${BP_FOCUSED_RING}`
            : 'border-[var(--border-subtle)]'
        }`}
      >
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
              {game.origin === 'steam' ? 'Steam' : 'Personalizado'}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}

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

/**
 * Seção "Jogos" do Big Picture — grade de cards grandes alimentada por
 * `games:get`. Lançar um jogo usa `games:launch` (spawn direto, fora do
 * ProcessManager), então o contador de apps ativos do Hub não é alterado.
 */
export function BigPictureGames({ notify }: BigPictureGamesProps): JSX.Element {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Ícones por id: dataURL cacheada no estado; `null` = sem ícone (fallback).
  const [icons, setIcons] = useState<Record<string, string | null>>({})
  const iconRequests = useRef<Set<string>>(new Set())
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  // Quais jogos estão com processo aberto (habilita o botão "Encerrar").
  const { runningIds, refresh: refreshRunning } = useGamesRunning(games)

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

  useEffect(() => {
    // Carregamento assíncrono: o estado só muda quando a lista chega.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGames()
  }, [loadGames])

  // Busca os ícones que ainda não estão cacheados (mesmo padrão da Biblioteca).
  useEffect(() => {
    let cancelled = false
    for (const game of games) {
      if (game.id in icons) continue
      if (iconRequests.current.has(game.id)) continue
      iconRequests.current.add(game.id)
      window.api
        .getGameIcon(game.id)
        .then((dataUrl) => {
          if (cancelled) return
          setIcons((prev) => ({ ...prev, [game.id]: dataUrl }))
        })
        .catch(() => {
          if (cancelled) return
          setIcons((prev) => ({ ...prev, [game.id]: null }))
        })
    }
    return (): void => {
      cancelled = true
    }
  }, [games, icons])

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
        ) : games.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-card border border-[var(--accent-border)] bg-accent-muted">
              <Library size={52} strokeWidth={1.5} aria-hidden="true" className="text-accent" />
            </div>
            <div className="space-y-2">
              <h3 className="text-3xl font-bold text-ink-primary">Sua biblioteca está vazia</h3>
              <p className="text-lg text-ink-secondary max-w-md">
                Adicione jogos pelo Hub normal, na aba Biblioteca — eles aparecem aqui.
              </p>
            </div>
          </div>
        ) : (
          <div
            role="listbox"
            aria-label="Jogos na sua biblioteca"
            className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 pb-8"
          >
            {games.map((game, index) => (
              <GameCard
                key={game.id}
                game={game}
                icon={icons[game.id]}
                launching={launchingId === game.id}
                running={runningIds.has(game.id)}
                onLaunch={(g) => void handleLaunch(g)}
                onStop={(g) => void handleStop(g)}
                position={index + 1}
                total={games.length}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
