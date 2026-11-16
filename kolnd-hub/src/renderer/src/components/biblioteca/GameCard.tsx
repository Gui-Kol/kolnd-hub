import { memo } from 'react'
import { AlertTriangle, Gamepad2, Pencil } from 'lucide-react'
import type { Game } from '../../types'
import { StopGameButton } from './StopGameButton'

export interface GameCardProps {
  game: Game
  /** dataURL do ícone cacheado (`undefined`/`null` = ainda não carregado ou sem ícone). */
  icon: string | null | undefined
  /** Processo do jogo detectado pela sondagem (habilita "Encerrar"). */
  running: boolean
  /** Executável não existe mais no disco (selo de alerta). */
  exeMissing: boolean
  onLaunch: (game: Game) => void
  onEdit: (game: Game) => void
  onStopped: (game: Game, result: { ok: boolean; error?: string }) => void
}

/**
 * Card de jogo da grade da Biblioteca. Memoizado: só re-renderiza quando o
 * próprio jogo, seu ícone, ou os flags running/exeMissing mudam — toast e
 * menu aberto no componente pai não tocam mais nos cards.
 */
export const GameCard = memo(function GameCard({
  game,
  icon,
  running,
  exeMissing,
  onLaunch,
  onEdit,
  onStopped
}: GameCardProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void onLaunch(game)}
      title={`Jogar ${game.name}`}
      className="glass-card glass-hover group relative flex flex-col items-center gap-3 p-5 pt-6 text-center focus:outline-none focus:ring-2 focus:ring-steam-blue/50"
    >
      {/* Encerramento pelo Hub — só fica habilitado com o jogo aberto */}
      <StopGameButton game={game} running={running} onStopped={onStopped} />

      {/* Edição (T9) — abre o modal "Editar Game" */}
      <span
        role="button"
        tabIndex={0}
        title="Editar jogo"
        aria-label={`Editar ${game.name}`}
        onClick={(event) => {
          event.stopPropagation()
          onEdit(game)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.stopPropagation()
            onEdit(game)
          }
        }}
        className="absolute top-2 right-2 p-2 rounded-lg text-slate-400 border border-transparent hover:text-white hover:bg-white/[0.06] hover:border-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-neon-cyan/70"
      >
        <Pencil size={14} />
      </span>

      {/* Selo discreto quando o executável não existe mais no disco */}
      {exeMissing && (
        <span
          role="button"
          tabIndex={0}
          title="O executável configurado não foi encontrado no disco — clique para editar"
          aria-label="Executável não encontrado — editar jogo"
          onClick={(event) => {
            event.stopPropagation()
            onEdit(game)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onEdit(game)
            }
          }}
          className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-neon-cyan/70"
        >
          <AlertTriangle size={12} />
          .exe não encontrado
        </span>
      )}

      <div className="w-24 h-24 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center overflow-hidden shrink-0 group-hover:border-steam-blue/30 transition-colors">
        {icon ? (
          <img
            src={icon}
            alt={`Ícone de ${game.name}`}
            className="w-full h-full object-contain"
            draggable={false}
          />
        ) : (
          <Gamepad2
            size={32}
            className="text-slate-400 group-hover:text-slate-300 transition-colors"
          />
        )}
      </div>

      <p className="text-sm font-semibold text-slate-200 leading-snug line-clamp-2 w-full">
        {game.name}
      </p>
      <div className="flex items-center gap-2">
        {running && (
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400"
            title="O jogo está aberto (processo detectado)"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Em execução
          </span>
        )}
        <span className={game.origin === 'steam' ? 'badge-steam' : 'badge-kloud'}>
          {game.origin === 'steam' ? 'Steam' : 'Personalizado'}
        </span>
      </div>
    </button>
  )
})
