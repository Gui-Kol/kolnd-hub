import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, Loader2, MessagesSquare, RefreshCw } from 'lucide-react'
import { TRANSCRIPT_MESSAGES_MAX, type OfficeTranscriptEntry } from '../../../../shared/office'
import { Button } from '../ui'
import { formatClock } from './format'

/**
 * Conversa do funcionário no OpenOffice.
 *
 * Só partes de TEXTO chegam aqui (o main mascara/trunca); ferramenta, comando
 * e segredo nunca são exibidos. A leitura é sob demanda: monta, envia/para
 * (via `refreshKey`) e o botão "Atualizar" relê o transcrito.
 */

export interface OfficeTranscriptProps {
  sessionID: string
  /** Muda para forçar nova leitura (prompt enviado, execução parada…). */
  refreshKey?: number
  compact?: boolean
}

function authorLabel(role: OfficeTranscriptEntry['role']): string {
  switch (role) {
    case 'user':
      return 'Você'
    case 'assistant':
      return 'Agente'
    default:
      return 'Sistema'
  }
}

export function OfficeTranscript({
  sessionID,
  refreshKey = 0,
  compact = false
}: OfficeTranscriptProps): JSX.Element {
  const [messages, setMessages] = useState<OfficeTranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    void window.api
      .officeTranscript({ sessionID, limit: TRANSCRIPT_MESSAGES_MAX })
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Não consegui ler a conversa desta sessão.')
          return
        }
        setMessages(result.messages)
      })
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setLoading(false))
  }, [sessionID])

  useEffect(() => {
    // Microtask: a leitura é assíncrona e não dispara setState no corpo do efeito.
    let alive = true
    queueMicrotask(() => {
      if (alive) load()
    })
    return () => {
      alive = false
    }
  }, [load, refreshKey])

  return (
    <section
      aria-label="Conversa"
      data-testid="office-transcript"
      className={compact ? 'space-y-1.5' : 'space-y-2'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
          <MessagesSquare size={11} aria-hidden="true" />
          Conversa
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={loading}
          aria-label="Atualizar conversa"
          data-testid="office-transcript-refresh"
        >
          <RefreshCw
            size={11}
            className={loading ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          Atualizar
        </Button>
      </div>

      <div aria-live="polite">
        {loading && messages.length === 0 && (
          <p className="flex items-center gap-1.5 text-[10.5px] text-ink-tertiary">
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
            lendo conversa…
          </p>
        )}
        {!loading && error && (
          <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-danger">
            <CircleAlert size={11} className="mt-px shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {!loading && !error && messages.length === 0 && (
          <p className="text-[10.5px] text-ink-tertiary">
            Nenhuma mensagem de texto nesta sessão ainda.
          </p>
        )}
      </div>

      {messages.length > 0 && (
        <ul
          className={`space-y-1.5 overflow-y-auto rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-2 ${
            compact ? 'max-h-[140px]' : 'max-h-[180px]'
          }`}
          aria-label="Últimas mensagens"
        >
          {messages.map((message, index) => (
            <li
              key={`${message.id ?? 'msg'}-${message.at}-${index}`}
              data-testid="office-transcript-message"
              className="text-[10.5px] leading-snug"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`font-semibold ${
                    message.role === 'user' ? 'text-accent' : 'text-ink-secondary'
                  }`}
                >
                  {authorLabel(message.role)}
                </span>
                <span className="tnum text-[9.5px] text-ink-tertiary">
                  {formatClock(message.at)}
                </span>
              </span>
              <span className="mt-0.5 block whitespace-pre-wrap break-words text-ink-primary">
                {message.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
