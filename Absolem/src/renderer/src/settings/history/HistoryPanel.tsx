import { useEffect, useMemo, useState } from 'react'
import type { HistoryListRequest, HistoryListResult, HistoryTurn } from '../../../../shared/ipc'

/**
 * Histórico recente (task 11, T2).
 *
 * Mostra os últimos 20 turnos com horário, papel, texto e marca de interrompido.
 * Sem edição, sem busca full-text e sem filtro de memória: o histórico completo
 * depende de `memory.enabled`, e a tela diz isso quando a memória está pausada.
 */

export const HISTORY_PAGE_SIZE = 20

export interface HistoryPanelApi {
  list: (request?: HistoryListRequest) => Promise<HistoryListResult>
}

export interface HistoryPanelProps {
  api?: HistoryPanelApi
}

const TIME_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short'
})

function defaultApi(): HistoryPanelApi {
  return { list: (request) => window.absolem.history.list(request) }
}

function formatTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '—'
  return TIME_FORMAT.format(new Date(at))
}

function turnLabel(turn: HistoryTurn): string {
  return turn.role === 'user' ? 'Você' : 'Absolem'
}

export function HistoryPanel({ api }: HistoryPanelProps) {
  const client = useMemo(() => api ?? defaultApi(), [api])
  const [turns, setTurns] = useState<HistoryTurn[]>([])
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void client
      .list({ limit: HISTORY_PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setError(result.error)
          return
        }
        setEnabled(result.enabled)
        setTurns(result.turns)
        setError(null)
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar o histórico.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [client])

  async function copyTurn(index: number, turn: HistoryTurn): Promise<void> {
    const text = `${turnLabel(turn)}: ${turn.text}`
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      setCopied(index)
    } catch {
      setError('Não foi possível copiar o turno.')
    }
  }

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 id="history-title" className="text-sm font-semibold text-ink-primary">
          Histórico recente
        </h3>
        <p className="text-xs text-ink-tertiary">
          Últimos {HISTORY_PAGE_SIZE} turnos. O histórico completo depende da memória habilitada;
          com ela pausada, nada novo é registrado.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded border border-red-400/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-xs text-ink-tertiary">Carregando histórico...</p> : null}

      {!loading && !enabled ? (
        <p
          role="status"
          data-history-disabled
          className="rounded border border-surface-2 px-3 py-2 text-xs text-ink-secondary"
        >
          A memória está pausada. O histórico completo depende da memória habilitada; reative-a na
          seção acima para voltar a registrar turnos.
        </p>
      ) : null}

      {!loading && enabled && turns.length === 0 ? (
        <p
          role="status"
          data-history-empty
          className="rounded border border-surface-2 px-3 py-2 text-xs text-ink-secondary"
        >
          Nenhum turno registrado ainda. As conversas por voz e por texto aparecem aqui quando a
          memória está habilitada.
        </p>
      ) : null}

      {turns.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {turns.map((turn, index) => (
            <li
              key={`${turn.at}-${index}`}
              data-history-turn
              className="flex flex-col gap-1 rounded border border-surface-2 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
                <span className="rounded bg-surface-2 px-2 py-0.5 text-ink-secondary">
                  {turnLabel(turn)}
                </span>
                <time dateTime={new Date(turn.at).toISOString()}>{formatTime(turn.at)}</time>
                {turn.interrupted ? (
                  <span data-history-interrupted className="text-amber-200">
                    interrompido
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void copyTurn(index, turn)
                  }}
                  className="ml-auto rounded border border-surface-2 px-2 py-0.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
                >
                  {copied === index ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-ink-primary">
                {turn.text}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}
