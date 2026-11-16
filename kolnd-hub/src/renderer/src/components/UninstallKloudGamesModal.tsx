// Modal de confirmação e acompanhamento da desinstalação do Kloud Games.
//
// Fases: 'confirm' → 'running' → 'done' | 'error'. Toda a chamada ao MSI,
// leitura de registro e laudo é feita exclusivamente via window.api.* — este
// componente não duplica lógica de desinstalação.
//
// Recebe `open` (controlado pelo pai) e o pai restaura o foco ao botão de origem
// ao fechar. role="alertdialog" + aria-labelledby, ciclo de Tab preso no modal,
// Esc cancela apenas na confirmação e clique no backdrop não fecha durante a
// execução.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Files,
  FolderOpen,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import { getKloudPartialKind, getParentDir, type KloudDetectionLike } from '../lib/uninstall'
import { useFocusTrap } from '../lib/useFocusTrap'

type Phase = 'confirm' | 'running' | 'done' | 'error'

interface UninstallKloudGamesModalProps {
  open: boolean
  /** O Kloud Games está em execução (exibe aviso no confirm). */
  isRunning?: boolean
  /** Detecção completa vinda do main (define o modo da confirmação). */
  detection?: KloudDetectionLike | null
  onClose: () => void
  onRunningChange?: (running: boolean) => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

const STEP_LABELS: Record<string, string> = {
  check: 'Verificando instalação…',
  kill: 'Encerrando o Kloud Games…',
  msiexec: 'Desinstalando o Kloud Games…',
  verify: 'Verificando a remoção…',
  cleanup: 'Limpando arquivos temporários…',
  done: 'Concluído'
}

/** Aviso + botão "Remover serviço agora" (elevado, com confirmação própria). */
function ServiceRemovalSection({
  serviceState,
  serviceError,
  onShowConfirm,
  onCancelConfirm,
  onConfirmRemove,
  className = ''
}: {
  serviceState: 'idle' | 'confirm' | 'busy' | 'done' | 'error'
  serviceError: string | null
  onShowConfirm: () => void
  onCancelConfirm: () => void
  onConfirmRemove: () => void
  className?: string
}): JSX.Element | null {
  if (serviceState === 'done') return null
  return (
    <div
      className={`rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left ${className}`}
    >
      <p className="text-[11px] text-amber-300 leading-relaxed">
        ⚠ O serviço <span className="font-mono">KLOUD_GAMESsvc</span> ainda está presente. Suporte:{' '}
        <span className="font-mono">sc delete KLOUD_GAMESsvc</span> num Prompt de Comando elevado.
      </p>
      {serviceState === 'idle' && (
        <button type="button" className="btn-ghost text-xs mt-2" onClick={onShowConfirm}>
          <Wrench size={14} /> Remover serviço agora
        </button>
      )}
      {serviceState === 'confirm' && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-amber-200/90">
            Confirma a remoção do serviço <span className="font-mono">KLOUD_GAMESsvc</span>? A ação
            é elevada e não pode ser desfeita sem reinstalar o Kloud Games.
          </p>
          <div className="flex gap-3">
            <button type="button" className="btn-danger text-xs" onClick={onConfirmRemove}>
              <Trash2 size={14} /> Confirmar remoção do serviço
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={onCancelConfirm}>
              Voltar
            </button>
          </div>
        </div>
      )}
      {serviceState === 'busy' && (
        <p className="mt-2 text-[11px] text-amber-200/90">Removendo o serviço…</p>
      )}
      {serviceState === 'error' && serviceError && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-red-300">⚠ {serviceError}</p>
          <button type="button" className="btn-ghost text-xs" onClick={onCancelConfirm}>
            Tentar novamente
          </button>
        </div>
      )}
    </div>
  )
}

