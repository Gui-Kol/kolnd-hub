import { memo, useState } from 'react'
import { AlertTriangle, Check, Gamepad2, Pencil, Star } from 'lucide-react'
import type { Game } from '../../types'
import { formatLastPlayed, formatPlaytime, weekPlaytimeSeconds } from '../../lib/gameStats'
import { Badge } from '../ui'
import { StopGameButton } from './StopGameButton'

export interface GameCardProps {
  game: Game
  /** dataURL do ícone cacheado (`undefined`/`null` = ainda não carregado ou sem ícone). */
  icon: string | null | undefined
  /** dataURL da capa escolhida (`undefined`/`null` = sem capa; usa o ícone). */
  cover: string | null | undefined
  /** Processo do jogo detectado pela sondagem (habilita "Encerrar"). */
  running: boolean
  /** Executável não existe mais no disco (selo de alerta). */
  exeMissing: boolean
  /** Modo de seleção em lote: o clique marca/desmarca em vez de lançar. */
  selectable?: boolean
  /** Marcado no modo de seleção (`aria-pressed`). */
  selected?: boolean
  onToggleSelect?: (game: Game) => void
  onLaunch: (game: Game) => void
  onEdit: (game: Game) => void
  onToggleFavorite: (game: Game) => void
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
  cover,
  running,
  exeMissing,
  selectable = false,
  selected = false,
  onToggleSelect,
  onLaunch,
  onEdit,
  onToggleFavorite,
  onStopped
}: GameCardProps): JSX.Element {
  // Estatísticas da Biblioteca (T2): total · semana · última vez. Só aparece
  // quando existe algum dado — cards antigos continuam com o mesmo layout.
  const totalSeconds = game.playtimeSeconds ?? 0
  const weekSeconds = weekPlaytimeSeconds(game.playtimeDays)
  const lastPlayed = formatLastPlayed(game.lastPlayedAt)
  const stats: string[] = []
  if (totalSeconds > 0) stats.push(`${formatPlaytime(totalSeconds)} no total`)
  if (weekSeconds > 0) stats.push(`${formatPlaytime(weekSeconds)} nesta semana`)
  if (lastPlayed) stats.push(lastPlayed)

  // `onError` no <img> volta ao placeholder em vez de mostrar imagem quebrada.
  // Guardamos a src que falhou: quando o ícone/capa muda, volta a tentar.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const coverVisible = Boolean(cover) && cover !== failedSrc
  const iconVisible = Boolean(icon) && icon !== failedSrc

  return (
    <button
      type="button"
      onClick={() => {
        if (selectable) onToggleSelect?.(game)
        else void onLaunch(game)
      }}
      title={
        selectable
          ? selected
            ? `Desmarcar ${game.name}`
            : `Selecionar ${game.name}`
          : `Jogar ${game.name}`
      }
      aria-label={
        selectable ? (selected ? `Desmarcar ${game.name}` : `Selecionar ${game.name}`) : undefined
      }
      aria-pressed={selectable ? selected : undefined}
      className={`group relative flex flex-col items-center gap-3 rounded-card border bg-surface-1 p-5 pt-6 text-center shadow-elevation-1 transition-all duration-2 ease-standard hover:bg-surface-2 hover:shadow-elevation-2 ${
        selected
          ? 'border-accent-border ring-2 ring-accent-border'
          : 'border-[var(--border-subtle)] hover:border-[var(--accent-border)]'
      }`}
    >
      {/* Modo seleção: o card inteiro é o toggle; controles próprios somem para
          não haver clique cruzado (favoritar/editar/encerrar continuam fora). */}
      {selectable && (
        <span
          aria-hidden="true"
          className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border shadow-elevation-1 ${
            selected
              ? 'border-accent bg-accent text-accent-contrast'
              : 'border-[var(--border-strong)] bg-surface-1 text-transparent'
          }`}
        >
          <Check size={14} aria-hidden="true" />
        </span>
      )}

      {/* Encerramento pelo Hub — só fica habilitado com o jogo aberto */}
      {!selectable && <StopGameButton game={game} running={running} onStopped={onStopped} />}

      {/* Favorito — botão próprio (span com role para não aninhar <button>). */}
      {!selectable && (
        <span
          role="button"
          tabIndex={0}
          aria-pressed={game.favorite === true}
          aria-label={
            game.favorite
              ? `Remover ${game.name} dos favoritos`
              : `Adicionar ${game.name} aos favoritos`
          }
          title={game.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite(game)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onToggleFavorite(game)
            }
          }}
          className={`absolute left-2 top-2 z-10 rounded-sm p-2 transition-colors hover:bg-surface-3 ${
            game.favorite ? 'text-warn' : 'text-ink-tertiary hover:text-ink-primary'
          }`}
        >
          <Star size={15} aria-hidden="true" fill={game.favorite ? 'currentColor' : 'none'} />
        </span>
      )}

      {/* Edição (T9) — abre o modal "Editar Game" */}
      {!selectable && (
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
      )}

      {/* Selo discreto quando o executável não existe mais no disco (é um atalho
          para editar — também some no modo seleção). */}
      {exeMissing && !selectable && (
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
          className="absolute left-2 top-11 cursor-pointer"
        >
          <Badge tone="warning" className="transition-colors hover:border-[var(--warning)]">
            <AlertTriangle size={12} aria-hidden="true" />
            .exe não encontrado
          </Badge>
        </span>
      )}

      {coverVisible ? (
        <div className="aspect-[2/3] w-full max-w-[124px] shrink-0 overflow-hidden rounded-control border border-[var(--border-subtle)] bg-surface-2">
          <img
            src={cover ?? ''}
            alt={`Capa de ${game.name}`}
            className="h-full w-full object-cover"
            draggable={false}
            onError={() => setFailedSrc(cover ?? null)}
          />
        </div>
      ) : (
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-control border border-[var(--border-subtle)] bg-surface-2">
          {iconVisible ? (
            <img
              src={icon ?? ''}
              alt={`Ícone de ${game.name}`}
              className="h-full w-full object-contain"
              draggable={false}
              onError={() => setFailedSrc(icon ?? null)}
            />
          ) : (
            <Gamepad2
              size={32}
              aria-hidden="true"
              className="text-ink-tertiary transition-colors duration-2 ease-standard group-hover:text-ink-secondary"
            />
          )}
        </div>
      )}

      <p className="line-clamp-2 w-full text-sm font-semibold leading-snug tracking-tight text-ink-primary">
        {game.name}
      </p>
      {stats.length > 0 && (
        <p
          className="tnum w-full text-[10.5px] leading-snug text-ink-tertiary"
          title={stats.join(' · ')}
        >
          {stats.join(' · ')}
        </p>
      )}
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
