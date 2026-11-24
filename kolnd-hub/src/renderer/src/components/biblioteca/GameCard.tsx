import { memo } from 'react'
import { AlertTriangle, Gamepad2, Pencil } from 'lucide-react'
import type { Game } from '../../types'
import { Badge } from '../ui'
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
 * Visual: superfície 1 + borda sutil; hover eleva para superfície 2 com borda
 * de acento (padrão AppCard). Foco visível vem do anel global :focus-visible.
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
      className="group relative flex flex-col items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-surface-1 p-5 pt-6 text-center shadow-elevation-1 transition-all duration-2 ease-standard hover:border-[var(--accent-border)] hover:bg-surface-2 hover:shadow-elevation-2"
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
        className="absolute right-2 top-2 rounded-sm p-2 text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink-primary"
      >
        <Pencil size={14} aria-hidden="true" />
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
          className="absolute left-2 top-2 cursor-pointer"
        >
          <Badge tone="warning" className="transition-colors hover:border-[var(--warning)]">
            <AlertTriangle size={12} aria-hidden="true" />
            .exe não encontrado
          </Badge>
        </span>
      )}

      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-control border border-[var(--border-subtle)] bg-surface-2">
        {icon ? (
          <img
            src={icon}
            alt={`Ícone de ${game.name}`}
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <Gamepad2
            size={32}
            aria-hidden="true"
            className="text-ink-tertiary transition-colors duration-2 ease-standard group-hover:text-ink-secondary"
          />
        )}
      </div>

      <p className="line-clamp-2 w-full text-sm font-semibold leading-snug tracking-tight text-ink-primary">
        {game.name}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {running && (
          <Badge tone="success" title="O jogo está aberto (processo detectado)">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 animate-pulse rounded-pill bg-success"
            />
            Em execução
          </Badge>
        )}
        {/* Badge de origem neutra (STEAM/EPIC/MINECRAFT/CUSTOM), sem cor de marca */}
        <Badge tone="neutral">
          {game.origin === 'steam'
            ? 'Steam'
            : game.origin === 'epic'
              ? 'Epic'
              : game.origin === 'minecraft'
                ? 'Minecraft'
                : 'Custom'}
        </Badge>
      </div>
    </button>
  )
})
