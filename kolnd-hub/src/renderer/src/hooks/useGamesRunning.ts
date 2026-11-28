// useGamesRunning — "quais jogos estão abertos?" para a Biblioteca e o Big Picture.
//
// Assina o agendador único do main (`process-watch`, 10 s): cada push dispara
// `games:running-map`, que aproveita o cache de 5 s da consulta de processos.
// Antes o hook tinha um timer próprio de 4 s que furava esse cache. O estado é
// atualizado de forma otimizada: só re-renderiza quando a composição muda.
//
// Também expõe `refresh()` para reconsultar imediatamente após lançar ou
// encerrar um jogo pelo Hub (sensação de resposta instantânea).

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game } from '../types'

const POLL_INTERVAL_MS = 10000
const CONSUMER_ID = 'games:running'

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
    let active = true
    // `gamesKey` reexecuta a assinatura quando a lista de jogos muda; o main
    // mantém um único timer no menor intervalo pedido por todos os consumidores.
    const unsubscribe = window.api.onProcessWatchUpdate(() => {
      if (active) void refresh()
    })
    const initial = window.setTimeout(() => void refresh(), 0)
    void window.api.startProcessWatch(CONSUMER_ID, POLL_INTERVAL_MS).catch(() => {
      // Sem main: mantém o último estado conhecido; o refresh manual continua.
    })
    return (): void => {
      active = false
      window.clearTimeout(initial)
      unsubscribe()
      void window.api.stopProcessWatch(CONSUMER_ID).catch(() => undefined)
    }
  }, [refresh, gamesKey])

  return { runningIds, refresh }
}
