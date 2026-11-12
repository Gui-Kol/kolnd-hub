// useGamesRunning — "quais jogos estão abertos?" para a Biblioteca e o Big Picture.
//
// Consulta `games:running-map` (uma única chamada PowerShell por sondagem,
// englobando todos os jogos da tela) em um intervalo leve (4 s) e mantém um
// Set de ids em execução. O estado é atualizado de forma otimizada: a sondagem
// só re-renderiza quando a composição de jogos abertos muda de fato.
//
// Também expõe `refresh()` para reconsultar imediatamente após lançar ou
// encerrar um jogo pelo Hub (sensação de resposta instantânea).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game } from '../types'

const POLL_INTERVAL_MS = 4000

export interface UseGamesRunningResult {
  /** Ids dos jogos abertos no momento (fonte: processos do sistema). */
  runningIds: ReadonlySet<string>
  /** Reconsulta o estado agora (após lançar/encerrar um jogo). */
  refresh: () => Promise<void>
}

export function useGamesRunning(games: Game[]): UseGamesRunningResult {
  const [runningIds, setRunningIds] = useState<ReadonlySet<string>>(new Set())
  const gamesRef = useRef(games)
  useEffect(() => {
    gamesRef.current = games
  }, [games])
  // Chave estável da lista: muda somente quando os jogos/paths mudam.
  const gamesKey = games.map((g) => `${g.id} ${g.exePath}`).join('|')

  const refresh = useCallback(async (): Promise<void> => {
    const list = gamesRef.current
    if (list.length === 0) {
      setRunningIds((prev) => (prev.size === 0 ? prev : new Set()))
      return
    }
    try {
      const result = await window.api.getRunningGames(list.map((g) => g.id))
      const next = new Set<string>()
      if (result.ok && result.running) {
        for (const [id, isRunning] of Object.entries(result.running)) {
          if (isRunning) next.add(id)
        }
      }
      setRunningIds((prev) => {
        if (prev.size === next.size && [...next].every((id) => prev.has(id))) {
          return prev
        }
        return next
      })
    } catch {
      // Falha na listagem: mantém o último estado conhecido (botões ficam
      // como estavam — nunca travar a UI por causa da sondagem).
    }
  }, [])

  useEffect(() => {
    // Sondagem inicial (via timer, não síncrona no efeito) + intervalo.
    // `gamesKey` reexecuta a sondagem quando a lista de jogos muda.
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return (): void => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh, gamesKey])

  return { runningIds, refresh }
}
