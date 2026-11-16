import { useCallback, useEffect, useRef, useState } from 'react'
import { Gamepad2, Loader2, AlertTriangle, Library, Square } from 'lucide-react'
import { Game } from '../types'
import { useBigPictureFocus, useFocusable } from './BigPictureFocus'
import { useGamesRunning } from '../hooks/useGamesRunning'
import { playSfx } from '../lib/sfx'

interface BigPictureGamesProps {
  /** Notificação amigável exibida no canto (toast local do Big Picture). */
  notify: (text: string) => void
}

const focusRing = 'focus:outline-none focus-visible:ring-4 focus-visible:ring-neon-cyan/70'

const focusedCard = 'ring-4 ring-neon-cyan shadow-glow-cyan scale-105 border-neon-cyan/40'

interface GameCardProps {
  game: Game
  icon: string | null | undefined
  launching: boolean
  /** Há um processo do jogo aberto (habilita o botão "Encerrar"). */
  running: boolean
  onLaunch: (game: Game) => void
  onStop: (game: Game) => void
}

const stopFocusRing = 'focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400/70'

/** Botão "Encerrar" do card — focável pelo controle, mas só quando o jogo está aberto. */
function CardStopButton({
  id,
  confirming,
  onActivate
}: {
  id: string
  confirming: boolean
  onActivate: () => void
}): JSX.Element {
  const { ref, focused, focus } = useFocusable(id)

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
      className={`absolute top-3 right-3 z-10 inline-flex h-12 min-w-12 items-center justify-center rounded-xl border px-2 transition-all duration-150 cursor-pointer ${stopFocusRing} ${
        confirming
          ? 'border-red-500/50 bg-red-500/20 text-red-300'
          : focused
            ? 'border-red-500/50 bg-red-500/15 text-red-300 ring-4 ring-red-400/60'
            : 'border-white/[0.08] bg-white/[0.05] text-slate-400 hover:border-red-500/40 hover:text-red-300'
      }`}
    >
      {confirming ? (
        <span className="text-[10px] font-bold uppercase tracking-wide leading-tight text-center">
          Confirmar?
        </span>
      ) : (
        <Square size={16} strokeWidth={2.25} />
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
  onStop
}: GameCardProps): JSX.Element {
  const { ref, focused, focus } = useFocusable(`game:${game.id}`)
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
          onActivate={handleStopClick}
        />
      ) : (
        <span
          aria-hidden="true"
          title="O jogo não está em execução"
          className="absolute top-3 right-3 z-10 inline-flex h-12 min-w-12 cursor-not-allowed items-center justify-center rounded-xl border border-white/[0.05] bg-white/[0.02] p-2 text-slate-500"
        >
          <Square size={16} strokeWidth={2.25} />
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
        className={`glass-card glass-hover group flex h-full w-full flex-col items-center gap-5 p-6 pt-8 text-center transition-all duration-200 hover:scale-[1.03] disabled:opacity-70 min-h-[15rem] ${focusRing} focus-visible:scale-[1.03] focus-visible:shadow-glow-cyan ${
          focused ? focusedCard : ''
        }`}
      >
        <div className="w-32 h-32 2xl:w-36 2xl:h-36 rounded-3xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden shrink-0 transition-colors group-hover:border-neon-cyan/30">
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
              className="text-slate-400 transition-colors group-hover:text-slate-300"
            />
          )}
        </div>
        <p className="w-full text-2xl font-semibold leading-snug text-slate-100 line-clamp-2 min-h-[3.5rem]">
          {game.name}
        </p>
        <span className="flex items-center gap-3">
          {running && (
            <span
              className="inline-flex items-center gap-2 text-[10px] 3xl:text-base font-bold uppercase tracking-[0.2em] text-emerald-400"
              title="O jogo está aberto (processo detectado)"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Em execução
            </span>
          )}
          <span className={game.origin === 'steam' ? 'badge-steam' : 'badge-kloud'}>
            {launching ? 'Iniciando…' : game.origin === 'steam' ? 'Steam' : 'Personalizado'}
          </span>
        </span>
      </button>
    </div>
  )
}

/** Botão "Tentar novamente" do estado de erro — focável pelo controle. */
function RetryButton({ onClick }: { onClick: () => void }): JSX.Element {
  const { ref, focused, focus } = useFocusable('games:retry')
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={focus}
      onFocus={focus}
      className={`btn-secondary mt-2 !text-xl !px-6 !py-3 min-h-[3rem] ${focusRing} ${
        focused ? 'ring-4 ring-neon-cyan/70' : ''
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
          notify(`Não foi possível iniciar ${game.name}: ${result.error ?? 'erro desconhecido'}`)
          return
        }
        playSfx('launch')
        notify(
          result.focused
            ? `${game.name} já está aberto — trazendo a janela para frente.`
            : result.alreadyRunning
              ? `${game.name} já está em execução — aguarde a janela.`
              : `Iniciando ${game.name}…`
        )
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
          notify(`Não foi possível encerrar ${game.name}: ${result.error ?? 'erro desconhecido'}`)
          return
        }
        playSfx('confirm')
        notify(`Encerrando ${game.name}…`)
        void refreshRunning()
      } catch (err) {
        playSfx('error')
        notify(
          `Não foi possível encerrar ${game.name}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
    [notify, refreshRunning]
  )

  return (
    <section aria-label="Jogos" className="flex h-full flex-col">
      {/* ── Cabeçalho com contador ─────────────────────── */}
      <header className="flex items-end justify-between gap-6 pr-40">
        <div>
          <h2 className="text-5xl font-black tracking-tight text-white">Jogos</h2>
          <p className="mt-2 text-lg text-slate-400">Sua biblioteca, pronta para a TV</p>
        </div>
        <div className="glass rounded-2xl px-5 py-3 flex items-center gap-3">
          <Gamepad2 size={18} className="text-neon-cyan" />
          <span className="text-xl font-bold text-slate-100 tabular-nums">
            {games.length} {games.length === 1 ? 'jogo' : 'jogos'}
          </span>
        </div>
      </header>

      {/* ── Conteúdo ─────────────────────────────────── */}
      <div className="mt-8 min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-400">
            <Loader2 size={40} className="animate-spin text-neon-cyan" />
            <p className="text-xl">Carregando sua biblioteca…</p>
          </div>
        ) : loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <AlertTriangle size={40} className="text-red-400" />
            <p className="text-xl text-slate-200">Não foi possível carregar sua biblioteca.</p>
            <p className="text-base text-slate-400">{loadError}</p>
            <RetryButton onClick={() => void loadGames()} />
          </div>
        ) : games.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
            <div className="w-28 h-28 rounded-[2rem] border border-steam-blue/30 bg-steam-blue/10 flex items-center justify-center">
              <Library size={52} strokeWidth={1.5} className="text-steam-blue" />
            </div>
            <div className="space-y-2">
              <h3 className="text-3xl font-bold text-slate-100">Sua biblioteca está vazia</h3>
              <p className="text-lg text-slate-400 max-w-md">
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
            {games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                icon={icons[game.id]}
                launching={launchingId === game.id}
                running={runningIds.has(game.id)}
                onLaunch={(g) => void handleLaunch(g)}
                onStop={(g) => void handleStop(g)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