export function UninstallKloudGamesModal({
  open,
  isRunning = false,
  detection = null,
  onClose,
  onRunningChange,
  onToast
}: UninstallKloudGamesModalProps): JSX.Element | null {
  const showToast = useCallback(
    (msg: string, kind: 'success' | 'error' | 'info' = 'info'): void => {
      onToast?.(msg, kind)
    },
    [onToast]
  )

  const [phase, setPhase] = useState<Phase>('confirm')
  const [runKind, setRunKind] = useState<'normal' | 'orphan'>('normal')
  const [confirmCode, setConfirmCode] = useState('')
  const [progress, setProgress] = useState(0)
  const [stepLabel, setStepLabel] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<{
    success: boolean
    error?: string
    stage?: string
    msiexecKind?: string
    orphanManual?: boolean
    cancelled?: boolean
    needsReboot?: boolean
    report?: unknown
  } | null>(null)
  // Remoção do serviço órfão (elevada, com confirmação própria).
  const [serviceState, setServiceState] = useState<'idle' | 'confirm' | 'busy' | 'done' | 'error'>(
    'idle'
  )
  const [serviceError, setServiceError] = useState<string | null>(null)
  const unsubRef = useRef<(() => void)[]>([])
  // Guarda síncrona contra clique duplo no mesmo frame (a guarda de `phase`
  // só vale a partir do próximo render; o main ainda rejeitaria via isBusy).
  const clickingRef = useRef(false)

  useEffect(() => {
    return (): void => {
      unsubRef.current.forEach((unsub) => unsub())
      unsubRef.current = []
    }
  }, [])

  // Sinaliza ao pai se a seção deve ficar desativada (apenas enquanto roda).
  // setUninstalling vem do pai e é disparado no corpo do efeito; a regra do
  // ESLint não rastreia setState cruzando componentes, e este efeito apenas
  // espelha a fase local para o pai.
  useEffect(() => {
    onRunningChange?.(phase === 'running')
  }, [phase, onRunningChange])

  // Fase running: inscreve nos eventos e inicia a desinstalação. Todo setState
  // acontece dentro de callbacks de evento / promise, nunca síncrono no corpo.
  useEffect(() => {
    if (phase !== 'running') return

    const unsubProgress = window.api.onUninstallProgress((data) => {
      setStepLabel(data.message ?? STEP_LABELS[data.stepId] ?? data.stepId)
      setProgress(Math.max(0, Math.min(100, Number(data.progress ?? 0))))
    })
    const unsubLog = window.api.onUninstallLog((line) => {
      setLogs((prev) => [...prev.slice(-199), line])
    })
    const unsubComplete = window.api.onUninstallComplete((res) => {
      clickingRef.current = false
      setResult(res)
      setPhase(res.success ? 'done' : 'error')
    })

    unsubRef.current = [unsubProgress, unsubLog, unsubComplete]

    const start =
      runKind === 'orphan'
        ? window.api.uninstallKloudGamesOrphan()
        : window.api.uninstallKloudGames()

    void start.catch((err) => {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Falha inesperada ao iniciar a desinstalação.'
      })
      setPhase('error')
    })

    return (): void => {
      unsubProgress()
      unsubLog()
      unsubComplete()
    }
  }, [phase, runKind])

  // Toasts finais (mesmo padrão dos demais toasts do App, via onToast).
  useEffect(() => {
    if (!result) return
    if (phase === 'done') {
      const report = result.report as { remaining?: string[] } | undefined
      const remaining = report?.remaining ?? []
      if (remaining.length > 0) {
        showToast('Kloud Games desinstalado parcialmente. Alguns itens permaneceram.', 'success')
      } else {
        showToast('Kloud Games desinstalado.', 'success')
      }
    } else if (phase === 'error') {
      const neutral = result?.msiexecKind === 'cancelled'
      showToast(
        neutral
          ? 'Desinstalação cancelada.'
          : `Falha ao desinstalar o Kloud Games: ${result?.error ?? 'erro desconhecido'}`,
        neutral ? 'info' : 'error'
      )
    }
  }, [phase, result, showToast])

  const canConfirm = confirmCode.trim().toUpperCase() === 'KLOUD_GAMES'

  // Esc fecha fora da execução; durante 'running' o modal é infechável.
  const handleEscape = useCallback((): void => {
    if (phase !== 'running') onClose()
  }, [phase, onClose])

  // Trap de foco + Esc via hook compartilhado; data-autofocus marca o foco
  // seguro (Cancelar) também quando a fase troca e os botões são desmontados.
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: open,
    watch: phase,
    onEscape: handleEscape
  })

  const handleBackdropClick = useCallback((): void => {
    if (phase === 'running') return // não fecha durante a execução
    onClose()
  }, [phase, onClose])

  // Encerra o processo do Kloud Games antes de continuar (best-effort; o passo
  // 'kill' do desinstalador também encerra o processo).
  const handleTerminate = useCallback(async (): Promise<void> => {
    try {
      void window.api.stopApp('kloud-games')
    } catch {
      // Ignorar — o fluxo de desinstalação cuida do encerramento.
    }
  }, [])

  const handleConfirm = (): void => {
    if (clickingRef.current || phase !== 'confirm') return // clique duplo não dispara duas vezes
    clickingRef.current = true
    setRunKind('normal')
    setPhase('running')
  }

  const handleOrphan = (): void => {
    if (clickingRef.current || phase !== 'confirm') return // clique duplo não dispara duas vezes
    clickingRef.current = true
    setRunKind('orphan')
    setPhase('running')
  }

  const handleRetry = (): void => {
    setPhase('confirm')
    setConfirmCode('')
    setResult(null)
    setProgress(0)
    setStepLabel('')
    setLogs([])
    setRunKind('normal')
    setServiceState('idle')
    setServiceError(null)
    clickingRef.current = false
  }

  const handleOpenLogs = async (): Promise<void> => {
    try {
      await window.api.openHubLogsFolder()
    } catch {
      // Ignorar
    }
  }

  const handleRemoveService = async (): Promise<void> => {
    if (serviceState === 'busy') return // clique duplo não dispara duas vezes
    setServiceState('busy')
    setServiceError(null)
    try {
      const res = await window.api.removeKloudGamesService()
      if (res.success) {
        setServiceState('done')
      } else {
        setServiceError(res.error ?? 'Não foi possível remover o serviço KLOUD_GAMESsvc.')
        setServiceState('error')
      }
    } catch (err) {
      setServiceError(err instanceof Error ? err.message : 'Não foi possível remover o serviço.')
      setServiceState('error')
    }
  }

  const errorMessage = result?.error ?? 'Não foi possível desinstalar o Kloud Games.'
  const partialKind = getKloudPartialKind(detection)
  const orphanTargetDir = detection?.exePath ? getParentDir(detection.exePath) : null
  const isRegistryOrphan = partialKind === 'registry-orphan'
  const isExeOrphan = partialKind === 'exe-orphan'
  const isServiceOrphan = partialKind === 'service-orphan'
  const orphanButtonLabel = isRegistryOrphan
    ? 'Desinstalar pelo registro'
    : isExeOrphan
      ? 'Remover somente os arquivos restantes'
      : 'Desinstalar'
  // 1602 = cancelado pelo usuário → destaque neutro (não vermelho).
  const isNeutralCancel = result?.msiexecKind === 'cancelled'
  // taskkill falhou duas vezes → instrução manual, nunca chama o MSI.
  const isKillFailure = result?.stage === 'kill'
  const report = result?.report as
    | {
        exeGone?: boolean
        serviceGone?: boolean
        registryGone?: boolean
        shortcutsGone?: boolean
        tempCleaned?: boolean
        remaining?: string[]
        logPath?: string
      }
    | undefined
  // O botão de remover o serviço aparece quando o laudo (ou a detecção) indica
  // que o KLOUD_GAMESsvc sobreviveu — sempre com confirmação própria.
  const showServiceRemoval =
    serviceState !== 'done' &&
    ((phase === 'done' && report?.serviceGone === false) ||
      (phase === 'confirm' && isServiceOrphan))
  const needsReboot = Boolean(result?.success && result.needsReboot)
  const remaining = report?.remaining ?? []

  const checks = [
    { label: 'Executável KLOUD_GAMES.exe', ok: report?.exeGone },
    { label: 'Serviço KLOUD_GAMESsvc', ok: report?.serviceGone },
    { label: 'Registro de desinstalação', ok: report?.registryGone },
    { label: 'Atalhos do Menu Iniciar', ok: report?.shortcutsGone },
    { label: 'Arquivos temporários (%TEMP%\\KLOUD_GAMES)', ok: report?.tempCleaned }
  ]

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="uninstall-modal-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        disabled={phase === 'running'}
        onClick={handleBackdropClick}
      />
      <div
        ref={trapRef}
        className="relative w-full max-w-md space-y-4 rounded-3xl border border-white/[0.08] bg-[#0d0d14]/95 p-6 text-center shadow-2xl shadow-black/60"
      >
        {/* ── confirm ── */}
        {phase === 'confirm' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              {isExeOrphan || isServiceOrphan ? (
                <Files size={30} className="text-red-400" />
              ) : (
                <AlertCircle size={30} className="text-red-400" />
              )}
            </div>
            <h3 id="uninstall-modal-title" className="text-lg font-bold text-white">
              {isExeOrphan
                ? 'Remover os arquivos restantes?'
                : isServiceOrphan
                  ? 'Só o serviço KLOUD_GAMESsvc restou'
                  : isRegistryOrphan
                    ? 'Desinstalar o Kloud Games pelo registro?'
                    : 'Desinstalar o Kloud Games?'}
            </h3>
            {isServiceOrphan ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] text-amber-300 leading-relaxed">
                ⚠ Instalação quebrada detectada: não há programa para desinstalar nem arquivos para
                remover — apenas o serviço <span className="font-mono">KLOUD_GAMESsvc</span> consta.
                <br />
                Nada do registro será alterado. Use o botão abaixo para remover o serviço (com
                confirmação e elevação).
              </div>
            ) : isExeOrphan ? (
              <>
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-[11px] text-red-300 leading-relaxed">
                  ⚠ <strong>Instalação quebrada</strong>: os arquivos do Kloud Games ainda existem
                  em{' '}
                  <span className="break-all font-mono">
                    {orphanTargetDir ?? 'C:\\Program Files\\KLOUD_GAMES'}
                  </span>
                  , mas o registro não consta — o Windows não consegue desinstalar pelo método
                  normal (msiexec).{' '}
                  <strong>Não use este caminho para uma instalação íntegra.</strong>
                </div>
                <div className="text-left text-[11px] text-slate-400 space-y-1 leading-relaxed">
                  <p className="text-slate-300 font-semibold text-xs">O que acontecerá:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>
                      Apaga SOMENTE a pasta de instalação{' '}
                      <span className="font-mono break-all">
                        {orphanTargetDir ?? 'C:\\Program Files\\KLOUD_GAMES'}
                      </span>
                    </li>
                    <li>Zera o estado salvo do Hub (kloud-games.paths.json)</li>
                    <li>Nada do registro será alterado — a entrada já não existe</li>
                    <li>
                      O serviço <span className="font-mono">KLOUD_GAMESsvc</span> e o firewall (se
                      existissem) NÃO serão tocados — o laudo final dirá exatamente o que restou
                    </li>
                    <li>
                      Por segurança, o Hub RECUSA apagar qualquer outra pasta (fora de C:\Program
                      Files\KLOUD_GAMES)
                    </li>
                  </ul>
                </div>
                {detection?.service !== 'missing' && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] text-amber-300 leading-relaxed">
                    ⚠ O serviço <span className="font-mono">KLOUD_GAMESsvc</span> ainda consta — a
                    remoção dos arquivos NÃO remove o serviço. Use "Remover serviço agora" na tela
                    final.
                  </div>
                )}
              </>
            ) : (
              <>
                {isRegistryOrphan ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] text-amber-300 leading-relaxed">
                    ⚠ Instalação quebrada: o executável não foi encontrado, mas o registro consta
                    como instalado. A desinstalação <strong>pelo registro</strong> será tentada
                    normalmente e o laudo verificará o resultado.
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Serão removidos:</p>
                )}
                <ul className="text-left text-xs text-slate-400 space-y-1">
                  <li>Programa e dados em C:\Program Files\KLOUD_GAMES — incluindo config\</li>
                  <li>Serviço KLOUD_GAMESsvc</li>
                  <li>Regras de firewall do Kloud Games</li>
                  <li>Entrada do PATH do sistema</li>
                  <li>Atalhos do Menu Iniciar</li>
                </ul>
              </>
            )}
            {isRunning && (
              <>
                <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                  ⚠ O Kloud Games está em execução. Streams Moonlight em andamento serão
                  interrompidas.
                </div>
                <button
                  type="button"
                  onClick={handleTerminate}
                  className="mt-2 btn-ghost text-xs"
                  title="Encerrar o Kloud Games antes de continuar"
                >
                  <X size={14} /> Encerrar o Kloud Games e continuar
                </button>
              </>
            )}
            {showServiceRemoval && (
              <ServiceRemovalSection
                serviceState={serviceState}
                serviceError={serviceError}
                onShowConfirm={() => setServiceState('confirm')}
                onCancelConfirm={() => setServiceState('idle')}
                onConfirmRemove={() => void handleRemoveService()}
              />
            )}
            {!isServiceOrphan && (
              <div className="mt-5">
                <label
                  htmlFor="uninstall-kloud-confirm"
                  className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2"
                >
                  Digite <span className="text-red-400 font-mono">KLOUD_GAMES</span> para confirmar
                </label>
                <input
                  id="uninstall-kloud-confirm"
                  type="text"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  className="input-gamer text-center"
                  placeholder="KLOUD_GAMES"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Não diferencia maiúsculas/minúsculas.
                </p>
              </div>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" className="btn-secondary" data-autofocus onClick={onClose}>
                Cancelar
              </button>
              {!isServiceOrphan && (
                <button
                  type="button"
                  className="btn-danger"
                  disabled={!canConfirm}
                  onClick={isExeOrphan ? handleOrphan : handleConfirm}
                >
                  {isExeOrphan ? <Files size={14} /> : <Trash2 size={14} />}
                  {orphanButtonLabel}
                </button>
              )}
            </div>
          </>
        )}

        {/* ── running ── */}
        {phase === 'running' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <AlertCircle size={30} className="text-red-400 animate-pulse" />
            </div>
            <h3 id="uninstall-modal-title" className="text-lg font-bold text-white">
              Desinstalação em andamento
            </h3>
            <p className="text-sm text-slate-400 mt-1" role="status" aria-live="polite">
              {stepLabel || 'Iniciando…'}
            </p>
            <div className="mt-4">
              <div className="flex justify-between mb-1 text-[10px]">
                <span className="text-slate-400">{stepLabel || 'Etapa atual'}</span>
                <span className="text-red-400 font-mono">{progress}%</span>
              </div>
              <div className="w-full bg-slate-800/50 rounded-full h-2">
                <div
                  className="bg-red-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/40 p-3 text-left">
              <details className="group">
                <summary className="text-xs font-bold text-slate-400 cursor-pointer flex items-center justify-between">
                  Log ao vivo ({logs.length} linhas)
                  <ChevronRight
                    size={14}
                    className="transition-transform duration-200 group-open:rotate-90"
                  />
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto text-[11px] font-mono text-slate-300">
                  {logs.length === 0 ? (
                    <span className="text-slate-400">Aguardando log…</span>
                  ) : (
                    logs.map((line, i) => <div key={i}>{line}</div>)
                  )}
                </div>
              </details>
            </div>
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
              ⚠ Não feche a janela enquanto a desinstalação estiver em andamento.
            </div>
          </>
        )}

        {/* ── done ── */}
        {phase === 'done' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
              <Check size={30} className="text-emerald-400" />
            </div>
            {remaining.length > 0 ? (
              <>
                <h3 id="uninstall-modal-title" className="text-lg font-bold text-white">
                  Desinstalação concluída parcialmente
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  Alguns itens não puderam ser removidos automaticamente:
                </p>
                <ul className="mt-2 text-left text-xs text-slate-400 space-y-1">
                  {remaining.map((item) => (
                    <li key={item}>⚠ {item}</li>
                  ))}
                </ul>
                <p className="mt-3 text-[10px] text-slate-400">
                  Orientação: use o Painel de Controle → Aplicativos ou remova manualmente os itens
                  restantes. Nada é apagado sem você pedir.
                </p>
              </>
            ) : (
              <>
                <h3 id="uninstall-modal-title" className="text-lg font-bold text-white">
                  Kloud Games desinstalado
                </h3>
                <p className="text-sm text-slate-400 mt-1">Laudo da remoção</p>
                <div className="mt-3 text-left space-y-2">
                  {checks.map(({ label, ok }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      <span className={ok ? 'text-emerald-400' : 'text-red-400'}>
                        {ok ? '✓' : '⚠'}
                      </span>
                      <span className="text-slate-300">{label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {/* Reinício pendente (3010/1641): banner persiste até fechar o modal. */}
            {needsReboot && (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                ⚠ Reinicie o PC para concluir a remoção.
              </div>
            )}
            {showServiceRemoval && (
              <ServiceRemovalSection
                className="mt-3"
                serviceState={serviceState}
                serviceError={serviceError}
                onShowConfirm={() => setServiceState('confirm')}
                onCancelConfirm={() => setServiceState('idle')}
                onConfirmRemove={() => void handleRemoveService()}
              />
            )}
            {serviceState === 'done' && (
              <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300">
                ✓ Serviço KLOUD_GAMESsvc removido.
              </div>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" className="btn-secondary" onClick={() => onClose()}>
                Concluir
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={handleOpenLogs}
                title="Abrir pasta de logs"
              >
                <FolderOpen size={14} /> Abrir pasta de logs
              </button>
            </div>
          </>
        )}

        {/* ── error ── */}
        {phase === 'error' && (
          <>
            <div
              className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border ${
                isNeutralCancel
                  ? 'border-slate-500/30 bg-slate-500/10'
                  : 'border-red-500/30 bg-red-500/10'
              }`}
            >
              <AlertCircle
                size={30}
                className={isNeutralCancel ? 'text-slate-400' : 'text-red-400'}
              />
            </div>
            <h3 id="uninstall-modal-title" className="text-lg font-bold text-white">
              {isNeutralCancel ? 'Cancelado por você.' : 'Falha ao desinstalar'}
            </h3>
            {!isNeutralCancel && <p className="text-sm text-slate-400 mt-1">{errorMessage}</p>}
            {isKillFailure && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] text-amber-300 leading-relaxed">
                ⚠ Não foi possível encerrar o processo{' '}
                <span className="font-mono">KLOUD_GAMES.exe</span> automaticamente (as duas
                tentativas de <span className="font-mono">taskkill</span> falharam). Por isso o MSI
                não foi iniciado — nada foi removido.
                <br />
                <span className="text-amber-200/90">
                  Para resolver: pressione <span className="font-mono">Ctrl + Shift + Esc</span>, vá
                  na aba <span className="font-mono">Detalhes</span>, localize{' '}
                  <span className="font-mono">KLOUD_GAMES.exe</span>, clique em{' '}
                  <span className="font-mono">Finalizar tarefa</span> e tente de novo.
                </span>
              </div>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                className={isNeutralCancel ? 'btn-secondary' : 'btn-danger'}
                onClick={handleRetry}
              >
                {isNeutralCancel ? <ChevronRight size={14} /> : <Trash2 size={14} />}
                Tentar novamente
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={handleOpenLogs}
                title="Abrir pasta de logs"
              >
                <FolderOpen size={14} /> Abrir pasta de logs
              </button>
              <button type="button" className="btn-secondary" onClick={() => onClose()}>
                Fechar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
