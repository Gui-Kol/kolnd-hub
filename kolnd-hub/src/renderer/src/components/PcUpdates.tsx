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
  Minus,
  RefreshCw,
  Square,
  Store,
  X
} from 'lucide-react'
import { WingetListResult } from '../types'

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

/** Checkbox quadrado no estilo da página (usado por linha e no "Selecionar todos"). */
interface SelectBoxProps {
  state: 'off' | 'on' | 'partial'
  disabled?: boolean
  onToggle: () => void
  title?: string
}

function SelectBox({ state, disabled, onToggle, title }: SelectBoxProps): JSX.Element {
  const active = state !== 'off'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'partial' ? 'mixed' : state === 'on'}
      aria-label={title ?? 'Selecionar'}
      disabled={disabled}
      onClick={onToggle}
      title={title}
      className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all shrink-0 border disabled:opacity-40 disabled:cursor-not-allowed ${
        active
          ? 'bg-kloud-500 text-white border-kloud-500 shadow-glow-red'
          : 'bg-white/[0.03] border-white/10 text-slate-400 hover:border-white/30 hover:text-white'
      }`}
    >
      {state === 'on' && <CheckCircle2 size={16} fill="white" />}
      {state === 'partial' && <Minus size={16} />}
      {state === 'off' && <Square size={16} />}
    </button>
  )
}

/** Badge de status por item: aguardando → atualizando → concluído ✓ / erro ✗. */
function StatusBadge({ state }: { state: ItemState }): JSX.Element {
  switch (state.status) {
    case 'aguardando':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-700/20 border border-slate-600/40 text-slate-400">
          aguardando…
        </span>
      )
    case 'atualizando':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-kloud-500/10 border border-kloud-500/30 text-kloud-500">
          <Loader2 size={12} className="animate-spin" />
          atualizando…
        </span>
      )
    case 'concluido':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <CheckCircle2 size={12} />
          concluído
        </span>
      )
    case 'cancelado':
      return (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 border border-amber-500/30 text-amber-400"
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
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-red-500/10 border border-red-500/30 text-red-400"
          title={`Código de saída: ${state.exitCode ?? 'desconhecido'}`}
        >
          <AlertTriangle size={12} />
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
      <div className="glass rounded-2xl p-12 text-center">
        <Loader2 size={32} className="mx-auto mb-4 animate-spin text-kloud-500" />
        <p className="text-sm font-bold text-white">Verificando atualizações…</p>
        <p className="text-[12px] text-slate-400 mt-1.5">
          Isso pode levar alguns segundos na primeira vez.
        </p>
      </div>
    )
  } else if (result && !result.ok && result.wingetMissing) {
    body = (
      <div className="glass rounded-2xl p-10 text-center border-kloud-500/20">
        <Store size={32} className="mx-auto mb-4 text-kloud-500" />
        <p className="text-sm font-bold text-white">winget não encontrado</p>
        <p className="text-[12px] text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
          Para listar e instalar atualizações de programas, instale ou atualize o{' '}
          <span className="text-white font-bold">App Installer</span> (ele traz o winget) pela
          Microsoft Store — depois clique em “Verificar novamente”.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-6">
          <button onClick={handleOpenStore} className="btn-primary">
            <ExternalLink size={14} /> Abrir a Microsoft Store
          </button>
          <button onClick={check} className="btn-secondary">
            <RefreshCw size={14} /> Verificar novamente
          </button>
        </div>
      </div>
    )
  } else if (result && !result.ok) {
    body = (
      <div className="glass rounded-2xl p-10 text-center border-red-500/20">
        <AlertTriangle size={32} className="mx-auto mb-4 text-red-400" />
        <p className="text-sm font-bold text-white">Não foi possível verificar as atualizações</p>
        <p className="text-[12px] text-slate-400 mt-2 max-w-lg mx-auto leading-relaxed">
          {result.error ?? 'Algo deu errado ao consultar o winget.'}
        </p>

        {result.rawLog && (
          <div className="mt-5 text-left max-w-2xl mx-auto">
            <button
              onClick={() => setShowRawLog((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors mx-auto"
              aria-expanded={showRawLog}
            >
              {showRawLog ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Detalhes técnicos
            </button>
            {showRawLog && (
              <pre className="input-gamer mt-3 max-h-48 overflow-auto text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                {result.rawLog}
              </pre>
            )}
          </div>
        )}

        <div className="mt-6">
          <button onClick={check} className="btn-primary">
            <RefreshCw size={14} /> Verificar novamente
          </button>
        </div>
      </div>
    )
  } else if (result?.ok && items.length === 0) {
    body = (
      <div className="glass rounded-2xl p-12 text-center border-emerald-500/20">
        <CheckCircle2 size={32} className="mx-auto mb-4 text-emerald-400" />
        <p className="text-sm font-bold text-emerald-400">Nenhuma atualização disponível 🎉</p>
        <p className="text-[12px] text-slate-400 mt-1.5">
          Tudo certo por aqui — seus programas estão em dia.
        </p>
        <div className="mt-6">
          <button
            onClick={check}
            disabled={loading}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Verificando…' : 'Verificar novamente'}
          </button>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="space-y-4">
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ArrowUpCircle size={18} className="text-kloud-500 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">
                  {items.length} atualização{items.length === 1 ? '' : 'ões'} disponível
                  {items.length === 1 ? '' : 'is'}
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Segundo o winget, direto do seu PC
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={check}
                disabled={running || loading}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Verificando…' : 'Verificar novamente'}
              </button>
              {!running ? (
                <button
                  onClick={runQueue}
                  disabled={selectedCount === 0 || loading}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowUpCircle size={14} /> Atualizar selecionados ({selectedCount})
                </button>
              ) : (
                <button onClick={cancelQueue} className="btn-danger">
                  <X size={14} /> Cancelar
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
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
                className="text-[11px] font-bold text-slate-400 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-pressed={allSelected}
              >
                Selecionar todos
              </button>
            </div>

            {running && progress ? (
              <div className="flex items-center gap-3 flex-1 min-w-[180px] max-w-md">
                <div className="h-2 rounded-full bg-white/[0.06] flex-1 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-kloud-500 to-nintendo-500 transition-all duration-300"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-slate-400 whitespace-nowrap">
                  {progress.done}/{progress.total} concluídos
                </span>
              </div>
            ) : (
              <span className="text-[10px] text-slate-400">
                Uma de cada vez, para não conflitar
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
          {items.map((item) => {
            const state = itemStates[item.id]
            const isChecked = selected.has(item.id)
            const isExpanded = expandedLogs.has(item.id)
            return (
              <motion.div
                key={item.id}
                {...entranceProps(reduced, { y: 10 })}
                className={`glass rounded-xl p-4 transition-colors ${
                  isChecked ? 'border-kloud-500/30 bg-kloud-500/5' : ''
                } ${state?.status === 'erro' ? 'border-red-500/20' : ''}`}
              >
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <SelectBox
                      state={isChecked ? 'on' : 'off'}
                      disabled={running}
                      onToggle={() => toggleOne(item.id)}
                      title={running ? 'Aguarde a fila terminar' : 'Selecionar'}
                    />
                    <div className="w-11 h-11 rounded-xl bg-white/[0.03] flex items-center justify-center shrink-0">
                      <ArrowUpCircle size={20} className="text-kloud-500" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="text-sm font-bold text-white truncate" title={item.name}>
                        {item.name}
                      </div>
                      <code
                        className="text-[10px] text-slate-400 truncate mt-1.5 block leading-tight"
                        title={item.id}
                      >
                        {item.id}
                      </code>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0 pl-10 md:pl-0 text-[11px]">
                    <span className="text-slate-400 font-mono" title="Versão atual">
                      {item.currentVersion || 'desconhecida'}
                    </span>
                    <ArrowRight size={12} className="text-slate-400" />
                    <span className="text-neon-cyan font-bold font-mono" title="Versão disponível">
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
                    <div className="mt-3 border-t border-white/[0.06] pt-3">
                      <button
                        onClick={() => toggleLog(item.id)}
                        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {state.status === 'erro' ? 'Detalhes do erro' : 'Detalhes'}
                      </button>
                      {isExpanded && (
                        <>
                          <p className="text-[10px] text-slate-400 mt-2">
                            Código de saída:{' '}
                            <code className="text-slate-300 font-mono">
                              {state.exitCode ?? 'desconhecido'}
                            </code>
                          </p>
                          <pre className="input-gamer mt-2 max-h-40 overflow-auto text-[10px] leading-relaxed whitespace-pre-wrap break-all">
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
    ok: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300',
    warn: 'border-amber-500/25 bg-amber-500/5 text-amber-300',
    error: 'border-red-500/25 bg-red-500/5 text-red-300'
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div
          role="status"
          className={`rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border ${summaryStyles[summary.tone]}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {summary.tone === 'ok' ? (
              <CheckCircle2 size={16} className="shrink-0" />
            ) : (
              <AlertTriangle size={16} className="shrink-0" />
            )}
            <p className="text-[12px] font-bold">{summary.text}</p>
          </div>
          <button
            onClick={() => setSummary(null)}
            className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Fechar aviso"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {body}
    </div>
  )
}
