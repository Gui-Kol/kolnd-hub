import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Store,
  X
} from 'lucide-react'
import { WingetListResult } from '../types'
import { Button, Card } from './ui'

/** Link da página do App Installer na Microsoft Store (para quem não tem winget). */
const APP_INSTALLER_STORE_URL = 'https://apps.microsoft.com/detail/9NBLGGH4NNS1'

type ItemStatus = 'aguardando' | 'atualizando' | 'concluido' | 'erro' | 'cancelado'

interface ItemState {
  status: ItemStatus
  exitCode?: number | null
  log?: string
}

interface SummaryState {
  text: string
  tone: 'ok' | 'warn' | 'error'
}

/** Checkbox nativo com acento (não há primitivo Checkbox); `indeterminate` p/ estado misto. */
interface SelectBoxProps {
  state: 'off' | 'on' | 'partial'
  disabled?: boolean
  onToggle: () => void
  title?: string
}

function SelectBox({ state, disabled, onToggle, title }: SelectBoxProps): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'partial'
  }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state !== 'off'}
      disabled={disabled}
      onChange={onToggle}
      aria-label={title ?? 'Selecionar'}
      title={title}
      className="h-5 w-5 shrink-0 accent-accent disabled:cursor-not-allowed disabled:opacity-40"
    />
  )
}

/** Badge de status por item: aguardando → atualizando → concluído ✓ / erro ✗. */
function StatusBadge({ state }: { state: ItemState }): JSX.Element {
  switch (state.status) {
    case 'aguardando':
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-[var(--border-strong)] bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-ink-tertiary">
          aguardando…
        </span>
      )
    case 'atualizando':
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-accent-border bg-accent-muted px-2.5 py-1 text-[10px] font-bold text-accent">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          atualizando…
        </span>
      )
    case 'concluido':
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-success-border bg-success-bg px-2.5 py-1 text-[10px] font-bold text-success">
          <CheckCircle2 size={12} aria-hidden="true" />
          concluído
        </span>
      )
    case 'cancelado':
      return (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-warn-border bg-warn-bg px-2.5 py-1 text-[10px] font-bold text-warn"
          title={
            state.exitCode !== undefined
              ? `Código de saída: ${state.exitCode ?? 'desconhecido'}`
              : undefined
          }
        >
          cancelado
        </span>
      )
    case 'erro':
      return (
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-danger-border bg-danger-bg px-2.5 py-1 text-[10px] font-bold text-danger"
          title={`Código de saída: ${state.exitCode ?? 'desconhecido'}`}
        >
          <AlertTriangle size={12} aria-hidden="true" />
          erro
        </span>
      )
  }
}

