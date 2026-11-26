import { useEffect, useRef, useState } from 'react'
import { DEFAULT_AVATAR_ACCENT } from '../../../shared/avatar'
import { VOICE_REASONS, VOICE_STATE_LABELS, type VoiceState } from '../../../shared/voice'
import type { AvatarHandle } from './avatar'
import { parseOverlayFlags } from './overlayFlags'
import workletUrl from '../audio/pcm-worklet.js?url'
import {
  PCM_WORKLET_NAME,
  createPcmCapture,
  type AudioContextLike,
  type AudioWorkletNodeLike,
  type PcmCapture
} from '../audio/capture'
import { createPlayback, type Playback, type PlaybackAudioContextLike } from '../audio/playback'
import { createVad, type Vad } from '../audio/vad'
import { pcm16BytesToFloat, pcm16Rms } from '../audio/pcm'
import { createDeviceWatcher, type DeviceWatcher, type MediaDevicesLike } from '../audio/devices'
import { createDomGrabFactories, grabFrame } from '../capture/grab'
import type { CaptureIndicatorPush, CaptureRequestPush } from '../../../shared/screen'
import type { SearchIndicatorPush } from '../../../shared/search'

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
  // Observável de smoke: prova que o push `theme:changed` chegou e foi aplicado.
  const [themePresetId, setThemePresetId] = useState('')
  const [voiceState, setVoiceState] = useState<VoiceState>('off')
  const [voiceReason, setVoiceReason] = useState<string | null>(null)
  const [captureIndicator, setCaptureIndicator] = useState<CaptureIndicatorPush | null>(null)
  const [searchIndicator, setSearchIndicator] = useState<SearchIndicatorPush | null>(null)
  const voiceToggleRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const flags = parseOverlayFlags(window.location.hash)
    let disposed = false
    let handle: AvatarHandle | null = null
    let unsubscribeStatus: (() => void) | null = null
    let unsubscribeApply: (() => void) | null = null
    let unsubscribeTheme: (() => void) | null = null
    let fakeVoiceTimer: ReturnType<typeof setInterval> | null = null
    let hudTimer: ReturnType<typeof setInterval> | null = null
    let motionMedia: MediaQueryList | null = null
    let visible = true
    let themeReducedMotion = false

    // Voz (task 06): captura PCM, reprodução e VAD vivem no renderer; o main
    // é o dono do estado. Estas variáveis são recriadas a cada mount.
    let playback: Playback | null = null
    let playbackContext: AudioContext | null = null
    let capture: PcmCapture | null = null
    let vad: Vad = createVad()
    let unsubscribeVoiceState: (() => void) | null = null
    let unsubscribeVoiceAudio: (() => void) | null = null
    let unsubscribeCaptureRequest: (() => void) | null = null
    let unsubscribeCaptureIndicator: (() => void) | null = null
    let unsubscribeSearchIndicator: (() => void) | null = null
    let voiceLevelTimer: ReturnType<typeof setInterval> | null = null
    let currentVoiceState: VoiceState = 'off'
    let lastMicLevel = 0
    let inputDeviceId: string | null = null
    let outputDeviceId: string | null = null
    let outputVolume = 1
    let deviceWatcher: DeviceWatcher | null = null

    const ensurePlayback = async (): Promise<boolean> => {
      if (disposed) return false
      if (!playbackContext) {
        try {
          playbackContext = new AudioContext({ sampleRate: 48_000 })
        } catch {
          try {
            playbackContext = new AudioContext()
          } catch {
            return false
          }
        }
        playback = createPlayback({
          context: playbackContext as unknown as PlaybackAudioContextLike,
          getVolume: () => outputVolume,
          logger: { warn: (scope, message) => console.warn(scope, message) }
        })
        if (outputDeviceId) void playback.setOutputDevice(outputDeviceId)
      }
      if (playbackContext.state === 'suspended') {
        try {
          await playbackContext.resume()
        } catch {
          // Sem gesto: o próximo clique tenta de novo.
        }
      }
      return true
    }

    const handleMicChunk = (chunk: Uint8Array): void => {
      window.absolem.voice.sendAudioChunk(chunk)
      lastMicLevel = pcm16Rms(chunk)
      const events = vad.process(pcm16BytesToFloat(chunk), performance.now())
      for (const event of events) {
        if (event.type === 'speech-start') {
          // Barge-in só durante a fala do modelo; em `listening` o VAD só
          // alimenta o indicador.
          if (currentVoiceState === 'speaking') {
            playback?.flush()
            window.absolem.voice.sendBargeIn()
          }
        } else {
          window.absolem.voice.sendSilence()
        }
      }
    }

    const startCapture = async (): Promise<void> => {
      if (disposed) return
      if (!(await ensurePlayback())) return
      if (!capture) {
        capture = createPcmCapture({
          // Contexto próprio da captura: fechá-lo no stop não derruba o
          // contexto de reprodução.
          createContext: () => {
            try {
              return new AudioContext({ sampleRate: 48_000 }) as unknown as AudioContextLike
            } catch {
              return new AudioContext() as unknown as AudioContextLike
            }
          },
          getUserMedia: (constraints) =>
            navigator.mediaDevices.getUserMedia(constraints as unknown as MediaStreamConstraints),
          createWorkletNode: (context) =>
            new AudioWorkletNode(
              context as unknown as BaseAudioContext,
              PCM_WORKLET_NAME
            ) as unknown as AudioWorkletNodeLike,
          workletUrl,
          getDeviceId: () => inputDeviceId,
          onChunk: handleMicChunk,
          logger: { warn: (scope, message) => console.warn(scope, message) }
        })
      }
      await capture.start()
    }

    const handleCaptureRequest = async (push: CaptureRequestPush): Promise<void> => {
      try {
        const frame = await grabFrame(push.sourceId, createDomGrabFactories(), {
          lossless: push.lossless
        })
        await window.absolem.capture.sendFrame({
          requestId: push.requestId,
          ok: true,
          mime: frame.mime,
          data: frame.data,
          width: frame.width,
          height: frame.height
        })
      } catch (err) {
        await window.absolem.capture.sendFrame({
          requestId: push.requestId,
          ok: false,
          error: err instanceof Error ? err.message.slice(0, 300) : 'falha ao capturar a tela'
        })
      }
    }

    const startLevelTimer = (): void => {
      if (voiceLevelTimer) return
      voiceLevelTimer = setInterval(() => {
        if (currentVoiceState === 'speaking') {
          handle?.setLevel(playback?.getLastLevel() ?? 0)
        } else if (currentVoiceState === 'listening' || currentVoiceState === 'thinking') {
          handle?.setLevel(lastMicLevel)
          lastMicLevel *= 0.82
        } else {
          handle?.setLevel(0)
        }
      }, 60)
    }

    const stopLevelTimer = (): void => {
      if (voiceLevelTimer) clearInterval(voiceLevelTimer)
      voiceLevelTimer = null
    }

    const applyVoiceState = (change: { state: VoiceState; reason?: string }): void => {
      currentVoiceState = change.state
      setVoiceState(change.state)
      setVoiceReason(change.reason ?? null)
      if (
        change.state === 'listening' &&
        (change.reason === VOICE_REASONS.interrupted || change.reason === VOICE_REASONS.bargeIn)
      ) {
        // Interrupção pedida pelo main (botão "interromper") ou barge-in:
        // corta o áudio já agendado no renderer. O fim natural do turno não
        // flusha, para não cortar a cauda da resposta.
        playback?.flush()
      }
      if (change.state === 'listening' || change.state === 'speaking') {
        startLevelTimer()
        void startCapture()
      } else if (change.state === 'connecting' || change.state === 'thinking') {
        startLevelTimer()
      } else {
        capture?.stop()
        playback?.flush()
        vad = createVad()
        lastMicLevel = 0
        handle?.setLevel(0)
        stopLevelTimer()
      }
    }

    const onAvatarPointerDown = (): void => {
      setInteractive(true)
      void (async () => {
        await ensurePlayback()
        await window.absolem.voice.toggle()
      })()
    }
    voiceToggleRef.current = onAvatarPointerDown

    const onMotionChange = (): void => {
      handle?.setReducedMotion(motionMedia?.matches === true || themeReducedMotion)
    }

    void (async () => {
      try {
        // Status e chunk do motor são independentes: uma falha de status não
        // impede o avatar de montar (e vice-versa).
        const statusPromise = window.absolem.overlayStatus().catch(() => null)
        const avatarStatusPromise = window.absolem.avatar.getStatus().catch(() => null)
        const themePromise = window.absolem.themeGet().catch(() => null)
        const voiceStatusPromise = window.absolem.voice.status().catch(() => null)
        const captureStatusPromise = window.absolem.capture.status().catch(() => null)

        // Captura (task 07): o main pede um frame e o overlay responde. O
        // indicador de olho aparece enquanto a captura está em curso.
        unsubscribeCaptureRequest = window.absolem.capture.onRequest((push) => {
          if (!disposed) void handleCaptureRequest(push)
        })
        unsubscribeCaptureIndicator = window.absolem.capture.onIndicator((push) => {
          if (!disposed) setCaptureIndicator(push.active ? push : null)
        })
        // Indicador discreto de pesquisa/abertura de página (task 10, T7).
        unsubscribeSearchIndicator = window.absolem.search.onIndicator((push) => {
          if (!disposed) setSearchIndicator(push.active ? push : null)
        })

        const module = await import('./avatar')
        const [status, avatarStatus, themeResult, voiceStatusResult, captureStatus] =
          await Promise.all([
            statusPromise,
            avatarStatusPromise,
            themePromise,
            voiceStatusPromise,
            captureStatusPromise
          ])
        if (disposed) return

        if (captureStatus?.ok && captureStatus.status.active) {
          setCaptureIndicator({
            active: true,
            ...(captureStatus.status.kind ? { kind: captureStatus.status.kind } : {})
          })
        }

        if (voiceStatusResult?.ok) {
          inputDeviceId = voiceStatusResult.status.inputDeviceId
          outputDeviceId = voiceStatusResult.status.outputDeviceId
          outputVolume = Math.min(1, Math.max(0, voiceStatusResult.status.outputVolume))
        }

        // Hot-swap: se o dispositivo escolhido sumir, o main encerra a sessão
        // e a preferência volta ao default. Nunca troca no meio de uma fala.
        if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
          deviceWatcher = createDeviceWatcher({
            mediaDevices: navigator.mediaDevices as unknown as MediaDevicesLike,
            getSelection: () => ({ inputDeviceId, outputDeviceId }),
            onSelectionLost: (kind) => {
              if (kind === 'input') {
                inputDeviceId = null
                void window.absolem.voice.setDevice({ inputDeviceId: null })
              } else {
                outputDeviceId = null
                void window.absolem.voice.setDevice({ outputDeviceId: null })
              }
            },
            onError: (err) => console.warn('devices: falha ao atualizar a lista', err)
          })
          void deviceWatcher.refresh()
        }
        if (status?.ok) visible = status.status.visible
        const systemReducedMotion =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const theme = themeResult?.ok ? themeResult.theme : null
        themeReducedMotion = theme?.reducedMotion === true
        if (theme) setThemePresetId(theme.presetId)
        const reducedMotion = systemReducedMotion || themeReducedMotion

        handle = module.mountAvatar(canvas, {
          theme: { accent: DEFAULT_AVATAR_ACCENT },
          ...(theme ? { themeConfig: theme } : {}),
          visible,
          reducedMotion,
          debug: flags.debug,
          slow: flags.slow
        })

        if (typeof window.matchMedia === 'function') {
          motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')
          motionMedia.addEventListener('change', onMotionChange)
        }

        // Push `theme:changed`: aplicar a quente, sem remontar a cena.
        unsubscribeTheme = window.absolem.onThemeChanged((next) => {
          themeReducedMotion = next.reducedMotion
          document.documentElement.dataset.themeReceivedAt = String(Date.now())
          setThemePresetId(next.presetId)
          handle?.applyTheme(next)
          if (motionMedia) {
            handle?.setReducedMotion(motionMedia.matches || next.reducedMotion)
          }
        })

        unsubscribeStatus = window.absolem.onOverlayStatusChanged((next) => {
          visible = next.visible
          handle?.setVisible(visible)
        })

        // Push do main (`avatar:apply`) mantém estado e nível sincronizados.
        unsubscribeApply = window.absolem.avatar.onApply((payload) => {
          if (payload.state) handle?.setState(payload.state)
          if (typeof payload.level === 'number') handle?.setLevel(payload.level)
        })

        // Voz: o main manda o estado; o renderer só reflete e alimenta o
        // áudio local (captura, reprodução e VAD).
        unsubscribeVoiceState = window.absolem.voice.onState((change) => {
          if (!disposed) applyVoiceState(change)
        })
        unsubscribeVoiceAudio = window.absolem.voice.onAudio((push) => {
          if (disposed) return
          if (!playback) {
            void ensurePlayback().then(() => {
              playback?.enqueue(push.data, push.sampleRate)
            })
            return
          }
          playback.enqueue(push.data, push.sampleRate)
        })

        // Hidratação no mount: cobre o caso de o overlay abrir depois que a
        // task 06 já mudou o estado.
        if (voiceStatusResult?.ok) {
          applyVoiceState({
            state: voiceStatusResult.status.state,
            ...(voiceStatusResult.status.reason ? { reason: voiceStatusResult.status.reason } : {})
          })
        }
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
      stopLevelTimer()
      deviceWatcher?.stop()
      capture?.stop()
      playback?.dispose()
      if (playbackContext) void playbackContext.close().catch(() => undefined)
      motionMedia?.removeEventListener('change', onMotionChange)
      unsubscribeStatus?.()
      unsubscribeApply?.()
      unsubscribeTheme?.()
      unsubscribeVoiceState?.()
      unsubscribeVoiceAudio?.()
      unsubscribeCaptureRequest?.()
      unsubscribeCaptureIndicator?.()
      unsubscribeSearchIndicator?.()
      handle?.dispose()
      handle = null
    }
  }, [])

  return (
    <div className="overlay-root" data-theme-preset={themePresetId} data-voice-state={voiceState}>
      {/* Clique no avatar = toggle da voz (task 06). O pointerdown também
          mantém a janela interativa enquanto o mouse está sobre o avatar. */}
      <div
        className="overlay-avatar"
        role="button"
        tabIndex={-1}
        aria-label={`Avatar do Absolem. ${VOICE_STATE_LABELS[voiceState]}.`}
        aria-pressed={voiceState !== 'off'}
        title={voiceReason ?? VOICE_STATE_LABELS[voiceState]}
        onPointerEnter={() => setInteractive(true)}
        onPointerLeave={() => setInteractive(false)}
        onPointerDown={() => voiceToggleRef.current()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            voiceToggleRef.current()
          }
        }}
      >
        <canvas ref={canvasRef} className="overlay-canvas" aria-hidden="true" />
      </div>
      <div
        className="voice-indicator"
        data-voice-state={voiceState}
        role="status"
        aria-live="polite"
        title={voiceReason ?? VOICE_STATE_LABELS[voiceState]}
      >
        <span className="voice-indicator__dot" aria-hidden="true" />
        <span className="voice-indicator__waves" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="voice-indicator__label">{VOICE_STATE_LABELS[voiceState]}</span>
      </div>
      {captureIndicator?.active ? (
        <div
          className="capture-indicator"
          data-capture-kind={captureIndicator.kind ?? 'screen'}
          role="status"
          aria-live="polite"
          title="Absolem está vendo a tela"
        >
          <span className="capture-indicator__eye" aria-hidden="true" />
          <span className="capture-indicator__label">Vendo a tela</span>
        </div>
      ) : null}
      {searchIndicator?.active ? (
        <div
          className="search-indicator"
          data-search-kind={searchIndicator.kind ?? 'search'}
          role="status"
          aria-live="polite"
          title={searchIndicator.kind === 'fetch' ? 'Abrindo página' : 'Pesquisando na internet'}
        >
          <span className="search-indicator__icon" aria-hidden="true" />
          <span className="search-indicator__label">
            {searchIndicator.kind === 'fetch' ? 'Abrindo página' : 'Pesquisando'}
          </span>
        </div>
      ) : null}
      {debugLine ? <pre className="overlay-debug">{debugLine}</pre> : null}
    </div>
  )
}
