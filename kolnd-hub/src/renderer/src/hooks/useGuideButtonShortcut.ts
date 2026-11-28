// useGuideButtonShortcut — atalho do botão PS/Guide (índice 16) para abrir o
// Big Picture com o Hub em foco.
//
// A Gamepad API é poll-based e o botão Guide não gera evento confiável, então
// um `setInterval` curto (150 ms) lê `navigator.getGamepads()` e delega a
// borda ao detector puro (`lib/gamepad/guideButton.ts`). Nada de estado React:
// o hook só tem refs, para não re-renderizar o App a cada tick.
//
// Poll sob demanda: o intervalo de 150 ms só existe com controle conectado.
// A presença é detectada por `navigator.getGamepads().some(Boolean)` no mount
// e pelos eventos `gamepadconnected`/`gamepaddisconnected` — o payload dos
// eventos não é usado (nem todo ambiente expõe `GamepadEvent`), a presença é
// reavaliada a partir da API. Sem pad, nenhum tick do detector roda; resta
// apenas uma checagem de presença a cada 2 s, para o caso de o navegador não
// disparar o evento (1 wake/2 s em vez de 6,7/s).
//
// Gate de foco: sem `document.hasFocus()` nada dispara — o atalho nunca traz o
// Hub para frente nem abre o modo com a janela em segundo plano. O detector é
// resetado nesse caso para que o PS apertado "lá atrás" não dispare ao voltar
// o foco (o primeiro tick após o reset é silencioso).
//
// Visibilidade: com a janela oculta/minimizada (Troca Rápida, bandeja) nenhum
// timer roda; ao ficar visível de novo, a presença é checada na hora e o
// detector é rearmado em silêncio.
//
// O efeito depende de `enabled`: sair do Big Picture (ou abrir um modal)
// desmonta os timers; voltar rearma o detector em silêncio — segurar o PS
// para sair do modo não o reabre no tick seguinte.

import { useEffect, useRef } from 'react'
import { createGuideButtonDetector } from '../lib/gamepad'

/** Intervalo do poll do botão Guide com controle conectado. */
export const GUIDE_POLL_MS = 150

/** Checagem de presença sem controle — cobre `gamepadconnected` não disparado. */
export const GUIDE_PRESENCE_POLL_MS = 2000

export interface UseGuideButtonShortcutOptions {
  /** Habilita o atalho (fora da primeira execução, loading, modais e do modo). */
  enabled: boolean
  /** Chamado na borda de pressão do botão 16 com a janela em foco. */
  onTrigger: () => void
}

/** Snapshot da API: `true` quando algum slot tem controle conectado. */
function hasConnectedPad(): boolean {
  try {
    return navigator.getGamepads().some(Boolean)
  } catch {
    // Driver/API indisponível no momento: trata como ausente e tenta de novo
    // na próxima checagem de presença.
    return false
  }
}

/** Timer de 150 ms é desperdício com a janela oculta (minimizada/bandeja). */
function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export function useGuideButtonShortcut({
  enabled,
  onTrigger
}: UseGuideButtonShortcutOptions): void {
  // Ref para o callback: trocar `onTrigger` não reinicia o poll (nem o prime
  // silencioso) — o efeito só depende de `enabled`.
  const onTriggerRef = useRef(onTrigger)

  useEffect(() => {
    onTriggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return

    const detector = createGuideButtonDetector()
    let pollTimer: number | null = null
    let presenceTimer: number | null = null

    const stopTimers = (): void => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
      if (presenceTimer !== null) {
        window.clearInterval(presenceTimer)
        presenceTimer = null
      }
    }

    const tick = (): void => {
      // Janela em segundo plano/minimizada: nada acontece, e o estado é
      // rearmado em silêncio para o PS segurado não disparar ao focar.
      if (typeof document !== 'undefined' && !document.hasFocus()) {
        detector.reset()
        return
      }

      let pads: (Gamepad | null)[]
      try {
        pads = navigator.getGamepads()
      } catch {
        // Driver/API indisponível no momento: rearma para o próximo tick.
        detector.reset()
        return
      }

      // Desconexão sem evento: o snapshot vazio devolve o hook ao modo de
      // presença em vez de manter o poll de 150 ms acordando à toa.
      if (!pads.some(Boolean)) {
        sync()
        return
      }

      if (detector.update(pads)) onTriggerRef.current()
    }

    // (Re)avalia presença/visibilidade e deixa rodando só o timer necessário.
    function sync(): void {
      stopTimers()

      if (!isDocumentVisible()) {
        // PS segurado enquanto a janela estava oculta não pode disparar ao
        // voltar: o próximo tick será o prime silencioso.
        detector.reset()
        return
      }

      if (hasConnectedPad()) {
        pollTimer = window.setInterval(tick, GUIDE_POLL_MS)
        return
      }

      presenceTimer = window.setInterval(() => {
        if (!hasConnectedPad()) return
        // Controle apareceu (evento perdido): começa o poll de verdade.
        sync()
      }, GUIDE_PRESENCE_POLL_MS)
    }

    const onVisibilityChange = (): void => sync()

    window.addEventListener('gamepadconnected', sync)
    window.addEventListener('gamepaddisconnected', sync)
    document.addEventListener('visibilitychange', onVisibilityChange)
    sync()

    return (): void => {
      stopTimers()
      window.removeEventListener('gamepadconnected', sync)
      window.removeEventListener('gamepaddisconnected', sync)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled])
}
