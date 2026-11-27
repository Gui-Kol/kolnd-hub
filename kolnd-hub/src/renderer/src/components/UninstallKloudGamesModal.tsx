// Modal de confirmação e acompanhamento da desinstalação do Kloud Games.
//
// Fases: 'confirm' → 'running' → 'done' | 'error'. Toda a chamada ao MSI,
// leitura de registro e laudo é feita exclusivamente via window.api.* — este
// componente não duplica lógica de desinstalação.
//
// O pai restaura o foco ao botão de origem ao fechar. Primário Modal (13.6)
// como CASCA: em 'running' o modal é infechável (Esc, backdrop e o X ficam
// desligados via disableClose — como antes); nas demais fases, Esc/backdrop/X
// fecham (como antes). O foco preso é o do primitivo Modal (mesmo padrão dos
// demais modais reformulados). `data-autofocus` marca o foco seguro (Cancelar)
// como antes.
//
// Reformulação visual 2.0 (13.13): interiores tokenizados, STEP_LABELS como
// stepper/índice discreto (apenas apresentação — nenhum passo novo/alterado),
// CTAs danger somente no último passo. Passos, ordem, textos, bloqueios,
// detecção parcial e confirmações: IDÊNTICOS.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Files,
  FolderOpen,
  Package,
  Shield,
  Terminal,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import { getKloudPartialKind, getParentDir, type KloudDetectionLike } from '../lib/uninstall'
