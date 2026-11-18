import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import {
  Activity,
  AlertTriangle,
  Cpu,
  Gauge,
  History,
  Loader2,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import { BenchmarkHistoryEntry, BenchmarkProgress, BenchmarkResult, StressProgress } from '../types'
import { Badge, Button, Card, Modal } from './ui'

/** Nota em pontos, com 2 casas (mesma resolução da escala exibida). */
function formatPoints(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** MOps/s de uma carga, com 1 casa. */
function formatMops(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** Razão multi/single (ex.: 8,1×). */
function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** Cronômetro mm:ss do teste de estresse. */
function formatClock(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

/** Data/hora pt-BR do histórico; ISO inválido nunca quebra a lista. */
function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Variação percentual em relação à execução anterior (null quando não há base). */
function deltaPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

function deltaClass(value: number): string {
  return value >= 0 ? 'text-success' : 'text-danger'
}

function formatDelta(value: number): string {
  return `${value >= 0 ? '↑' : '↓'} ${Math.abs(value).toLocaleString('pt-BR', {
    maximumFractionDigits: 1
  })}%`
}

export function PcBenchmark(): JSX.Element {
  // Entradas decorativas (cards, resultado) viram fade curto com reduce.
  const reduced = useReducedMotion()
  const [info, setInfo] = useState<{ cores: number; model: string } | null>(null)
  const [history, setHistory] = useState<BenchmarkHistoryEntry[]>([])
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [progress, setProgress] = useState<BenchmarkProgress | null>(null)
  const [previous, setPrevious] = useState<BenchmarkHistoryEntry | null>(null)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const [stressRunning, setStressRunning] = useState(false)
  const [stressElapsedMs, setStressElapsedMs] = useState(0)
  const [stressThreads, setStressThreads] = useState(0)
  const [stressChecksumOk, setStressChecksumOk] = useState(true)
  const [stressSummary, setStressSummary] = useState<{
    elapsedMs: number
    checksumOk: boolean
  } | null>(null)

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const unsubscribeProgress = window.api.onBenchmarkProgress((update) => {
      if (mountedRef.current) setProgress(update)
    })
    const unsubscribeStress = window.api.onBenchmarkStressProgress((update: StressProgress) => {
      if (!mountedRef.current) return
      setStressElapsedMs(update.elapsedMs)
      setStressThreads(update.threads)
      setStressChecksumOk(update.checksumOk)
    })

    void window.api
      .benchmarkInfo()
      .then((value) => {
        if (mountedRef.current) setInfo(value)
      })
      .catch(() => undefined)
    void window.api
      .benchmarkHistory()
      .then((entries) => {
        if (mountedRef.current) setHistory(entries)
      })
      .catch(() => undefined)

    return () => {
      mountedRef.current = false
      unsubscribeProgress()
      unsubscribeStress()
      // Parada garantida ao sair da aba: worker de estresse órfão é bug.
      void window.api.cancelBenchmark().catch(() => undefined)
      void window.api.stopBenchmarkStress().catch(() => undefined)
    }
  }, [])

  // Sinal de vida para o watchdog do main: se a interface parar de responder
  // por muito tempo, o estresse é encerrado sozinho em vez de deixar a máquina
  // carregada (bug "o Hub parou de funcionar durante o teste").
  useEffect(() => {
    if (!stressRunning) return undefined
    void window.api.ackBenchmarkStress().catch(() => undefined)
    const timer = setInterval(() => {
      void window.api.ackBenchmarkStress().catch(() => undefined)
    }, 2000)
    return () => clearInterval(timer)
  }, [stressRunning])

  const runBenchmark = async (): Promise<void> => {
    if (running || stressRunning) return
    setRunning(true)
    setError(null)
    setNotice(null)
    setResult(null)
    setPrevious(null)
    setProgress(null)
    try {
      const response = await window.api.runBenchmark()
      if (!mountedRef.current) return
      if (!response.ok) {
        // Cancelamento é uma ação do usuário, não uma falha técnica.
        if (response.cancelled) setNotice('Execução cancelada.')
        else setError(response.error)
        return
      }
      setResult(response)
      const entries = await window.api.benchmarkHistory()
      if (!mountedRef.current) return
      setHistory(entries)
      // A primeira execução que não é a recém-concluída é a "anterior".
      const prior =
        entries.find(
          (entry) =>
            Math.abs(entry.single - response.single) > 0.005 ||
            Math.abs(entry.multi - response.multi) > 0.005
        ) ?? null
      setPrevious(prior)
    } catch {
      if (mountedRef.current) {
        setError('Não foi possível concluir o benchmark. Tente novamente em alguns instantes.')
      }
    } finally {
      if (mountedRef.current) {
        setRunning(false)
        setProgress(null)
      }
    }
  }

  const cancelBenchmark = async (): Promise<void> => {
    try {
      const response = await window.api.cancelBenchmark()
      if (mountedRef.current && response.cancelled) setNotice('Cancelamento solicitado…')
    } catch {
      if (mountedRef.current) setNotice('Cancelamento solicitado…')
    }
  }

  const startStress = async (): Promise<void> => {
    if (running || stressRunning) return
    setError(null)
    setNotice(null)
    setStressSummary(null)
    setStressElapsedMs(0)
    setStressChecksumOk(true)
    try {
      const response = await window.api.startBenchmarkStress()
      if (!mountedRef.current) return
      if (!response.ok) {
        setError(response.error ?? 'Não foi possível iniciar o teste de estresse.')
        return
      }
      setStressThreads(response.threads ?? 0)
      setStressRunning(true)
    } catch {
      if (mountedRef.current) {
        setError('Não foi possível iniciar o teste de estresse. Tente novamente.')
      }
    }
  }

  const stopStress = async (): Promise<void> => {
    if (!stressRunning) return
    try {
      const response = await window.api.stopBenchmarkStress()
      if (!mountedRef.current) return
      setStressRunning(false)
      setStressThreads(0)
      if (response.ok) {
        setStressElapsedMs(response.elapsedMs ?? stressElapsedMs)
        setStressSummary({
          elapsedMs: response.elapsedMs ?? 0,
          checksumOk: response.checksumOk !== false
        })
      } else {
        setError(response.error ?? 'Não foi possível parar o teste de estresse.')
      }
    } catch {
      if (mountedRef.current) {
        setError('Não foi possível parar o teste de estresse.')
        setStressRunning(false)
        setStressThreads(0)
      }
    }
  }

  const clearHistory = async (): Promise<void> => {
    setShowClearConfirm(false)
    try {
      const response = await window.api.clearBenchmarkHistory()
      if (!mountedRef.current) return
      if (!response.success) {
        setError('Não foi possível limpar o histórico. Tente novamente.')
        return
      }
      setHistory([])
      setPrevious(null)
    } catch {
      if (mountedRef.current) setError('Não foi possível limpar o histórico. Tente novamente.')
    }
  }

  const bestSingle = history.reduce((best, entry) => Math.max(best, entry.single), 0)
  const bestMulti = history.reduce((best, entry) => Math.max(best, entry.multi), 0)
  const singleDelta = result?.ok && previous ? deltaPercent(result.single, previous.single) : null
  const multiDelta = result?.ok && previous ? deltaPercent(result.multi, previous.multi) : null

  return (
    <div className="space-y-4">
      {/* ── Cartão principal ─────────────────────────────── */}
      <Card className="space-y-5 p-6 text-center md:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card border border-accent-border bg-accent-muted">
          <Gauge size={32} className="text-accent" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold tracking-tight text-ink-primary">
            Benchmark de CPU
          </h3>
          <p className="mx-auto max-w-lg text-[12px] leading-relaxed text-ink-secondary">
            Mede inteiros, ponto flutuante, memória, AES e SHA-256 em single e multi-thread. Tudo
            roda na sua máquina, em processos separados — nada sai daqui. Leva de 15 a 30 segundos,
            dependendo do número de núcleos.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-ink-secondary">
          <Cpu size={12} className="shrink-0" aria-hidden="true" />
          <code className="max-w-full truncate rounded-sm border border-[var(--border-subtle)] bg-surface-2 px-2 py-1 font-mono">
            {info?.model ?? 'Detectando CPU…'}
          </code>
          <code className="rounded-sm border border-[var(--border-subtle)] bg-surface-2 px-2 py-1 font-mono">
            {info ? `${info.cores} núcleos` : '—'}
          </code>
        </div>

        <div className="space-y-3">
          {running ? (
            <>
              <Button variant="secondary" size="md" onClick={() => void cancelBenchmark()}>
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Cancelar
              </Button>
              <div role="status" aria-live="polite" className="mx-auto max-w-md space-y-2">
                <p className="text-[11px] text-ink-secondary">
                  {progress
                    ? `Fase ${progress.phase === 'single' ? 1 : 2} de 2 · ${progress.testLabel} · ${progress.percent}%`
                    : 'Preparando o benchmark…'}
                </p>
                <div
                  aria-hidden="true"
                  className="h-2 w-full overflow-hidden rounded-pill bg-surface-2"
                >
                  <div
                    className="h-full rounded-pill bg-accent transition-all duration-3 ease-standard"
                    style={{ width: `${progress?.percent ?? 0}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={() => void runBenchmark()}
              disabled={stressRunning}
            >
              <Gauge size={14} aria-hidden="true" />
              Executar benchmark
            </Button>
          )}
          {notice && <p className="text-[11px] text-ink-tertiary">{notice}</p>}
        </div>
      </Card>

      {/* ── Erro amigável ────────────────────────────────── */}
      {error && (
        <motion.div
          {...entranceProps(reduced, { y: 10 })}
          role="alert"
          className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-bg p-5"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-danger">Algo não saiu como esperado</p>
            <p className="text-[11px] leading-relaxed text-ink-secondary">{error}</p>
          </div>
        </motion.div>
      )}

      {/* ── Resultado ────────────────────────────────────── */}
      {result?.ok && (
        <motion.div {...entranceProps(reduced, { y: 10 })} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-ink-primary">Resultado</h3>
            <div className="flex flex-wrap items-center gap-3">
              {(singleDelta !== null || multiDelta !== null) && (
                <p className="text-[11px] text-ink-tertiary">
                  {singleDelta !== null && (
                    <span className={deltaClass(singleDelta)}>
                      Single {formatDelta(singleDelta)}
                    </span>
                  )}
                  {singleDelta !== null && multiDelta !== null && (
                    <span className="text-ink-tertiary"> · </span>
                  )}
                  {multiDelta !== null && (
                    <span className={deltaClass(multiDelta)}>Multi {formatDelta(multiDelta)}</span>
                  )}
                  <span> vs. execução anterior</span>
                </p>
              )}
              {result.unstable && (
                <Badge
                  tone="warning"
                  title="A variação entre repetições passou de 25% e continuou alta após uma nova medição. O número exibido é o medido."
                >
                  Instável
                </Badge>
              )}
              <Badge tone="accent">Multi/Single {formatRatio(result.ratio)}×</Badge>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="space-y-3 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Single Thread
              </p>
              <p className="flex items-baseline gap-1.5">
                <span className="text-[30px] font-bold leading-none tracking-tight text-ink-primary">
                  {formatPoints(result.single)}
                </span>
                <span className="text-[11px] text-ink-tertiary">pts</span>
              </p>
              {bestSingle > 0 && (
                <div className="space-y-1.5">
                  <div
                    aria-hidden="true"
                    className="h-2 w-full overflow-hidden rounded-pill bg-surface-2"
                  >
                    <div
                      className="h-full rounded-pill bg-accent"
                      style={{
                        width: `${Math.min(100, Math.max(0, (result.single / bestSingle) * 100))}%`
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-ink-tertiary">
                    melhor resultado nesta máquina: {formatPoints(bestSingle)} pts
                  </p>
                </div>
              )}
            </Card>

            <Card className="space-y-3 p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Multi Thread
              </p>
              <p className="flex items-baseline gap-1.5">
                <span className="text-[30px] font-bold leading-none tracking-tight text-ink-primary">
                  {formatPoints(result.multi)}
                </span>
                <span className="text-[11px] text-ink-tertiary">pts</span>
              </p>
              {bestMulti > 0 && (
                <div className="space-y-1.5">
                  <div
                    aria-hidden="true"
                    className="h-2 w-full overflow-hidden rounded-pill bg-surface-2"
                  >
                    <div
                      className="h-full rounded-pill bg-success"
                      style={{
                        width: `${Math.min(100, Math.max(0, (result.multi / bestMulti) * 100))}%`
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-ink-tertiary">
                    melhor resultado nesta máquina: {formatPoints(bestMulti)} pts
                  </p>
                </div>
              )}
              <p className="text-[10px] text-ink-tertiary">
                em {result.threads} process{result.threads === 1 ? 'o' : 'os'} em paralelo
              </p>
            </Card>
          </div>

          <Card className="space-y-3 p-5">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] uppercase tracking-wider text-ink-tertiary">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">
                      Carga
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                      Single (MOps/s)
                    </th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                      Multi (MOps/s)
                    </th>
                    <th scope="col" className="py-1.5 text-right font-semibold">
                      Ganho
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.tests.map((test) => (
                    <tr key={test.id} className="border-t border-[var(--border-subtle)]">
                      <td className="py-1.5 pr-3 text-ink-secondary">{test.label}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-ink-primary">
                        {formatMops(test.single)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono text-ink-primary">
                        {formatMops(test.multi)}
                      </td>
                      <td className="py-1.5 text-right font-mono text-ink-secondary">
                        {test.single > 0 ? `${formatRatio(test.multi / test.single)}×` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] leading-relaxed text-ink-tertiary">
              MOps/s são a mediana de 3 repetições de trabalho fixo. A nota usa a escala Kolnd
              calibrada em um Ryzen 7 5700X (single ≈ 582 · multi ≈ 4.700) — próxima da escala do
              CPU-Z, mas não é o score oficial dele.
            </p>
          </Card>
        </motion.div>
      )}

      {/* ── Teste de estresse ────────────────────────────── */}
      <Card className="space-y-5 p-5 md:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-warn-border bg-warn-bg">
            <Activity size={20} className="text-warn" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-tight text-ink-primary">
              Teste de estresse
            </h3>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              Carga contínua em todos os núcleos, sem pontuação. O cronômetro e a verificação de
              integridade mostram se a computação continua consistente. A carga usa ~80% de cada
              núcleo para o Hub continuar respondendo; se a interface parar de responder, o teste é
              encerrado sozinho.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-control border border-warn-border bg-warn-bg p-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-ink-secondary">
            Aviso de segurança: o Hub não lê temperatura nem sensores. Monitore a temperatura do seu
            jeito e pare se o PC travar ou esquentar demais.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 text-center">
          <span className="font-mono text-[32px] font-bold leading-none tabular-nums tracking-tight text-ink-primary">
            {formatClock(stressElapsedMs)}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-ink-tertiary">
            <span>
              {stressRunning
                ? `${stressThreads} thread${stressThreads === 1 ? '' : 's'} ativa${stressThreads === 1 ? '' : 's'}`
                : 'threads ativas: —'}
            </span>
            <Badge tone={stressRunning ? (stressChecksumOk ? 'success' : 'danger') : 'neutral'}>
              <ShieldCheck size={11} aria-hidden="true" />
              {stressRunning
                ? stressChecksumOk
                  ? 'Integridade OK'
                  : 'Falha de integridade'
                : 'Integridade —'}
            </Badge>
          </div>

          {stressRunning ? (
            <Button variant="secondary" size="md" onClick={() => void stopStress()}>
              Parar teste
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={() => void startStress()}
              disabled={running}
            >
              <Activity size={14} aria-hidden="true" />
              Iniciar teste de estresse
            </Button>
          )}

          {stressSummary && !stressRunning && (
            <p className="text-[11px] text-ink-tertiary">
              Último teste: {formatClock(stressSummary.elapsedMs)} ·{' '}
              {stressSummary.checksumOk ? 'integridade OK' : 'falha de integridade detectada'}
            </p>
          )}
        </div>
      </Card>

      {/* ── Histórico ────────────────────────────────────── */}
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
            <History size={16} className="text-ink-tertiary" aria-hidden="true" />
            Histórico
          </h3>
          {history.length > 0 && (
            <Button variant="subtle-danger" size="sm" onClick={() => setShowClearConfirm(true)}>
              <Trash2 size={14} aria-hidden="true" />
              Limpar histórico
            </Button>
          )}
        </div>

        {history.length === 0 ? (
          <p className="text-[11px] text-ink-tertiary">
            Nenhuma execução registrada ainda. O resultado de cada benchmark fica salvo aqui, só
            nesta máquina.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col justify-between gap-2 rounded-control border border-[var(--border-subtle)] bg-surface-2 p-3 text-[11px] text-ink-secondary md:flex-row md:items-center"
              >
                <span className="text-ink-primary">{formatDate(entry.at)}</span>
                <div className="flex flex-wrap items-center gap-3">
                  <span>
                    Single{' '}
                    <span className="font-mono text-ink-primary">{formatPoints(entry.single)}</span>
                  </span>
                  <span>
                    Multi{' '}
                    <span className="font-mono text-ink-primary">{formatPoints(entry.multi)}</span>
                  </span>
                  <span className="text-[10px] text-ink-tertiary">
                    {entry.cores} núcleo{entry.cores === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Modal de confirmação ─────────────────────────── */}
      {showClearConfirm && (
        <Modal
          title="Limpar histórico do benchmark?"
          onClose={() => setShowClearConfirm(false)}
          closeLabel="Fechar"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowClearConfirm(false)}>
                Cancelar
              </Button>
              <Button variant="danger" size="md" onClick={() => void clearHistory()}>
                <Trash2 size={14} aria-hidden="true" />
                Limpar histórico
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-control border border-warn-border bg-warn-bg">
              <ShieldCheck size={20} className="text-warn" aria-hidden="true" />
            </div>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              As execuções salvas serão apagadas e a comparação com o{' '}
              <span className="text-ink-primary">melhor resultado nesta máquina</span> volta a ficar
              vazia. Os resultados futuros continuam sendo salvos normalmente.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
