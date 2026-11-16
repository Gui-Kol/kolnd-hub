import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Square } from 'lucide-react'
import type { Game } from '../../types'

/**
 * Botão "Encerrar jogo" — só pode ser pressionado quando o jogo estiver
 * aberto (disabled caso contrário). Confirmação em duas etapas inline
 * ("Encerrar" → "Confirmar?" por 4 s), para não perder progresso por um
 * clique acidental.
 */
export const StopGameButton = memo(function StopGameButton({
  game,
  running,
  onStopped
}: {
  game: Game
  running: boolean
  onStopped: (game: Game, result: { ok: boolean; error?: string }) => void
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  useEffect(
    () => (): void => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    },
    []
  )

  // Jogo fechado por conta própria: sai do modo de confirmação.
  // (Ajuste de estado durante o render — padrão oficial "you might not need an effect".)
  const [prevRunning, setPrevRunning] = useState(running)
  if (running !== prevRunning) {
    setPrevRunning(running)
    if (!running) setConfirming(false)
  }

  const handleActivate = useCallback(
    async (event: React.SyntheticEvent): Promise<void> => {
      event.stopPropagation()
      if (!running) return
      if (!confirming) {
        setConfirming(true)
        timeoutRef.current = window.setTimeout(() => setConfirming(false), 4000)
        return
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      setConfirming(false)
      try {
        const result = await window.api.stopGame(game.id)
        onStopped(game, result)
      } catch (err) {
        onStopped(game, { ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
    [confirming, game, onStopped, running]
  )

  return (
    <span
      role="button"
      tabIndex={running ? 0 : -1}
      aria-label={`Encerrar ${game.name}`}
      aria-disabled={!running}
      aria-pressed={confirming}
      title={
        running
          ? confirming
            ? 'Clique de novo para encerrar o jogo'
            : `Encerrar ${game.name}`
          : 'O jogo não está em execução'
      }
      onClick={(event) => void handleActivate(event)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void handleActivate(event)
        }
      }}
      className={`absolute top-2 right-12 inline-flex h-[30px] items-center justify-center rounded-lg border border-transparent p-2 text-red-400 transition-colors focus:outline-none focus:ring-2 focus:ring-red-400/50 ${
        !running
          ? 'cursor-not-allowed text-slate-700'
          : confirming
            ? 'border-red-500/40 bg-red-500/15 text-red-300'
            : 'hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 cursor-pointer'
      }`}
    >
      {confirming ? (
        <span className="text-[9px] font-bold uppercase tracking-wide">Confirmar?</span>
      ) : (
        <Square size={13} />
      )}
    </span>
  )
})
