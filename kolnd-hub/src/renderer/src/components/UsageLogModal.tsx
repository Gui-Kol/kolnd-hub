import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  Download,
  Eraser,
  History,
  Loader2,
  RefreshCw,
  Trash2
} from 'lucide-react'
import {
  USAGE_RETENTION_OPTIONS,
  type UsageEvent,
  type UsageEventType,
  type UsagePage,
  type UsageReadResult,
  type UsageSummary,
  type UsageSummaryResult
} from '../../../shared/usage'
import { formatPlaytime } from '../lib/gameStats'
import { Button, Modal, Select } from './ui'

interface UsageLogModalProps {
  onClose: () => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

const TYPE_LABELS: Record<UsageEventType, string> = {
  'session-start': 'Sessão iniciada',
  'session-end': 'Sessão encerrada',
  'page-view': 'Página aberta',
  'app-launch': 'Programa aberto',
  'app-stop': 'Programa fechado',
  'game-launch': 'Jogo aberto',
  action: 'Ação'
}

const PAGE_LABELS: Record<UsagePage, string> = {
  dashboard: 'Início',
  settings: 'Configurações',
  inicializacao: 'Inicialização',
  biblioteca: 'Biblioteca',
  chat: 'Chat'
}

const ACTION_LABELS = {
  'config-export': 'Exportou a configuração',
  'config-import': 'Importou a configuração'
} as const

type Feedback = { kind: 'done' | 'error' | 'info'; message: string }

/** Chave `YYYY-MM-DD` da data local (mesmo formato gravado pelo main). */
function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Primeiro dia do período (hoje incluso), em data local. */
function sinceDayKey(days: number): string {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 12)
  return localDateKey(start)
}

