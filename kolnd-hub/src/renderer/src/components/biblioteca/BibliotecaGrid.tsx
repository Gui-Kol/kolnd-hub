import { memo } from 'react'
import { Gamepad2 } from 'lucide-react'
import type { Game } from '../../types'
import { Badge } from '../ui'
import { GameCard } from './GameCard'

export interface BibliotecaGridProps {
  games: Game[]
  /** dataURL cacheada por id (`null` = sem ícone). */
  icons: Record<string, string | null>
  /** dataURL da capa por id (`null` = sem capa; o card usa o ícone). */
  covers: Record<string, string | null>
  runningIds: ReadonlySet<string>
  missingExes: ReadonlySet<string>
  /** Modo de seleção em lote (repassado aos cards). */
  selectable?: boolean
  /** Ids marcados no modo de seleção. */
  selectedIds?: ReadonlySet<string>
  onToggleSelect?: (game: Game) => void
  onLaunch: (game: Game) => void
  onEdit: (game: Game) => void
  onToggleFavorite: (game: Game) => void
  onStopped: (game: Game, result: { ok: boolean; error?: string }) => void
}

/**
 * Grade de jogos da Biblioteca. Memoizada: só re-renderiza quando a lista,
 * os ícones ou os conjuntos de running/missing mudam de fato.
 *
 * Assinatura A (aprovada): quando há jogos abertos, uma shelf "Em execução
 * agora" aparece ACIMA da grade — destaque visual com capa/ícone ampliado,
 * borda de acento e selo de execução. Sem lógica nova: os dados vêm de
 * `useGamesRunning` (já existente); `Game` não tem `startedAt`, então nenhum
 * tempo de execução é exibido.
 */
export const BibliotecaGrid = memo(function BibliotecaGrid({
  games,
  icons,
  covers,
  runningIds,
  missingExes,
  selectable = false,
  selectedIds,
  onToggleSelect,
  onLaunch,
  onEdit,
  onToggleFavorite,
  onStopped
}: BibliotecaGridProps): JSX.Element {
  const runningGames = games.filter((game) => runningIds.has(game.id))

  return (
    <div className="space-y-4">
      {/* ── Assinatura A — shelf "Em execução agora" ──────────── */}
      {runningGames.length > 0 && (
        <section
          aria-label="Em execução agora"
          className="rounded-card border border-accent-border p-4 shadow-elevation-2"
          style={{
            background:
              'linear-gradient(120deg, var(--accent-muted) 0%, transparent 55%), var(--surface-1)'
          }}
        >
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-pill bg-success" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
              Em execução agora
            </h2>
            <span className="tnum text-[11px] text-ink-tertiary">
              {runningGames.length} de {games.length}
            </span>
          </div>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {runningGames.map((game) => {
              const icon = icons[game.id]
              return (
                <button
                  key={game.id}
                  type="button"
                  onClick={() => void onLaunch(game)}
                  title={`Jogar ${game.name}`}
                  aria-label={`Jogar ${game.name} — em execução`}
                  className="flex w-[300px] shrink-0 items-center gap-3 rounded-card border border-accent-border bg-surface-2 p-2.5 pr-4 text-left shadow-elevation-2 transition-all duration-2 ease-standard hover:border-accent hover:bg-surface-3"
                >
                  <span
                    className="flex h-28 w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[var(--border-strong)]"
                    style={{
                      background:
                        'linear-gradient(165deg, var(--accent-muted) 0%, transparent 75%), var(--surface-3)'
                    }}
                  >
                    {icon ? (
                      <img
                        src={icon}
                        alt={`Ícone de ${game.name}`}
                        className="h-full w-full object-contain"
                        draggable={false}
                      />
                    ) : (
                      <Gamepad2 size={36} aria-hidden="true" className="text-accent" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col items-start gap-1.5">
                    <span className="line-clamp-2 text-[15px] font-semibold leading-tight tracking-tight text-ink-primary">
                      {game.name}
                    </span>
                    <Badge tone="success">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 animate-pulse rounded-pill bg-success"
                      />
                      Em execução
                    </Badge>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* ── grade ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {games.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            icon={icons[game.id]}
            cover={covers[game.id]}
            running={runningIds.has(game.id)}
            exeMissing={missingExes.has(game.id)}
            selectable={selectable}
            selected={selectedIds?.has(game.id) ?? false}
            onToggleSelect={onToggleSelect}
            onLaunch={onLaunch}
            onEdit={onEdit}
            onToggleFavorite={onToggleFavorite}
            onStopped={onStopped}
          />
        ))}
      </div>
    </div>
  )
})