import { Button, Input, Modal } from './ui'

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
const STEP_ORDER = Object.keys(STEP_LABELS)

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
      className={`rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-left ${className}`}
    >
      <p className="text-[11px] leading-relaxed text-warn">
        ⚠ O serviço <span className="font-mono">KLOUD_GAMESsvc</span> ainda está presente. Suporte:{' '}
        <span className="font-mono">sc delete KLOUD_GAMESsvc</span> num Prompt de Comando elevado.
      </p>
      {serviceState === 'idle' && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={onShowConfirm}>
          <Wrench size={14} aria-hidden="true" /> Remover serviço agora
        </Button>
      )}
      {serviceState === 'confirm' && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-warn">
            Confirma a remoção do serviço <span className="font-mono">KLOUD_GAMESsvc</span>? A ação
            é elevada e não pode ser desfeita sem reinstalar o Kloud Games.
          </p>
          <div className="flex gap-3">
            <Button variant="danger" size="sm" onClick={onConfirmRemove}>
              <Trash2 size={14} aria-hidden="true" /> Confirmar remoção do serviço
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancelConfirm}>
              Voltar
            </Button>
          </div>
        </div>
      )}
      {serviceState === 'busy' && (
        <p className="mt-2 text-[11px] text-warn">Removendo o serviço…</p>
      )}
      {serviceState === 'error' && serviceError && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-danger">⚠ {serviceError}</p>
          <Button variant="ghost" size="sm" onClick={onCancelConfirm}>
            Tentar novamente
          </Button>
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
  // Índice do stepper — puro espelhamento visual de data.stepId (nenhuma
  // decisão de fluxo depende dele).
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const [seenSteps, setSeenSteps] = useState<string[]>([])
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
      setSeenSteps((prev) => (prev.includes(data.stepId) ? prev : [...prev, data.stepId]))
      setCurrentStepId(data.stepId)
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

  // Em 'running' o modal é infechável (Esc, backdrop e o X ficam desligados
  // no primitivo Modal); fora de 'running', Esc/backdrop/X fecham.
  const handleBackdropClick = useCallback((): void => {
    onClose()
  }, [onClose])

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
    setCurrentStepId(null)
    setSeenSteps([])
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
        configGone?: boolean
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
    { label: 'Arquivos temporários (%TEMP%\\KLOUD_GAMES)', ok: report?.tempCleaned },
    {
      label:
        'Configurações (config\\, %LOCALAPPDATA%\\LizardByte\\KLOUD_GAMES e %ProgramData%\\KLOUD_GAMES)',
      ok: report?.configGone
    }
  ]

  if (!open) return null

  return (
    <Modal
      disableClose={phase === 'running'}
      ariaLabel="Desinstalar o Kloud Games?"
      onClose={handleBackdropClick}
      closeLabel="Fechar"
    >
      {/* ── confirm ── */}
      {phase === 'confirm' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-danger-border bg-danger-bg">
            {isExeOrphan || isServiceOrphan ? (
              <Files size={32} className="text-danger" aria-hidden="true" />
            ) : (
              <AlertCircle size={32} className="text-danger" aria-hidden="true" />
            )}
          </div>
          <h3 className="text-lg font-bold text-ink-primary">
            {isExeOrphan
              ? 'Remover os arquivos restantes?'
              : isServiceOrphan
                ? 'Só o serviço KLOUD_GAMESsvc restou'
                : isRegistryOrphan
                  ? 'Desinstalar o Kloud Games pelo registro?'
                  : 'Desinstalar o Kloud Games?'}
          </h3>
          {isServiceOrphan ? (
            <div className="w-full rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-left text-[11px] leading-relaxed text-warn">
              ⚠ Instalação quebrada detectada: não há programa para desinstalar nem arquivos para
              remover — apenas o serviço <span className="font-mono">KLOUD_GAMESsvc</span> consta.
              <br />
              Nada do registro será alterado. Use o botão abaixo para remover o serviço (com
              confirmação e elevação).
            </div>
          ) : isExeOrphan ? (
            <>
              <div className="w-full rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-left text-[11px] leading-relaxed text-danger">
                ⚠ <strong>Instalação quebrada</strong>: os arquivos do Kloud Games ainda existem em{' '}
                <span className="break-all font-mono">
                  {orphanTargetDir ?? 'C:\\Program Files\\KLOUD_GAMES'}
                </span>
                , mas o registro não consta — o Windows não consegue desinstalar pelo método normal
                (msiexec). <strong>Não use este caminho para uma instalação íntegra.</strong>
              </div>
              <div className="w-full space-y-1 text-left text-[11px] leading-relaxed text-ink-secondary">
                <p className="text-xs font-semibold text-ink-primary">O que acontecerá:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    Apaga SOMENTE a pasta de instalação{' '}
                    <span className="break-all font-mono">
                      {orphanTargetDir ?? 'C:\\Program Files\\KLOUD_GAMES'}
                    </span>
                  </li>
                  <li>
                    Apaga as configurações em{' '}
                    <span className="font-mono">%LOCALAPPDATA%\LizardByte\KLOUD_GAMES</span> e{' '}
                    <span className="font-mono">%ProgramData%\KLOUD_GAMES</span>
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
                <div className="w-full rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-left text-[11px] leading-relaxed text-warn">
                  ⚠ O serviço <span className="font-mono">KLOUD_GAMESsvc</span> ainda consta — a
                  remoção dos arquivos NÃO remove o serviço. Use "Remover serviço agora" na tela
                  final.
                </div>
              )}
            </>
          ) : (
            <>
              {isRegistryOrphan ? (
                <div className="w-full rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-left text-[11px] leading-relaxed text-warn">
                  ⚠ Instalação quebrada: o executável não foi encontrado, mas o registro consta como
                  instalado. A desinstalação <strong>pelo registro</strong> será tentada normalmente
                  e o laudo verificará o resultado.
                </div>
              ) : (
                <p className="w-full text-left text-sm text-ink-secondary">Serão removidos:</p>
              )}
              <ul className="w-full space-y-1 text-left text-xs text-ink-secondary">
                <li className="flex items-center gap-2">
                  <Package size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span>
                    Programa e dados em C:\Program Files\KLOUD_GAMES — incluindo config\ e
                    config\credentials
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Wrench size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span>
                    Configurações do serviço em %LOCALAPPDATA%\LizardByte\KLOUD_GAMES e
                    %ProgramData%\KLOUD_GAMES
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span>Serviço KLOUD_GAMESsvc</span>
                </li>
                <li className="flex items-center gap-2">
                  <Shield size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span>Regras de firewall do Kloud Games</span>
                </li>
                <li className="flex items-center gap-2">
                  <Terminal size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span>Entrada do PATH do sistema</span>
                </li>
                <li className="flex items-center gap-2">
                  <FolderOpen size={12} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span>Atalhos do Menu Iniciar</span>
                </li>
              </ul>
            </>
          )}
          {isRunning && (
            <>
              <div className="w-full rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-[11px] leading-relaxed text-danger">
                ⚠ O Kloud Games está em execução. Streams Moonlight em andamento serão
                interrompidas.
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={handleTerminate}
                title="Encerrar o Kloud Games antes de continuar"
              >
                <X size={14} aria-hidden="true" /> Encerrar o Kloud Games e continuar
              </Button>
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
            <div className="mt-1 w-full">
              <label
                htmlFor="uninstall-kloud-confirm"
                className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-ink-tertiary"
              >
                Digite <span className="font-mono text-danger">KLOUD_GAMES</span> para confirmar
              </label>
              <Input
                id="uninstall-kloud-confirm"
                type="text"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                className="text-center font-mono"
                placeholder="KLOUD_GAMES"
              />
              <p className="mt-1 text-[10px] text-ink-tertiary">
                Não diferencia maiúsculas/minúsculas.
              </p>
            </div>
          )}
          <div className="mt-1 flex justify-center gap-3">
            <Button variant="secondary" data-autofocus onClick={onClose}>
              Cancelar
            </Button>
            {!isServiceOrphan && (
              <Button
                variant="danger"
                disabled={!canConfirm}
                onClick={isExeOrphan ? handleOrphan : handleConfirm}
              >
                {isExeOrphan ? (
                  <Files size={14} aria-hidden="true" />
                ) : (
                  <Trash2 size={14} aria-hidden="true" />
                )}
                {orphanButtonLabel}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── running ── */}
      {phase === 'running' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-danger-border bg-danger-bg">
            <AlertCircle size={32} className="animate-pulse text-danger" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-bold text-ink-primary">Desinstalação em andamento</h3>
          <p className="text-sm text-ink-secondary" role="status" aria-live="polite">
            {stepLabel || 'Iniciando…'}
          </p>
          {/* Índice discreto das etapas — apenas apresentação; a ordem e a
              quantidade de passos são as mesmas de sempre. */}
          <ol className="w-full space-y-1 text-left" aria-hidden="true">
            {STEP_ORDER.map((id, index) => {
              const seen = seenSteps.includes(id)
              const isCurrent = currentStepId === id
              return (
                <li
                  key={id}
                  className={`flex items-center gap-2 text-[10px] leading-tight ${
                    isCurrent ? 'text-danger' : seen ? 'text-success' : 'text-ink-tertiary'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border font-mono text-[9px] ${
                      isCurrent
                        ? 'border-danger-border'
                        : seen
                          ? 'border-success-border'
                          : 'border-[var(--border-subtle)]'
                    }`}
                  >
                    {seen && !isCurrent ? <Check size={9} aria-hidden="true" /> : index + 1}
                  </span>
                  <span>{STEP_LABELS[id]}</span>
                </li>
              )
            })}
          </ol>
          <div className="mt-1 w-full">
            <div className="mb-1 flex justify-between text-[10px]">
              <span className="text-ink-tertiary">{stepLabel || 'Etapa atual'}</span>
              <span className="font-mono text-danger">{progress}%</span>
            </div>
            <div className="h-2 w-full rounded-pill bg-surface-2">
              <div
                className="h-2 rounded-pill bg-danger transition-all duration-3 ease-standard"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="mt-1 w-full rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-3 text-left">
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between text-xs font-bold text-ink-tertiary">
                Log ao vivo ({logs.length} linhas)
                <ChevronRight
                  size={14}
                  className="transition-transform duration-2 ease-standard group-open:rotate-90"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto font-mono text-[11px] text-ink-secondary">
                {logs.length === 0 ? (
                  <span className="text-ink-tertiary">Aguardando log…</span>
                ) : (
                  logs.map((line, i) => <div key={i}>{line}</div>)
                )}
              </div>
            </details>
          </div>
          <div className="w-full rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-[11px] leading-relaxed text-danger">
            ⚠ Não feche a janela enquanto a desinstalação estiver em andamento.
          </div>
        </div>
      )}

      {/* ── done ── */}
      {phase === 'done' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-success-border bg-success-bg">
            <Check size={32} className="text-success" aria-hidden="true" />
          </div>
          {remaining.length > 0 ? (
            <>
              <h3 className="text-lg font-bold text-ink-primary">
                Desinstalação concluída parcialmente
              </h3>
              <p className="text-sm text-ink-secondary">
                Alguns itens não puderam ser removidos automaticamente:
              </p>
              <ul className="w-full space-y-1 text-left text-xs text-ink-secondary">
                {remaining.map((item) => (
                  <li key={item}>⚠ {item}</li>
                ))}
              </ul>
              <p className="mt-1 w-full text-left text-[10px] leading-relaxed text-ink-tertiary">
                Orientação: use o Painel de Controle → Aplicativos ou remova manualmente os itens
                restantes. Nada é apagado sem você pedir.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold text-ink-primary">Kloud Games desinstalado</h3>
              <p className="text-sm text-ink-secondary">Laudo da remoção</p>
              <div className="mt-1 w-full space-y-2 text-left">
                {checks.map(({ label, ok }) => (
                  <div key={label} className="flex items-center gap-2 text-xs">
                    <span className={ok ? 'text-success' : 'text-danger'} aria-hidden="true">
                      {ok ? '✓' : '⚠'}
                    </span>
                    <span className="text-ink-primary">{label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {/* Reinício pendente (3010/1641): banner persiste até fechar o modal. */}
          {needsReboot && (
            <div className="w-full rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn">
              ⚠ Reinicie o PC para concluir a remoção.
            </div>
          )}
          {showServiceRemoval && (
            <ServiceRemovalSection
              className="w-full"
              serviceState={serviceState}
              serviceError={serviceError}
              onShowConfirm={() => setServiceState('confirm')}
              onCancelConfirm={() => setServiceState('idle')}
              onConfirmRemove={() => void handleRemoveService()}
            />
          )}
          {serviceState === 'done' && (
            <div className="w-full rounded-control border border-success-border bg-success-bg px-3 py-2 text-[11px] leading-relaxed text-success">
              ✓ Serviço KLOUD_GAMESsvc removido.
            </div>
          )}
          <div className="mt-1 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => onClose()}>
              Concluir
            </Button>
            <Button variant="ghost" onClick={handleOpenLogs} title="Abrir pasta de logs">
              <FolderOpen size={14} aria-hidden="true" /> Abrir pasta de logs
            </Button>
          </div>
        </div>
      )}

      {/* ── error ── */}
      {phase === 'error' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-card border ${
              isNeutralCancel
                ? 'border-[var(--border-strong)] bg-surface-2'
                : 'border-danger-border bg-danger-bg'
            }`}
          >
            <AlertCircle
              size={32}
              className={isNeutralCancel ? 'text-ink-tertiary' : 'text-danger'}
              aria-hidden="true"
            />
          </div>
          <h3 className="text-lg font-bold text-ink-primary">
            {isNeutralCancel ? 'Cancelado por você.' : 'Falha ao desinstalar'}
          </h3>
          {!isNeutralCancel && <p className="text-sm text-ink-secondary">{errorMessage}</p>}
          {isKillFailure && (
            <div className="w-full rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-left text-[11px] leading-relaxed text-warn">
              ⚠ Não foi possível encerrar o processo{' '}
              <span className="font-mono">KLOUD_GAMES.exe</span> automaticamente (as duas tentativas
              de <span className="font-mono">taskkill</span> falharam). Por isso o MSI não foi
              iniciado — nada foi removido.
              <br />
              <span className="text-warn">
                Para resolver: pressione <span className="font-mono">Ctrl + Shift + Esc</span>, vá
                na aba <span className="font-mono">Detalhes</span>, localize{' '}
                <span className="font-mono">KLOUD_GAMES.exe</span>, clique em{' '}
                <span className="font-mono">Finalizar tarefa</span> e tente de novo.
              </span>
            </div>
          )}
          <div className="mt-1 flex justify-center gap-3">
            <Button variant={isNeutralCancel ? 'secondary' : 'danger'} onClick={handleRetry}>
              {isNeutralCancel ? (
                <ChevronRight size={14} aria-hidden="true" />
              ) : (
                <Trash2 size={14} aria-hidden="true" />
              )}
              Tentar novamente
            </Button>
            <Button variant="ghost" onClick={handleOpenLogs} title="Abrir pasta de logs">
              <FolderOpen size={14} aria-hidden="true" /> Abrir pasta de logs
            </Button>
            <Button variant="secondary" onClick={() => onClose()}>
              Fechar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
