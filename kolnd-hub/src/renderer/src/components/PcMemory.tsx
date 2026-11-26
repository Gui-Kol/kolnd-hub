import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Loader2, MemoryStick, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { RamAutoPrefs, RamOptimizeResult, RamSnapshot } from '../types'
import { Badge, Button, Card, Input, Modal, Switch } from './ui'

const POLL_INTERVAL_MS = 3000
const DASH = '—'

/** Formata bytes em KB/MB/GB para o usuário final. */
function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const gb = 1024 ** 3
  const mb = 1024 ** 2
  const kb = 1024
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / kb))} KB`
}

/** Valor de byte com "—" quando o Windows não expôs o contador. */
function bytesOrDash(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? DASH : formatBytes(bytes)
}

function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return DASH
  return `${Math.min(100, Math.max(0, percent)).toFixed(percent >= 10 ? 0 : 1)}%`
}

function failureSnapshot(): RamSnapshot {
  return {
    ok: false,
    totalBytes: 0,
    usedBytes: 0,
    usedPercent: 0,
    freeBytes: 0,
    availableBytes: null,
    cacheBytes: null,
    standbyBytes: null,
    committedBytes: null,
    topProcesses: [],
    source: 'os',
    error: 'Não foi possível ler a memória do PC agora. Tente novamente em alguns instantes.'
  }
}

function UsageBar({ percent }: { percent: number | null }): JSX.Element {
  const safe =
    percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent))
  return (
    <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-pill bg-surface-2">
      <div className="h-full rounded-pill bg-accent" style={{ width: `${safe}%` }} />
    </div>
  )
}

function Metric({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): JSX.Element {
  return (
    <div className="space-y-1 rounded-control border border-[var(--border-subtle)] bg-surface-2 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
        {label}
      </p>
      <p className="font-mono text-[13px] font-semibold text-ink-primary">{value}</p>
      {hint ? <p className="text-[10px] text-ink-tertiary">{hint}</p> : null}
    </div>
  )
}

export function PcMemory(): JSX.Element {
  const reduced = useReducedMotion()
  const mountedRef = useRef(true)
  // Impede que o polling de 3 s e o botão "Atualizar" sobreponham chamadas.
  const pollingRef = useRef(false)
  const [snapshot, setSnapshot] = useState<RamSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'trim' | 'purge' | null>(null)
  const [modal, setModal] = useState<'trim' | 'purge' | null>(null)
  const [result, setResult] = useState<RamOptimizeResult | null>(null)
  // Otimização automática (somente trim, sem UAC): preferência do store e
  // rascunho do intervalo enquanto o usuário digita.
  const [autoPrefs, setAutoPrefs] = useState<RamAutoPrefs | null>(null)
  const [autoInterval, setAutoInterval] = useState('10')
  const [autoFeedback, setAutoFeedback] = useState<'saved' | 'error' | null>(null)
  const autoFeedbackTimer = useRef<number | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (pollingRef.current) return
    pollingRef.current = true
    try {
      const next = await window.api.ramInfo()
      if (mountedRef.current) setSnapshot(next)
    } catch {
      if (mountedRef.current) setSnapshot((previous) => previous ?? failureSnapshot())
    } finally {
      pollingRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  // Polling somente enquanto a aba está montada; a troca de aba desmonta e
  // limpa o interval.
  useEffect(() => {
    mountedRef.current = true
    // Primeira leitura fora do corpo do efeito: o setState acontece no
    // callback assíncrono, sem render em cascata.
    const initial = window.setTimeout(() => {
      void refresh()
    }, 0)
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  // Carrega a preferência da otimização automática ao montar. Falha de leitura
  // cai no padrão desligado (nunca liga nada por acidente).
  useEffect(() => {
    let mounted = true
    window.api
      .getRamAutoPrefs()
      .then((next) => {
        if (!mounted) return
        setAutoPrefs(next)
        setAutoInterval(String(next.intervalMinutes))
      })
      .catch(() => {
        if (!mounted) return
        setAutoPrefs({ enabled: false, intervalMinutes: 10 })
        setAutoInterval('10')
      })
    return (): void => {
      mounted = false
    }
  }, [])

  useEffect(
    () => () => {
      if (autoFeedbackTimer.current) window.clearTimeout(autoFeedbackTimer.current)
    },
    []
  )

  /** Salva a preferência de forma otimista, revertendo em caso de erro. */
  const saveAutoPrefs = async (next: RamAutoPrefs): Promise<void> => {
    const previous = autoPrefs
    setAutoPrefs(next)
    setAutoInterval(String(next.intervalMinutes))
    setAutoFeedback(null)
    try {
      const response = await window.api.setRamAutoPrefs(next)
      if (!response.success) throw new Error(response.error ?? 'erro desconhecido')
      if (mountedRef.current) setAutoFeedback('saved')
    } catch {
      if (mountedRef.current) {
        if (previous) {
          setAutoPrefs(previous)
          setAutoInterval(String(previous.intervalMinutes))
        }
        setAutoFeedback('error')
      }
    } finally {
      if (autoFeedbackTimer.current) window.clearTimeout(autoFeedbackTimer.current)
      autoFeedbackTimer.current = window.setTimeout(() => setAutoFeedback(null), 2500)
    }
  }

  const handleToggleAuto = (enabled: boolean): void => {
    if (!autoPrefs) return
    void saveAutoPrefs({ ...autoPrefs, enabled })
  }

  /** Clamp de 1–60 ao sair do campo/Enter; grava só se o valor mudou. */
  const commitAutoInterval = (): void => {
    if (!autoPrefs) return
    const trimmed = autoInterval.trim()
    const parsed = Number(trimmed)
    const next =
      trimmed === '' || !Number.isFinite(parsed)
        ? autoPrefs.intervalMinutes
        : Math.min(60, Math.max(1, Math.round(parsed)))
    setAutoInterval(String(next))
    if (next !== autoPrefs.intervalMinutes) {
      void saveAutoPrefs({ ...autoPrefs, intervalMinutes: next })
    }
  }

  const runAction = async (mode: 'trim' | 'purge'): Promise<void> => {
    if (action) return
    setModal(null)
    setResult(null)
    setAction(mode)
    try {
      const response =
        mode === 'trim' ? await window.api.optimizeRam() : await window.api.purgeStandbyMemory()
      if (mountedRef.current) {
        setResult(response)
        await refresh()
      }
    } catch {
      if (mountedRef.current) {
        setResult({
          ok: false,
          mode,
          freedBytes: 0,
          skipped: 0,
          errors: 1,
          error:
            mode === 'trim'
              ? 'Não foi possível liberar a memória dos programas agora. Nenhum programa foi fechado; tente novamente em alguns instantes.'
              : 'Não foi possível concluir a otimização avançada agora. Nada foi alterado de forma permanente; tente novamente em alguns instantes.'
        })
      }
    } finally {
      if (mountedRef.current) setAction(null)
    }
  }

  const closeModal = (): void => {
    if (action) return
    setModal(null)
  }

  const totalBytes = snapshot?.totalBytes ?? 0
  const usedBytes = snapshot?.usedBytes ?? 0
  const usedPercent = snapshot && snapshot.ok ? snapshot.usedPercent : null
  const topProcesses = snapshot?.topProcesses ?? []
  const reading = loading && snapshot === null

  return (
    <div className="space-y-4">
      <div data-testid="pc-memory" className="space-y-4">
        {/* ── Leitura principal ──────────────────────────── */}
        <Card className="space-y-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-accent-border bg-accent-muted">
                <MemoryStick size={22} className="text-accent" aria-hidden="true" />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-lg font-semibold tracking-tight text-ink-primary">
                  Memória RAM
                </h3>
                <p className="text-[12px] text-ink-secondary">
                  {reading
                    ? 'Lendo a memória do PC…'
                    : snapshot && snapshot.ok
                      ? `${formatBytes(totalBytes)} instalados`
                      : 'Leitura indisponível agora'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                tone={snapshot?.source === 'cim' ? 'accent' : 'warning'}
                data-testid="pc-memory-source"
              >
                {snapshot ? (snapshot.source === 'cim' ? 'Windows' : 'básico') : DASH}
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refresh()}
                disabled={loading && snapshot === null}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
                Atualizar
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Em uso
              </span>
              <span className="font-mono text-[22px] font-semibold leading-none text-ink-primary">
                {usedPercent === null ? DASH : formatPercent(usedPercent)}
                <span className="ml-2 text-[12px] font-normal text-ink-secondary">
                  {snapshot ? `${formatBytes(usedBytes)} em uso` : 'sem leitura'}
                </span>
              </span>
            </div>
            <UsageBar percent={usedPercent} />
            <p className="text-[11px] text-ink-tertiary">
              {snapshot && snapshot.ok
                ? `${formatBytes(snapshot.freeBytes)} fisicamente livres de ${formatBytes(totalBytes)}.`
                : 'A leitura detalhada do Windows não respondeu; os valores básicos do sistema são usados quando disponíveis.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Total" value={snapshot ? formatBytes(snapshot.totalBytes) : DASH} />
            <Metric
              label="Disponível"
              value={bytesOrDash(snapshot?.availableBytes ?? snapshot?.freeBytes)}
              hint={
                snapshot?.availableBytes !== null && snapshot?.availableBytes !== undefined
                  ? 'Inclui memória reutilizável'
                  : undefined
              }
            />
            <Metric label="Em uso" value={snapshot ? formatBytes(usedBytes) : DASH} />
            <Metric
              label="Cache (standby)"
              value={bytesOrDash(snapshot?.cacheBytes ?? snapshot?.standbyBytes)}
              hint={
                snapshot?.standbyBytes !== null && snapshot?.standbyBytes !== undefined
                  ? `Standby: ${formatBytes(snapshot.standbyBytes)}`
                  : undefined
              }
            />
            <Metric label="Commit" value={bytesOrDash(snapshot?.committedBytes)} />
            <Metric
              label="Fonte"
              value={snapshot ? (snapshot.source === 'cim' ? 'Windows' : 'básico') : DASH}
              hint={
                snapshot?.source === 'cim'
                  ? 'Contadores detalhados do Windows'
                  : 'Resumo do próprio sistema'
              }
            />
          </div>
        </Card>

        {/* ── Programas que mais usam memória ────────────── */}
        <Card className="space-y-3 p-6">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-ink-primary">
              Programas que mais usam memória
            </h3>
            <span className="text-[10px] text-ink-tertiary">Top {topProcesses.length || 10}</span>
          </div>
          {topProcesses.length === 0 ? (
            <p className="py-3 text-[12px] text-ink-secondary">
              {reading
                ? 'Lendo os programas em execução…'
                : 'Nenhum programa foi listado nesta leitura. O resumo básico não mostra processos individuais.'}
            </p>
          ) : (
            <div>
              {topProcesses.map((process) => {
                const share = totalBytes > 0 ? (process.workingSetBytes / totalBytes) * 100 : 0
                return (
                  <div
                    key={`${process.pid}-${process.name}`}
                    className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-[12px] font-semibold text-ink-primary"
                        title={process.name}
                      >
                        {process.name}
                      </p>
                      <p className="text-[10px] text-ink-tertiary">PID {process.pid}</p>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[11px]">
                      <p className="text-ink-primary">{formatBytes(process.workingSetBytes)}</p>
                      <p className="text-[10px] text-ink-tertiary">
                        {formatPercent(share)} do total
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* ── Otimizações (só por clique) ────────────────── */}
        <Card className="space-y-4 p-6">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold tracking-tight text-ink-primary">
              Otimizar memória
            </h3>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              Nada roda sozinho: as ações abaixo só acontecem quando você clicar. Nenhum programa é
              fechado.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => setModal('trim')}
              disabled={action !== null}
            >
              {action === 'trim' ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  Liberando memória…
                </>
              ) : (
                <>
                  <Sparkles size={14} aria-hidden="true" />
                  Liberar memória dos programas
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setModal('purge')}
              disabled={action !== null}
            >
              {action === 'purge' ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  Limpando standby…
                </>
              ) : (
                <>
                  <ShieldCheck size={14} aria-hidden="true" />
                  Otimização avançada (UAC)
                </>
              )}
            </Button>
          </div>
        </Card>

        {/* ── Otimização automática (trim, sem UAC) ──────── */}
        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold tracking-tight text-ink-primary">
                Otimização automática
              </h3>
              <p className="text-[12px] leading-relaxed text-ink-secondary">
                Libera a memória ociosa dos programas no intervalo escolhido, sem pedir
                administrador e sem fechar nada. Nada roda com o Hub fechado. Padrão: desligado.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-tertiary">
                {autoPrefs?.enabled ? 'Ligada' : 'Desligada'}
              </span>
              <Switch
                aria-label="Otimização automática de memória"
                checked={autoPrefs?.enabled === true}
                onCheckedChange={handleToggleAuto}
                disabled={autoPrefs === null}
                className="shrink-0"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="text-xs font-semibold text-ink-secondary">
              <span>Executar a cada</span>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  inputMode="numeric"
                  value={autoInterval}
                  onChange={(event) => setAutoInterval(event.target.value)}
                  onBlur={commitAutoInterval}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                  disabled={autoPrefs === null || !autoPrefs.enabled}
                  aria-label="Intervalo da otimização automática em minutos"
                  className="w-24"
                />
                <span className="text-xs text-ink-tertiary">min</span>
              </div>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-tertiary" role="status">
            Só a liberação de memória roda sozinha; a limpeza standby com UAC continua sendo sempre
            por clique.
            {autoFeedback === 'saved' && (
              <span className="ml-2 text-success">Preferência salva.</span>
            )}
            {autoFeedback === 'error' && (
              <span className="ml-2 text-danger">Não foi possível salvar a preferência.</span>
            )}
          </p>
        </Card>

        {/* ── Resultado da última ação ───────────────────── */}
        {result &&
          (result.ok ? (
            <motion.div
              {...entranceProps(reduced, { y: 10 })}
              role="status"
              className="space-y-1.5 rounded-card border border-success-border bg-success-bg p-5"
            >
              <p className="text-[13px] font-semibold leading-relaxed text-success">
                {result.mode === 'trim'
                  ? `✅ ${formatBytes(result.freedBytes)} liberados · ${result.trimmedProcesses ?? 0} programa${(result.trimmedProcesses ?? 0) === 1 ? '' : 's'} ajustado${(result.trimmedProcesses ?? 0) === 1 ? '' : 's'} · ${result.skipped} ignorado${result.skipped === 1 ? '' : 's'}${result.errors > 0 ? ` · ${result.errors} com erro` : ''}`
                  : `✅ Memória standby limpa · ${formatBytes(result.freedBytes)} liberados`}
              </p>
              <p className="text-[11px] leading-relaxed text-ink-secondary">
                Nenhum programa foi fechado. O efeito é temporário: a memória voltará a ser usada
                conforme os programas precisarem.
              </p>
            </motion.div>
          ) : result.cancelled ? (
            <motion.div
              {...entranceProps(reduced, { y: 10 })}
              role="alert"
              className="flex items-start gap-3 rounded-card border border-warn-border bg-warn-bg p-5"
            >
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-warn">Otimização cancelada</p>
                <p className="text-[11px] leading-relaxed text-ink-secondary">
                  {result.error ?? 'A permissão de administrador foi cancelada. Nada foi alterado.'}
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              {...entranceProps(reduced, { y: 10 })}
              role="alert"
              className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-bg p-5"
            >
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-danger">
                  Não foi possível concluir a otimização
                </p>
                <p className="text-[11px] leading-relaxed text-ink-secondary">
                  {result.error ??
                    'Nada foi fechado e nenhuma alteração permanente foi feita. Tente novamente em alguns instantes.'}
                </p>
              </div>
            </motion.div>
          ))}
      </div>

      {/* ── Modal: liberar working sets (sem UAC) ─────────── */}
      {modal === 'trim' && (
        <Modal
          title="Liberar memória dos programas?"
          onClose={closeModal}
          disableClose={action !== null}
          closeLabel="Fechar"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={closeModal} disabled={action !== null}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => void runAction('trim')}
                disabled={action !== null}
              >
                <Sparkles size={14} aria-hidden="true" />
                Liberar agora
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-control border border-accent-border bg-accent-muted">
              <Sparkles size={20} className="text-accent" aria-hidden="true" />
            </div>
            <div className="space-y-2 text-[12px] leading-relaxed">
              <p className="text-ink-primary">Esta ação vai:</p>
              <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
                <li>
                  Pedir ao Windows para devolver a memória ociosa dos programas ao sistema, sem
                  precisar de administrador;
                </li>
                <li>
                  <span className="text-ink-primary">Nunca fechar, encerrar ou reiniciar</span>{' '}
                  nenhum programa;
                </li>
                <li>
                  Preservar o Hub e os processos essenciais do Windows, que são ignorados de
                  propósito.
                </li>
              </ul>
              <p className="text-[11px] text-ink-tertiary">
                O efeito é temporário: os programas voltam a ocupar memória conforme você os usa.
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal: standby list com UAC ───────────────────── */}
      {modal === 'purge' && (
        <Modal
          title="Otimização avançada (UAC)"
          onClose={closeModal}
          disableClose={action !== null}
          closeLabel="Fechar"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={closeModal} disabled={action !== null}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => void runAction('purge')}
                disabled={action !== null}
              >
                <ShieldCheck size={14} aria-hidden="true" />
                Continuar com UAC
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-control border border-warn-border bg-warn-bg">
              <ShieldCheck size={20} className="text-warn" aria-hidden="true" />
            </div>
            <div className="space-y-2 text-[12px] leading-relaxed">
              <p className="text-ink-primary">
                Esta ação pede permissão de administrador (UAC) e vai:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-ink-secondary">
                <li>Limpar a memória standby, usada como cache de arquivos do Windows;</li>
                <li>
                  Fazer o Windows recarregar arquivos do disco depois, então o PC pode ficar um
                  pouco mais lento nos primeiros minutos;
                </li>
                <li>
                  <span className="text-ink-primary">Não fechar nenhum programa</span> e só
                  acontecer depois que você confirmar o pedido do Windows.
                </li>
              </ul>
              <p className="text-[11px] text-ink-tertiary">
                Se você recusar o UAC, nada será alterado e você pode tentar de novo quando quiser.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