function formatMoment(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Descrição curta e em pt-BR de cada evento (nunca mostra caminhos). */
function describeEvent(event: UsageEvent): string {
  switch (event.type) {
    case 'session-start':
      return event.version ? `Versão ${event.version}` : 'Kolnd Hub aberto'
    case 'session-end':
      return typeof event.durationSeconds === 'number'
        ? `Ficou aberto por ${formatPlaytime(event.durationSeconds)}`
        : 'Kolnd Hub fechado'
    case 'page-view':
      return event.page ? PAGE_LABELS[event.page] : 'Página aberta'
    case 'app-launch':
      return event.name ? `Abriu ${event.name}` : 'Programa aberto'
    case 'app-stop':
      return event.name ? `Fechou ${event.name}` : 'Programa fechado'
    case 'game-launch':
      return event.name ? `Abriu ${event.name}` : 'Jogo aberto'
    case 'action':
      return event.action ? ACTION_LABELS[event.action] : 'Ação registrada'
    default:
      return event.type
  }
}

function SummaryCard({
  title,
  value,
  hint
}: {
  title: string
  value: string
  hint?: string
}): JSX.Element {
  return (
    <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">{title}</p>
      <p className="mt-1 text-sm font-bold text-ink-primary">{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-ink-secondary">{hint}</p>}
    </div>
  )
}

export function UsageLogModal({ onClose, onToast }: UsageLogModalProps): JSX.Element {
  const [periodDays, setPeriodDays] = useState<number>(30)
  const [typeFilter, setTypeFilter] = useState<'all' | UsageEventType>('all')
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const sequence = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return (): void => {
      mounted.current = false
    }
  }, [])

  const fetchUsage = useCallback(async (): Promise<[UsageReadResult, UsageSummaryResult]> => {
    const from = sinceDayKey(periodDays)
    return Promise.all([
      window.api.readUsage({
        from,
        type: typeFilter === 'all' ? undefined : typeFilter,
        limit: 500
      }),
      window.api.getUsageSummary({ from })
    ])
  }, [periodDays, typeFilter])

  const applyUsage = useCallback(
    (seq: number, readResult: UsageReadResult, summaryResult: UsageSummaryResult): void => {
      if (!mounted.current || seq !== sequence.current) return
      if (!readResult.ok || !summaryResult.ok) {
        setEvents([])
        setSummary(null)
        setLoadError(readResult.error ?? summaryResult.error ?? 'Não foi possível ler o registro.')
        return
      }
      setEvents(readResult.events)
      setSummary(summaryResult.summary)
      setLoadError(null)
    },
    []
  )

  /** Recarrega sob demanda (botão Atualizar/limpar) — nunca a partir do efeito. */
  const load = useCallback(async (): Promise<void> => {
    const seq = ++sequence.current
    try {
      const [readResult, summaryResult] = await fetchUsage()
      applyUsage(seq, readResult, summaryResult)
    } catch {
      if (!mounted.current || seq !== sequence.current) return
      setEvents([])
      setSummary(null)
      setLoadError('Não foi possível ler o registro de uso.')
    } finally {
      if (mounted.current && seq === sequence.current) setLoading(false)
    }
  }, [fetchUsage, applyUsage])

  // Busca inicial e a cada troca de filtro. Os setState ficam nos callbacks da
  // promise (nunca síncronos no corpo do efeito).
  useEffect(() => {
    const seq = ++sequence.current
    fetchUsage()
      .then(([readResult, summaryResult]) => applyUsage(seq, readResult, summaryResult))
      .catch(() => {
        if (!mounted.current || seq !== sequence.current) return
        setEvents([])
        setSummary(null)
        setLoadError('Não foi possível ler o registro de uso.')
      })
      .finally(() => {
        if (mounted.current && seq === sequence.current) setLoading(false)
      })
  }, [fetchUsage, applyUsage])

  /** Troca o filtro já mostrando o estado de carregamento (fora do efeito). */
  const changePeriod = (days: number): void => {
    setLoading(true)
    setPeriodDays(days)
  }

  const changeType = (type: 'all' | UsageEventType): void => {
    setLoading(true)
    setTypeFilter(type)
  }

  const handleExport = async (format: 'json' | 'csv'): Promise<void> => {
    setExporting(format)
    setFeedback(null)
    try {
      const result = await window.api.exportUsage(format)
      if (result.canceled) return
      if (!result.success) throw new Error(result.error ?? 'erro desconhecido')
      setFeedback({
        kind: 'done',
        message: `Arquivo salvo em: ${result.path ?? 'destino escolhido'}`
      })
      onToast?.('Registro de uso exportado.', 'success')
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Falha ao exportar o registro.'
      })
      onToast?.('Falha ao exportar o registro de uso.', 'error')
    } finally {
      if (mounted.current) setExporting(null)
    }
  }

  const handleClear = async (): Promise<void> => {
    setClearing(true)
    setFeedback(null)
    try {
      const result = await window.api.clearUsage()
      if (!result.success) throw new Error(result.error ?? 'erro desconhecido')
      setConfirmClear(false)
      setFeedback({
        kind: 'done',
        message:
          result.removed > 0
            ? `${result.removed} arquivo(s) do registro foram apagados.`
            : 'Não havia registros para apagar.'
      })
      onToast?.('Histórico de uso apagado.', 'success')
      setLoading(true)
      await load()
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Falha ao apagar o registro.'
      })
      onToast?.('Falha ao apagar o histórico de uso.', 'error')
    } finally {
      if (mounted.current) setClearing(false)
    }
  }

  const topApps = summary?.topApps.slice(0, 5) ?? []
  const topGames = summary?.topGames.slice(0, 5) ?? []
  const pageViews = summary?.pageViews

  return (
    <Modal
      title="Registro de uso"
      onClose={onClose}
      className="!max-w-3xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <p className="text-xs leading-relaxed text-ink-secondary">
        Histórico local das ações no Kolnd Hub. Fica só neste PC. Nada é enviado para a internet.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[160px] flex-1 text-xs font-semibold text-ink-secondary">
          Período
          <Select
            className="mt-1.5"
            value={periodDays}
            onChange={(event) => changePeriod(Number(event.target.value))}
            aria-label="Período do registro"
          >
            {USAGE_RETENTION_OPTIONS.map((days) => (
              <option key={days} value={days}>
                Últimos {days} dias
              </option>
            ))}
          </Select>
        </label>
        <label className="min-w-[180px] flex-1 text-xs font-semibold text-ink-secondary">
          Tipo de evento
          <Select
            className="mt-1.5"
            value={typeFilter}
            onChange={(event) => changeType(event.target.value as 'all' | UsageEventType)}
            aria-label="Tipo de evento"
          >
            <option value="all">Todos os eventos</option>
            {(Object.keys(TYPE_LABELS) as UsageEventType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </label>
        <Button
          variant="secondary"
          onClick={() => {
            setLoading(true)
            void load()
          }}
          disabled={loading}
          aria-label="Atualizar registro"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={14} aria-hidden="true" />
          )}
          Atualizar
        </Button>
      </div>

      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard title="Sessões" value={String(summary.totalSessions)} />
          <SummaryCard title="Tempo de uso" value={formatPlaytime(summary.totalSeconds)} />
          <SummaryCard
            title="Programa mais usado"
            value={topApps[0]?.name ?? '—'}
            hint={topApps[0] ? `${topApps[0].launches} abertura(s)` : undefined}
          />
          <SummaryCard
            title="Jogo mais aberto"
            value={topGames[0]?.name ?? '—'}
            hint={topGames[0] ? `${topGames[0].launches} abertura(s)` : undefined}
          />
        </div>
      )}

      {pageViews && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(PAGE_LABELS) as UsagePage[]).map((page) => (
            <SummaryCard
              key={page}
              title={PAGE_LABELS[page]}
              value={`${pageViews[page]} visita(s)`}
            />
          ))}
        </div>
      )}

      <div className="mt-5 rounded-control border border-[var(--border-subtle)] bg-surface-2">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-secondary">Eventos</h3>
          <span className="text-[11px] text-ink-tertiary">
            {events.length} evento(s) no período
          </span>
        </div>

        {loading ? (
          <p role="status" className="flex items-center gap-2 px-4 py-6 text-xs text-ink-secondary">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            Carregando registro…
          </p>
        ) : loadError ? (
          <p role="alert" className="flex items-start gap-2 px-4 py-6 text-xs text-danger">
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {loadError}
          </p>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <History size={22} className="text-ink-tertiary" aria-hidden="true" />
            <p className="text-xs text-ink-secondary">
              Nenhum evento no período. Use o Hub um pouco e volte aqui.
            </p>
          </div>
        ) : (
          <ul className="max-h-[38vh] divide-y divide-[var(--border-subtle)] overflow-y-auto">
            {events.map((event, index) => (
              <li
                key={`${event.ts}-${event.type}-${index}`}
                className="flex items-start justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink-primary">{describeEvent(event)}</p>
                  <p className="mt-0.5 text-[11px] text-ink-tertiary">{TYPE_LABELS[event.type]}</p>
                </div>
                <time className="shrink-0 text-[11px] text-ink-tertiary" dateTime={event.ts}>
                  {formatMoment(event.ts)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      {feedback && (
        <p
          role="status"
          className={`mt-3 flex items-start gap-1.5 break-all text-[11px] leading-relaxed ${
            feedback.kind === 'done'
              ? 'text-success'
              : feedback.kind === 'info'
                ? 'text-ink-secondary'
                : 'text-danger'
          }`}
        >
          {feedback.kind === 'done' && (
            <Check size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          )}
          <span>{feedback.message}</span>
        </p>
      )}

      {confirmClear ? (
        <div className="mt-5 rounded-control border border-danger-border bg-danger-bg px-4 py-3">
          <p className="text-xs leading-relaxed text-danger">
            Isto apaga todo o histórico de uso deste PC. Não pode ser desfeito.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void handleClear()} disabled={clearing}>
              {clearing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 size={14} aria-hidden="true" />
              )}
              {clearing ? 'Apagando…' : 'Sim, apagar tudo'}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmClear(false)} disabled={clearing}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            onClick={() => void handleExport('json')}
            disabled={exporting !== null}
          >
            {exporting === 'json' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={14} aria-hidden="true" />
            )}
            Exportar JSON
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleExport('csv')}
            disabled={exporting !== null}
          >
            {exporting === 'csv' ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={14} aria-hidden="true" />
            )}
            Exportar CSV
          </Button>
          <Button
            variant="subtle-danger"
            onClick={() => {
              setFeedback(null)
              setConfirmClear(true)
            }}
            className="ml-auto"
          >
            <Eraser size={14} aria-hidden="true" />
            Limpar histórico
          </Button>
        </div>
      )}
    </Modal>
  )
}
