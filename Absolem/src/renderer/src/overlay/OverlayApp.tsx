import { useEffect, useRef, useState } from 'react'
import { DEFAULT_AVATAR_ACCENT } from '../../../shared/avatar'
import type { AvatarHandle } from './avatar'
import { parseOverlayFlags } from './overlayFlags'

/**
 * Casca do overlay do avatar (task 02).
 *
 * O fundo é totalmente transparente e o contêiner raiz usa
 * `pointer-events: none`; só a área do avatar recebe cliques. O canvas ocupa
 * essa área e o motor (Three.js) vive em um chunk carregado dinamicamente
 * apenas aqui. Ao entrar na área, o renderer pede ao main para parar de ignorar
 * o mouse (`overlay:set-interactive`), e ao sair pede de volta.
 */
function setInteractive(interactive: boolean): void {
  void window.absolem.overlaySetInteractive(interactive)
}

export function OverlayApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [debugLine, setDebugLine] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const flags = parseOverlayFlags(window.location.hash)
    let disposed = false
    let handle: AvatarHandle | null = null
    let unsubscribeStatus: (() => void) | null = null
    let unsubscribeApply: (() => void) | null = null
    let fakeVoiceTimer: ReturnType<typeof setInterval> | null = null
    let hudTimer: ReturnType<typeof setInterval> | null = null
    let motionMedia: MediaQueryList | null = null
    let visible = true

    const onMotionChange = (): void => {
      handle?.setReducedMotion(motionMedia?.matches === true)
    }

    void (async () => {
      try {
        // Status e chunk do motor são independentes: uma falha de status não
        // impede o avatar de montar (e vice-versa).
        const statusPromise = window.absolem.overlayStatus().catch(() => null)
        const avatarStatusPromise = window.absolem.avatar.getStatus().catch(() => null)
        const module = await import('./avatar')
        const [status, avatarStatus] = await Promise.all([statusPromise, avatarStatusPromise])
        if (disposed) return

        if (status?.ok) visible = status.status.visible
        const reducedMotion =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches

        handle = module.mountAvatar(canvas, {
          theme: { accent: DEFAULT_AVATAR_ACCENT },
          visible,
          reducedMotion,
          debug: flags.debug,
          slow: flags.slow
        })

        if (typeof window.matchMedia === 'function') {
          motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
          motionMedia.addEventListener('change', onMotionChange)
        }

        unsubscribeStatus = window.absolem.onOverlayStatusChanged((next) => {
          visible = next.visible
          handle?.setVisible(visible)
        })

        // Push do main (`avatar:apply`) mantém estado e nível sincronizados.
        unsubscribeApply = window.absolem.avatar.onApply((payload) => {
          if (payload.state) handle?.setState(payload.state)
          if (typeof payload.level === 'number') handle?.setLevel(payload.level)
        })

        // Hidratação no mount: cobre o caso de o overlay abrir depois que a
        // task 06 já mudou o estado.
        if (avatarStatus?.ok) {
          handle.setState(avatarStatus.state)
          handle.setLevel(avatarStatus.level)
        }

        if (flags.fakeVoice) {
          // Driver de demonstração: sem a task 06, gera amplitude suave para a
          // boca. `speaking` só é forçado se nenhum estado real chegou.
          if (!avatarStatus?.ok || avatarStatus.state === 'idle') handle.setState('speaking')
          fakeVoiceTimer = setInterval(() => {
            const time = performance.now() / 1000
            const level = 0.18 + 0.5 * Math.abs(Math.sin(time * 2.4) * Math.sin(time * 3.3))
            handle?.setLevel(level)
          }, 60)
        }

        if (flags.debug) {
          hudTimer = setInterval(() => {
            if (!handle) return
            const metrics = handle.getMetrics()
            setDebugLine(
              `fps ${metrics.fps} | frame ${metrics.frameMs} ms | draws ${metrics.drawCalls} | tris ${metrics.triangles} | deg ${metrics.degradation}`
            )
          }, 500)
        }
      } catch (err) {
        // Falha de carregamento do chunk nunca deixa a área preta/sem conteúdo.
        console.warn('avatar: fallback', err)
        canvas.parentElement?.classList.add('overlay-avatar--fallback')
      }
    })()

    return () => {
      disposed = true
      if (hudTimer) clearInterval(hudTimer)
      if (fakeVoiceTimer) clearInterval(fakeVoiceTimer)
      motionMedia?.removeEventListener('change', onMotionChange)
      unsubscribeStatus?.()
      unsubscribeApply?.()
      handle?.dispose()
      handle = null
    }
  }, [])

  return (
    <div className="overlay-root">
      {/* A task 06 substitui o pointerdown por clique-para-falar. Por ora,
          reafirmar o estado interativo prova que o evento chegou ao overlay. */}
      <div
        className="overlay-avatar"
        role="img"
        aria-label="Avatar do Absolem"
        onPointerEnter={() => setInteractive(true)}
        onPointerLeave={() => setInteractive(false)}
        onPointerDown={() => setInteractive(true)}
      >
        <canvas ref={canvasRef} className="overlay-canvas" aria-hidden="true" />
      </div>
      {debugLine ? <pre className="overlay-debug">{debugLine}</pre> : null}
    </div>
  )
}
