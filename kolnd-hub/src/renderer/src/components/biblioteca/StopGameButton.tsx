import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Square } from 'lucide-react'
import type { Game } from '../../types'
import { Tooltip } from '../ui'

/**
 * Botão "Encerrar jogo" — só pode ser pressionado quando o jogo estiver
 * aberto (disabled caso contrário). Confirmação em duas etapas inline
 * ("Encerrar" → "Confirmar?" por 4 s), para não perder progresso por um
 * clique acidental. Estilo danger outline; foco visível vem do anel global
 * :focus-visible (sem ring próprio). Balão via Tooltip primitivo (abre no
 * hover e no foco).
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

  const tooltipContent = !running
    ? 'Abra o jogo para poder encerrá-lo'
    : confirming
      ? 'Clique de novo para encerrar o jogo'
      : `Encerrar ${game.name}`

  return (
    // Wrapper absoluto posiciona o botão no canto do card; o Tooltip interno
    // fica no fluxo normal e ancora o balão ao gatilho.
    <span className="absolute right-12 top-2 z-10">
      <Tooltip content={tooltipContent} side="top">
        <span
          role="button"
          tabIndex={running ? 0 : -1}
          aria-label={`Encerrar ${game.name}`}
          aria-disabled={!running}
          aria-pressed={confirming}
          onClick={(event) => void handleActivate(event)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              void handleActivate(event)
            }
          }}
          className={`inline-flex h-[30px] select-none items-center justify-center rounded-sm border p-2 transition-colors duration-1 ease-standard ${
            !running
              ? 'cursor-not-allowed border-transparent text-ink-tertiary'
              : confirming
                ? 'cursor-pointer border-danger-border bg-danger-bg text-danger'
                : 'cursor-pointer border-transparent text-danger hover:border-danger-border hover:bg-danger-bg'
          }`}
        >
          {confirming ? (
            <span className="text-[9px] font-bold uppercase tracking-wider">Confirmar?</span>
          ) : (
            <Square size={14} aria-hidden="true" />
          )}
        </span>
      </Tooltip>
    </span>
  )
})
