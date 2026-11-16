import { memo } from 'react'
import type { Game } from '../../types'
import { GameCard } from './GameCard'

export interface BibliotecaGridProps {
  games: Game[]
  /** dataURL cacheada por id (`null` = sem ícone). */
  icons: Record<string, string | null>
  runningIds: ReadonlySet<string>
  missingExes: ReadonlySet<string>
  onLaunch: (game: Game) => void
  onEdit: (game: Game) => void
  onStopped: (game: Game, result: { ok: boolean; error?: string }) => void
}

/**
 * Grade de jogos da Biblioteca. Memoizada: só re-renderiza quando a lista,
 * os ícones ou os conjuntos de running/missing mudam de fato.
 */
export const BibliotecaGrid = memo(function BibliotecaGrid({
  games,
  icons,
  runningIds,
  missingExes,
  onLaunch,
  onEdit,
  onStopped
}: BibliotecaGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          icon={icons[game.id]}
          running={runningIds.has(game.id)}
          exeMissing={missingExes.has(game.id)}
          onLaunch={onLaunch}
          onEdit={onEdit}
          onStopped={onStopped}
        />
      ))}
    </div>
  )
})
