import { useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CircleAlert, Check, Loader2, Send, Square } from 'lucide-react'
import { PROMPT_TEXT_MAX, type OfficeAgent } from '../../../../shared/office'
import { Badge, Button, Switch } from '../ui'

/**
 * Composer de prompt do OpenOffice.
 *
 * Envia direto pelo CLI (`office:prompt`) — **não** depende do plugin. Sessão
 * ocupada recebe o texto na fila (`queue`); o switch "Entregar agora" troca
 * para `steer`. Enter envia, Shift+Enter quebra linha. "Parar" só habilita
 * enquanto a sessão está trabalhando. Nenhum texto é logado pelo main.
 */

export interface PromptComposerProps {
  agent: OfficeAgent
  /** Chamado depois de enviar/parar para o pai reler snapshot e conversa. */
  onActivity?: () => void
  /** Versão enxuta usada no painel de detalhes. */
  compact?: boolean
}

type SendStatus = 'idle' | 'enviando' | 'enviado' | 'falhou'
type StopStatus = 'idle' | 'parando' | 'parado' | 'falhou'

function errorText(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'Não consegui falar com o processo principal.'
}

export function PromptComposer({
  agent,
  onActivity,
  compact = false
}: PromptComposerProps): JSX.Element {
  const [text, setText] = useState('')
  const [deliverNow, setDeliverNow] = useState(false)
  const [sendStatus, setSendStatus] = useState<SendStatus>('idle')
  const [sendError, setSendError] = useState<string | null>(null)
  const [stopStatus, setStopStatus] = useState<StopStatus>('idle')
  const [stopError, setStopError] = useState<string | null>(null)

  const working = agent.status === 'working'
  const sending = sendStatus === 'enviando'
  const stopping = stopStatus === 'parando'
  const canSend = text.trim().length > 0 && !sending

  function send(): void {
    if (!canSend) return
    const value = text.trim()
    setSendStatus('enviando')
    setSendError(null)
    setStopError(null)
    void window.api
      .officePrompt({
        sessionID: agent.sessionID,
        text: value,
        delivery: deliverNow ? 'steer' : 'queue'
      })
      .then((result) => {
        if (!result.ok) {
          setSendStatus('falhou')
          setSendError(result.error ?? 'Não consegui enviar o prompt.')
          return
        }
        // Privacidade: entregue ⇒ o texto sai do estado da UI.
        setText('')
        setSendStatus('enviado')
        onActivity?.()
      })
      .catch((err) => {
        setSendStatus('falhou')
        setSendError(errorText(err))
      })
  }

  function stop(): void {
    if (!working || stopping) return
    setStopStatus('parando')
    setStopError(null)
    void window.api
      .officeInterrupt({ sessionID: agent.sessionID })
      .then((result) => {
        if (!result.ok) {
          setStopStatus('falhou')
          setStopError(result.error ?? 'Não consegui parar a execução.')
          return
        }
        setStopStatus('parado')
        onActivity?.()
      })
      .catch((err) => {
        setStopStatus('falhou')
        setStopError(errorText(err))
      })
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <section
      aria-label={`Prompt para ${agent.name}`}
      data-testid="office-prompt"
      className={compact ? 'space-y-1.5' : 'space-y-2'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
          <Send size={11} aria-hidden="true" />
          Prompt
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-ink-secondary">
          <Switch
            checked={deliverNow}
            onCheckedChange={setDeliverNow}
            disabled={sending}
            aria-label="Entregar agora, interrompendo a execução atual"
            data-testid="office-prompt-steer"
            className="h-6"
          />
          Entregar agora
        </span>
      </div>

      <label htmlFor={`office-prompt-input-${agent.sessionID}`} className="sr-only">
        Mensagem para {agent.name}
      </label>
      <textarea
        id={`office-prompt-input-${agent.sessionID}`}
        data-testid="office-prompt-input"
        value={text}
        rows={compact ? 2 : 3}
        maxLength={PROMPT_TEXT_MAX}
        disabled={sending}
        onChange={(event) => {
          setText(event.target.value)
          if (sendStatus !== 'idle') {
            setSendStatus('idle')
            setSendError(null)
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder="Escreva o prompt… (Enter envia, Shift+Enter quebra linha)"
        className="w-full resize-y rounded-control border border-[var(--border-subtle)] bg-surface-sunken px-2 py-1.5 font-mono text-[11px] leading-snug text-ink-primary placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="tnum text-[9.5px] text-ink-tertiary">
          {text.length}/{PROMPT_TEXT_MAX}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="subtle-danger"
            data-testid="office-prompt-stop"
            disabled={!working || stopping || sending}
            onClick={stop}
            title={working ? 'Parar a execução desta sessão' : 'Só disponível enquanto trabalha'}
          >
            {stopping ? (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Square size={12} aria-hidden="true" />
            )}
            Parar
          </Button>
          <Button
            size="sm"
            variant="primary"
            data-testid="office-prompt-send"
            disabled={!canSend}
            onClick={send}
          >
            {sending ? (
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            ) : (
              <Send size={12} aria-hidden="true" />
            )}
            Enviar
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="min-h-[14px]">
        {sending && (
          <span className="flex items-center gap-1.5 text-[10px] text-ink-tertiary">
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
            enviando…
          </span>
        )}
        {!sending && sendStatus === 'enviado' && (
          <span
            data-testid="office-prompt-status"
            className="flex items-center gap-1.5 text-[10px] text-success"
          >
            <Check size={11} aria-hidden="true" />
            enviado
            <Badge tone="neutral">{deliverNow ? 'entregar agora' : 'na fila'}</Badge>
          </span>
        )}
        {!sending && sendStatus === 'falhou' && (
          <span
            data-testid="office-prompt-status"
            className="flex items-start gap-1.5 text-[10px] leading-snug text-danger"
          >
            <CircleAlert size={11} className="mt-px shrink-0" aria-hidden="true" />
            {sendError ?? 'Não consegui enviar o prompt.'}
          </span>
        )}
        {stopping && (
          <span className="flex items-center gap-1.5 text-[10px] text-ink-tertiary">
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
            parando…
          </span>
        )}
        {!stopping && stopStatus === 'parado' && (
          <span
            data-testid="office-prompt-stop-status"
            className="flex items-center gap-1.5 text-[10px] text-success"
          >
            <Check size={11} aria-hidden="true" />
            execução parada
          </span>
        )}
        {!stopping && stopStatus === 'falhou' && (
          <span
            data-testid="office-prompt-stop-status"
            className="flex items-start gap-1.5 text-[10px] leading-snug text-danger"
          >
            <CircleAlert size={11} className="mt-px shrink-0" aria-hidden="true" />
            {stopError ?? 'Não consegui parar a execução.'}
          </span>
        )}
      </div>
    </section>
  )
}