export function PcUpdates(): JSX.Element {
  // Entrada decorativa dos itens da lista vira fade curto com reduce.
  const reduced = useReducedMotion()
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<WingetListResult | null>(null)
  const [showRawLog, setShowRawLog] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<SummaryState | null>(null)
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const cancelRef = useRef(false)

  // Executa a busca e devolve o resultado (nunca lança — erros viram WingetListResult).
  const fetchOnce = useCallback(async (): Promise<WingetListResult> => {
    try {
      return await window.api.listUpgradableUpdates()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `Não foi possível verificar as atualizações: ${message}` }
    }
  }, [])

  // Atualização manual (botão "Verificar novamente"): liga o spinner na hora e
  // descarta estados de rodadas anteriores (não faz sentido manter badges velhos).
  const check = useCallback((): void => {
    if (running) return
    setLoading(true)
    setShowRawLog(false)
    setSummary(null)
    setItemStates({})
    setExpandedLogs(new Set())
    setProgress(null)
    void fetchOnce().then((res) => {
      setResult(res)
      setLoading(false)
      setSelected(
        (prev) => new Set([...prev].filter((id) => (res.items ?? []).some((i) => i.id === id)))
      )
    })
  }, [fetchOnce, running])

  // Busca automática ao abrir a aba: sem setState síncrono no corpo do efeito;
  // tudo acontece nos callbacks .then (ignora o resultado se desmontar antes).
  useEffect(() => {
    let cancelled = false
    void fetchOnce().then((res) => {
      if (cancelled) return
      setResult(res)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchOnce])

  const items = result?.ok ? (result.items ?? []) : []
  const selectedCount = items.filter((i) => selected.has(i.id)).length
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id))
  const someSelected = !allSelected && items.some((i) => selected.has(i.id))

  const toggleOne = (id: string): void => {
    if (running) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    if (running) return
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))
  }

  const toggleLog = (id: string): void => {
    setExpandedLogs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const cancelQueue = async (): Promise<void> => {
    if (!running) return
    cancelRef.current = true
    await window.api.killUpgrade()
  }

  /**
   * Fila sequencial — nunca paralela (o winget disputa locks de instalador/fonte).
   * O renderer chama o IPC um app por vez e aguarda o resultado antes do próximo.
   */
  const runQueue = async (): Promise<void> => {
    if (running) return
    const queue = items.filter((i) => selected.has(i.id))
    if (queue.length === 0) return

    cancelRef.current = false
    setRunning(true)
    setSummary(null)
    setItemStates(Object.fromEntries(queue.map((i) => [i.id, { status: 'aguardando' }])))
    setExpandedLogs(new Set())
    setProgress({ done: 0, total: queue.length })

    let done = 0
    let okCount = 0
    let errCount = 0
    let cancelledCount = 0

    for (const item of queue) {
      if (cancelRef.current) break // cancelamento antes de começar: demais ficam pendentes
      setItemStates((prev) => ({ ...prev, [item.id]: { status: 'atualizando' } }))
      const res = await window.api.upgradeOneUpdate(item.id)
      done += 1

      if (cancelRef.current) {
        // O item em curso foi interrompido pelo usuário: marca como cancelado.
        cancelledCount += 1
        setItemStates((prev) => ({
          ...prev,
          [item.id]: { status: 'cancelado', exitCode: res.exitCode, log: res.log }
        }))
        setProgress({ done, total: queue.length })
        break
      }

      if (res.ok)
        okCount += 1 // exit 0 → concluído
      else errCount += 1 // erro por item não aborta a fila — prossegue
      setItemStates((prev) => ({
        ...prev,
        [item.id]: { status: res.ok ? 'concluido' : 'erro', exitCode: res.exitCode, log: res.log }
      }))
      setProgress({ done, total: queue.length })
    }

    setRunning(false)

    if (cancelledCount > 0) {
      setSummary({
        text: `${okCount} concluída(s)${errCount > 0 ? `, ${errCount} com erro` : ''} — atualização cancelada`,
        tone: 'warn'
      })
    } else if (errCount > 0) {
      setSummary({
        text: `${okCount} concluída(s), ${errCount} com erro`,
        tone: okCount > 0 ? 'warn' : 'error'
      })
    } else {
      setSummary({ text: `${okCount} atualização(ões) concluída(s)`, tone: 'ok' })
    }

    // Fim (ou cancelamento) da fila: recarrega a lista — itens que falharam e
    // continuam desatualizados reaparecem. Badges de erro/cancelado são mantidos
    // para esses itens; os demais saem da lista ou voltam limpos.
    setLoading(true)
    const res = await fetchOnce()
    setResult(res)
    setLoading(false)
    setProgress(null)
    setExpandedLogs(new Set())
    setItemStates((prev) => {
      const next: Record<string, ItemState> = {}
      for (const item of res.ok ? (res.items ?? []) : []) {
        const s = prev[item.id]
        if (s && (s.status === 'erro' || s.status === 'cancelado')) next[item.id] = s
      }
      return next
    })
    setSelected(
      (prev) => new Set([...prev].filter((id) => (res.items ?? []).some((i) => i.id === id)))
    )
  }

  const handleOpenStore = (): void => {
    void window.api.openExternal(APP_INSTALLER_STORE_URL)
  }

  // ── Conteúdo principal (um entre loading/erro/vazio/lista) ────────
  let body: JSX.Element

  if (loading && !result) {
    body = (
      <Card className="p-12 text-center">
        <Loader2 size={32} className="mx-auto mb-4 animate-spin text-accent" aria-hidden="true" />
        <p className="text-sm font-semibold text-ink-primary">Verificando atualizações…</p>
        <p className="mt-1.5 text-[12px] text-ink-secondary">
          Isso pode levar alguns segundos na primeira vez.
        </p>
      </Card>
    )
  } else if (result && !result.ok && result.wingetMissing) {
    body = (
      <Card className="border-accent-border p-10 text-center">
        <Store size={32} className="mx-auto mb-4 text-accent" aria-hidden="true" />
        <p className="text-sm font-semibold text-ink-primary">winget não encontrado</p>
        <p className="mx-auto mt-2 max-w-md text-[12px] leading-relaxed text-ink-secondary">
          Para listar e instalar atualizações de programas, instale ou atualize o{' '}
          <span className="font-semibold text-ink-primary">App Installer</span> (ele traz o winget)
          pela Microsoft Store — depois clique em “Verificar novamente”.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button variant="primary" size="md" onClick={handleOpenStore}>
            <ExternalLink size={14} aria-hidden="true" /> Abrir a Microsoft Store
          </Button>
          <Button variant="secondary" size="md" onClick={check}>
            <RefreshCw size={14} aria-hidden="true" /> Verificar novamente
          </Button>
        </div>
      </Card>
    )
  } else if (result && !result.ok) {
    body = (
      <Card className="border-danger-border p-10 text-center" role="alert">
        <AlertTriangle size={32} className="mx-auto mb-4 text-danger" aria-hidden="true" />
        <p className="text-sm font-semibold text-ink-primary">
          Não foi possível verificar as atualizações
        </p>
        <p className="mx-auto mt-2 max-w-lg text-[12px] leading-relaxed text-ink-secondary">
          {result.error ?? 'Algo deu errado ao consultar o winget.'}
        </p>

        {result.rawLog && (
          <div className="mx-auto mt-5 max-w-2xl text-left">
            <button
              onClick={() => setShowRawLog((v) => !v)}
              className="mx-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary transition-colors duration-2 hover:text-ink-primary"
              aria-expanded={showRawLog}
            >
              {showRawLog ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
              Detalhes técnicos
            </button>
            {showRawLog && (
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-3 font-mono text-[10px] leading-relaxed text-ink-secondary">
                {result.rawLog}
              </pre>
            )}
          </div>
        )}

        <div className="mt-6">
          <Button variant="primary" size="md" onClick={check}>
            <RefreshCw size={14} aria-hidden="true" /> Verificar novamente
          </Button>
        </div>
      </Card>
    )
  } else if (result?.ok && items.length === 0) {
    body = (
      <Card className="border-success-border p-12 text-center">
        <CheckCircle2 size={32} className="mx-auto mb-4 text-success" aria-hidden="true" />
        <p className="text-sm font-semibold text-success">Nenhuma atualização disponível 🎉</p>
        <p className="mt-1.5 text-[12px] text-ink-secondary">
          Tudo certo por aqui — seus programas estão em dia.
        </p>
        <div className="mt-6">
          <Button variant="secondary" size="md" onClick={check} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            {loading ? 'Verificando…' : 'Verificar novamente'}
          </Button>
        </div>
      </Card>
    )
  } else {
    body = (
      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <ArrowUpCircle size={18} className="shrink-0 text-accent" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-ink-primary">
                  {items.length} atualização{items.length === 1 ? '' : 'ões'} disponível
                  {items.length === 1 ? '' : 'is'}
                </h3>
                <p className="mt-0.5 text-[10px] text-ink-tertiary">
                  Segundo o winget, direto do seu PC
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={check} disabled={running || loading}>
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
                {loading ? 'Verificando…' : 'Verificar novamente'}
              </Button>
              {!running ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={runQueue}
                  disabled={selectedCount === 0 || loading}
                >
                  <ArrowUpCircle size={14} aria-hidden="true" /> Atualizar selecionados (
                  {selectedCount})
                </Button>
              ) : (
                <Button variant="danger" size="sm" onClick={cancelQueue}>
                  <X size={14} aria-hidden="true" /> Cancelar
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
            <div className="flex items-center gap-2">
              <SelectBox
                state={allSelected ? 'on' : someSelected ? 'partial' : 'off'}
                disabled={running || loading}
                onToggle={toggleAll}
                title="Selecionar todos"
              />
              <button
                onClick={toggleAll}
                disabled={running || loading}
                className="text-[11px] font-semibold text-ink-secondary transition-colors duration-2 hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
                aria-pressed={allSelected}
              >
                Selecionar todos
              </button>
            </div>

            {running && progress ? (
              <div className="flex min-w-[180px] max-w-md flex-1 items-center gap-3">
                <div
                  className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-2"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.done}
                  aria-label="Progresso das atualizações"
                >
                  <div
                    className="h-full bg-accent transition-all duration-3"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
                <span className="tnum whitespace-nowrap text-[10px] font-semibold text-ink-secondary">
                  {progress.done}/{progress.total} concluídos
                </span>
              </div>
            ) : (
              <span className="text-[10px] text-ink-tertiary">
                Uma de cada vez, para não conflitar
              </span>
            )}
          </div>
        </Card>

        <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
          {items.map((item) => {
            const state = itemStates[item.id]
            const isChecked = selected.has(item.id)
            const isExpanded = expandedLogs.has(item.id)
            return (
              <motion.div
                key={item.id}
                {...entranceProps(reduced, { y: 10 })}
                className={`rounded-card border bg-surface-1 p-4 transition-colors duration-2 ${
                  isChecked
                    ? 'border-accent-border bg-accent-muted'
                    : state?.status === 'erro'
                      ? 'border-danger-border'
                      : 'border-[var(--border-subtle)]'
                }`}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <SelectBox
                      state={isChecked ? 'on' : 'off'}
                      disabled={running}
                      onToggle={() => toggleOne(item.id)}
                      title={running ? 'Aguarde a fila terminar' : 'Selecionar'}
                    />
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2">
                      <ArrowUpCircle size={20} className="text-accent" aria-hidden="true" />
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div
                        className="truncate text-sm font-semibold text-ink-primary"
                        title={item.name}
                      >
                        {item.name}
                      </div>
                      <code
                        className="mt-1.5 block truncate font-mono text-[10px] leading-tight text-ink-tertiary"
                        title={item.id}
                      >
                        {item.id}
                      </code>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5 pl-10 text-[11px] md:pl-0">
                    <span className="font-mono text-ink-secondary" title="Versão atual">
                      {item.currentVersion || 'desconhecida'}
                    </span>
                    <ArrowRight size={12} className="text-ink-tertiary" aria-hidden="true" />
                    <span className="font-mono font-semibold text-accent" title="Versão disponível">
                      {item.availableVersion || 'desconhecida'}
                    </span>
                    {state && (
                      <span className="ml-2">
                        <StatusBadge state={state} />
                      </span>
                    )}
                  </div>
                </div>

                {state &&
                  (state.status === 'erro' || state.status === 'cancelado') &&
                  state.log && (
                    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                      <button
                        onClick={() => toggleLog(item.id)}
                        className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary transition-colors duration-2 hover:text-ink-primary"
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronDown size={12} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={12} aria-hidden="true" />
                        )}
                        {state.status === 'erro' ? 'Detalhes do erro' : 'Detalhes'}
                      </button>
                      {isExpanded && (
                        <>
                          <p className="mt-2 text-[10px] text-ink-secondary">
                            Código de saída:{' '}
                            <code className="font-mono text-ink-primary">
                              {state.exitCode ?? 'desconhecido'}
                            </code>
                          </p>
                          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-3 font-mono text-[10px] leading-relaxed text-ink-secondary">
                            {state.log}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
              </motion.div>
            )
          })}
        </div>
      </div>
    )
  }

  const summaryStyles: Record<SummaryState['tone'], string> = {
    ok: 'border-success-border bg-success-bg text-success',
    warn: 'border-warn-border bg-warn-bg text-warn',
    error: 'border-danger-border bg-danger-bg text-danger'
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-card border px-4 py-3 ${summaryStyles[summary.tone]}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            {summary.tone === 'ok' ? (
              <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
            )}
            <p className="text-[12px] font-semibold">{summary.text}</p>
          </div>
          <button
            onClick={() => setSummary(null)}
            className="shrink-0 rounded-sm p-0.5 opacity-70 transition-opacity duration-2 hover:opacity-100"
            aria-label="Fechar aviso"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {body}
    </div>
  )
}
