import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ChatDeltaPush, ChatDonePush, ChatErrorPush } from '../../../../shared/gemini'
import { VOICE_STATE_LABELS, type VoiceState } from '../../../../shared/voice'

/**
 * Camada conversacional do overlay (task 11, T1).
 *
 * Não é um chat: mostra o estado da voz, no máximo 2 linhas da transcrição do
 * usuário e um balão de resposta curto (6 linhas; 20 expandido). O texto usa
 * `chat:delta` por `requestId` e é sempre renderizado como texto (nunca HTML).
 * O balão some ao começar um novo turno, ao fechar ou após 30 s sem interação.
 */

export const CONVERSATION_IDLE_MS = 30_000
export const CONVERSATION_COLLAPSED_LINES = 6
export const CONVERSATION_EXPANDED_LINES = 20

export interface ConversationApi {
  onDelta: (listener: (push: ChatDeltaPush) => void) => () => void
  onDone?: (listener: (push: ChatDonePush) => void) => () => void
  onError?: (listener: (push: ChatErrorPush) => void) => () => void
  cancel: (requestId: string) => Promise<unknown>
  interrupt: () => Promise<unknown>
  openSettings?: () => Promise<unknown>
  requestScreen?: () => Promise<unknown> | void
}

export interface ConversationLayerProps {
  voiceState: VoiceState
  /** Última fala do usuário (transcrição curta). */
  transcript?: string | null
  /** Turno de texto em curso; deltas de outro requestId são ignorados. */
  requestId?: string | null
  api?: ConversationApi
  onClose?: () => void
  /** Campo de texto montado só no modo expandido (task 11, T3). */
  input?: ReactNode
}

function defaultApi(): ConversationApi {
  return {
    onDelta: (listener) => window.absolem.chat.onDelta(listener),
    onDone: (listener) => window.absolem.chat.onDone(listener),
    onError: (listener) => window.absolem.chat.onError(listener),
    cancel: (requestId) => window.absolem.chat.cancel(requestId),
    interrupt: () => window.absolem.voice.interrupt(),
    openSettings: () => window.absolem.openSettings(),
    requestScreen: () =>
      window.absolem.capture.ask({
        requestId: `screen-${Date.now().toString(36)}`,
        kind: 'screen',
        question: 'Descreva o que está na tela.'
      })
  }
}

const lineStyle: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
}

export function ConversationLayer({
  voiceState,
  transcript,
  requestId,
  api,
  onClose,
  input
}: ConversationLayerProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [response, setResponse] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const currentRequest = useRef<string | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function armIdleTimer(): void {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null
      setResponse('')
      setOpen(false)
      setStreaming(false)
    }, CONVERSATION_IDLE_MS)
  }

  function clearIdleTimer(): void {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = null
  }

  useEffect(() => {
    const matches = (incoming: string): boolean =>
      requestId == null || requestId === '' || incoming === requestId

    const unsubscribeDelta = client.onDelta((push) => {
      if (!push || typeof push.text !== 'string' || !matches(push.requestId)) return
      // requestId diferente = novo turno: o texto anterior não é concatenado.
      setResponse((current) =>
        currentRequest.current === push.requestId ? `${current}${push.text}` : push.text
      )
      currentRequest.current = push.requestId
      setOpen(true)
      setStreaming(true)
      armIdleTimer()
    })
    const unsubscribeDone = client.onDone?.((push) => {
      if (!push || !matches(push.requestId)) return
      currentRequest.current = push.requestId
      setStreaming(false)
      setOpen(true)
      armIdleTimer()
    })
    const unsubscribeError = client.onError?.((push) => {
      if (!push || !matches(push.requestId)) return
      currentRequest.current = push.requestId
      setResponse((current) => current || `Não foi possível responder: ${push.message}`)
      setStreaming(false)
      setOpen(true)
      armIdleTimer()
    })
    return () => {
      unsubscribeDelta()
      unsubscribeDone?.()
      unsubscribeError?.()
    }
  }, [client, requestId])

  useEffect(() => () => clearIdleTimer(), [])

  function closeBubble(): void {
    const active = currentRequest.current
    if (active && streaming) void client.cancel(active).catch(() => undefined)
    clearIdleTimer()
    setOpen(false)
    setExpanded(false)
    setResponse('')
    setStreaming(false)
    onClose?.()
  }

  function interrupt(): void {
    void client.interrupt().catch(() => undefined)
  }

  function openSettings(): void {
    void client.openSettings?.().catch(() => undefined)
  }

  function requestScreen(): void {
    void Promise.resolve(client.requestScreen?.()).catch(() => undefined)
    armIdleTimer()
  }

  const lines = expanded ? CONVERSATION_EXPANDED_LINES : CONVERSATION_COLLAPSED_LINES

  return (
    <section className="conversation-layer" aria-label="Conversa do Absolem">
      <div className="conversation-head">
        <p
          className="conversation-status"
          role="status"
          aria-live="polite"
          data-voice-state={voiceState}
        >
          {VOICE_STATE_LABELS[voiceState]}
        </p>
        <button
          type="button"
          className="conversation-button"
          onClick={() => {
            setExpanded(true)
            setOpen(true)
            armIdleTimer()
          }}
        >
          Escrever
        </button>
      </div>

      {transcript ? (
        <p className="conversation-transcript" style={{ ...lineStyle, WebkitLineClamp: 2 }}>
          {transcript}
        </p>
      ) : null}

      {open && (response || streaming || expanded) ? (
        <div className="conversation-bubble" data-conversation-bubble>
          {response || streaming ? (
            <p
              className="conversation-response"
              data-conversation-response
              data-streaming={streaming ? 'true' : 'false'}
              style={{ ...lineStyle, WebkitLineClamp: lines }}
            >
              {response}
            </p>
          ) : null}
          {expanded && input ? input : null}
          <div className="conversation-actions">
            {voiceState === 'speaking' ? (
              <button type="button" onClick={interrupt} className="conversation-button">
                Interromper
              </button>
            ) : null}
            <button type="button" onClick={requestScreen} className="conversation-button">
              Ver tela
            </button>
            <button type="button" onClick={openSettings} className="conversation-button">
              Configurações
            </button>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="conversation-button"
              aria-expanded={expanded}
            >
              {expanded ? 'Recolher' : 'Expandir'}
            </button>
            <button type="button" onClick={closeBubble} className="conversation-button">
              Fechar balão
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
