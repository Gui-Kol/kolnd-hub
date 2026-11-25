// useGuideButtonShortcut — atalho do botão PS/Guide (índice 16) para abrir o
// Big Picture com o Hub em foco.
//
// A Gamepad API é poll-based e o botão Guide não gera evento confiável, então
// um `setInterval` curto (150 ms) lê `navigator.getGamepads()` e delega a
// borda ao detector puro (`lib/gamepad/guideButton.ts`). Nada de estado React:
// o hook só tem refs, para não re-renderizar o App a cada tick.
//
// Gate de foco: sem `document.hasFocus()` nada dispara — o atalho nunca traz o
// Hub para frente nem abre o modo com a janela em segundo plano. O detector é
// resetado nesse caso para que o PS apertado "lá atrás" não dispare ao voltar
// o foco (o primeiro tick após o reset é silencioso).
//
// O efeito depende de `enabled`: sair do Big Picture (ou abrir um modal)
// desmonta o intervalo; voltar rearma o detector em silêncio — segurar o PS
// para sair do modo não o reabre no tick seguinte.

import { useEffect, useRef } from 'react'
import { createGuideButtonDetector } from '../lib/gamepad'

/** Intervalo do poll do botão Guide — folgado o bastante para não gastar CPU. */
export const GUIDE_POLL_MS = 150

export interface UseGuideButtonShortcutOptions {
  /** Habilita o atalho (fora da primeira execução, loading, modais e do modo). */
  enabled: boolean
  /** Chamado na borda de pressão do botão 16 com a janela em foco. */
  onTrigger: () => void
}

export function useGuideButtonShortcut({
  enabled,
  onTrigger
}: UseGuideButtonShortcutOptions): void {
  // Ref para o callback: trocar `onTrigger` não reinicia o intervalo (nem o
  // prime silencioso) — o efeito só depende de `enabled`.
  const onTriggerRef = useRef(onTrigger)

  useEffect(() => {
    onTriggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return

    const detector = createGuideButtonDetector()

    const tick = (): void => {
      if (!enabled) return

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

      if (detector.update(pads)) onTriggerRef.current()
    }

    const timer = setInterval(tick, GUIDE_POLL_MS)

    return (): void => {
      clearInterval(timer)
    }
  }, [enabled])
}
