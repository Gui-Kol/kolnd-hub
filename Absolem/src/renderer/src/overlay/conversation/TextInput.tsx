import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

/**
 * Entrada de texto como apoio (task 11, T3).
 *
 * Uma linha, `Enter` envia e `Esc` fecha. O overlay nasce sem foco; o main
 * recebe `overlay:set-input-mode` para virar focável enquanto o campo é usado e
 * reverte em Esc, ao fechar, ao esconder o overlay ou após 30 s sem digitação.
 */

export const TEXT_INPUT_IDLE_MS = 30_000
export const TEXT_INPUT_MAX_CHARS = 2_000

export interface TextInputApi {
  send: (requestId: string, text: string) => Promise<unknown>
  setInputMode: (active: boolean) => Promise<unknown>
}

export interface TextInputProps {
  api?: TextInputApi
  /** Recebe o requestId para correlacionar a resposta no mesmo balão. */
  onSend?: (requestId: string, text: string) => void
  onClose: () => void
  /** Injetado no teste; em produção usa crypto/Date. */
  newRequestId?: () => string
  disabled?: boolean
}

function defaultApi(): TextInputApi {
  return {
    send: (requestId, text) => window.absolem.chat.send(requestId, text),
    setInputMode: (active) => window.absolem.overlaySetInputMode(active)
  }
}

function defaultRequestId(): string {
  const cryptoApi = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function TextInput({
  api,
  onSend,
  onClose,
  newRequestId = defaultRequestId,
  disabled = false
}: TextInputProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearIdleTimer(): void {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = null
  }

  function touch(): void {
    void client.setInputMode(true).catch(() => undefined)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null
      onClose()
    }, TEXT_INPUT_IDLE_MS)
  }

  useEffect(() => {
    void client.setInputMode(true).catch(() => undefined)
    // Não rouba foco de outro app se a janela estiver oculta.
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      inputRef.current?.focus()
    }
    touch()
    return () => {
      clearIdleTimer()
      void client.setInputMode(false).catch(() => undefined)
    }
    // Só na montagem: `touch` usa o client memoizado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  function close(): void {
    clearIdleTimer()
    void client.setInputMode(false).catch(() => undefined)
    onClose()
  }

  async function send(): Promise<void> {
    const value = text.trim()
    if (!value || sending || disabled) return
    setError(null)
    setSending(true)
    const requestId = newRequestId()
    onSend?.(requestId, value)
    try {
      const result = (await client.send(requestId, value)) as { ok?: boolean; error?: string }
      if (result && result.ok === false) setError(result.error ?? 'Não foi possível enviar.')
      else setText('')
    } catch {
      setError('Não foi possível enviar a mensagem.')
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape' || event.key === 'Esc') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="text-input">
      <label htmlFor="overlay-text-input" className="sr-only">
        Escreva para o Absolem
      </label>
      <input
        ref={inputRef}
        id="overlay-text-input"
        type="text"
        value={text}
        maxLength={TEXT_INPUT_MAX_CHARS}
        placeholder="Escreva para o Absolem"
        autoComplete="off"
        disabled={disabled || sending}
        onChange={(event) => {
          setText(event.target.value)
          touch()
        }}
        onKeyDown={onKeyDown}
        className="text-input__field"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'overlay-text-input-error' : undefined}
      />
      <button
        type="button"
        onClick={() => {
          void send()
        }}
        disabled={disabled || sending || text.trim().length === 0}
        className="text-input__send"
      >
        Enviar
      </button>
      {error ? (
        <p id="overlay-text-input-error" role="alert" className="text-input__error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
