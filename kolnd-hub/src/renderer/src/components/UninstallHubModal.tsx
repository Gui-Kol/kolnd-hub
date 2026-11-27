// Modal de confirmação e acompanhamento da desinstalação do Kolnd Hub.
//
// Fases: 'confirm' → 'running' → (o app encerra sozinho, via NSIS) | 'choice'.
// Toda a sequência pesada roda no main via window.api.uninstallHub — este
// componente não duplica lógica de detecção/instalação.
//
// O renderer aprende o desfecho pelos eventos `uninstall:*` (o main emite
// `uninstall:complete` com { paused, kloudError, stage } quando o Kloud Games
// falha e com { error } quando não dá para prosseguir sem desinstalar o Hub).
//
// Primário Modal (13.6) como CASCA: em 'running' o modal é infechável (Esc,
// backdrop e o X ficam desligados via disableClose — como antes); fora de
// 'running', Esc/backdrop/X fecham (como antes). O foco preso é o do primitivo
// Modal (mesmo padrão dos demais modais reformulados). `data-autofocus` marca
// o foco seguro (Cancelar) como antes.
//
// Em desenvolvimento (ou no app empacotado sem desinstalador NSIS), todo o
// formulário fica desabilitado com aviso.
//
// Reformulação visual 2.0 (13.13): interiores tokenizados, STEP_LABELS como
// stepper/índice discreto (apenas apresentação — nenhum passo novo/alterado),
// CTAs danger somente no último passo. Passos, ordem, textos, bloqueios e
// confirmações: IDÊNTICOS.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Check,
  ChevronRight,
  FolderOpen,
  Gamepad2,
  Monitor,
  Trash2,
  Zap
} from 'lucide-react'
import { buildSkipKloudHubArgs } from '../lib/uninstall'
import { Badge, Button, Input, Modal } from './ui'

type Phase = 'confirm' | 'running' | 'choice'

interface HubUninstallArgsState {
  wipeUserData: boolean
  skipKloud: boolean
  backupPath: string | null
}

interface UninstallHubModalProps {
  open: boolean
  onClose: () => void
  /** Sinaliza ao pai que a seção deve ficar desativada (running e choice). */
  onRunningChange?: (running: boolean) => void
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

const STEP_LABELS: Record<string, string> = {
  kloud: 'Desinstalando o Kloud Games…',
  backup: 'Verificando o backup dos seus dados…',
  spawn: 'Iniciando o desinstalador do Kolnd Hub…',
  wipe: 'Apagando seus dados em %APPDATA%\\kolnd-hub…',
  done: 'Concluído'
}

const HUB_STEP_IDS = new Set(Object.keys(STEP_LABELS))
const STEP_ORDER = Object.keys(STEP_LABELS)

export function UninstallHubModal({
  open,
  onClose,
  onRunningChange,
  onToast
}: UninstallHubModalProps): JSX.Element | null {
  const showToast = useCallback(
    (msg: string, kind: 'success' | 'error' | 'info' = 'info'): void => {
      onToast?.(msg, kind)
    },
    [onToast]
  )

  const [phase, setPhase] = useState<Phase>('confirm')
  const [confirmCode, setConfirmCode] = useState('')
  const [wipe, setWipe] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stepLabel, setStepLabel] = useState('')
  // Índice do stepper — puro espelhamento visual de data.stepId (nenhuma
  // decisão de fluxo depende dele).
  const [currentStepId, setCurrentStepId] = useState<string | null>(null)
  const [seenSteps, setSeenSteps] = useState<string[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  // Itens do %APPDATA% que NÃO puderam ser apagados no wipe (travados) — o
  // restante seguiu; o log lista tudo. Exibido na volta para a fase confirm.
  const [wipeErrors, setWipeErrors] = useState<string[]>([])
  const [kloudError, setKloudError] = useState<string | null>(null)
  const [backupState, setBackupState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [backupPath, setBackupPath] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [hubStatus, setHubStatus] = useState<{ available: boolean; isPackaged: boolean } | null>(
    null
  )
  const [hubStatusLoading, setHubStatusLoading] = useState(true)
  const unsubRef = useRef<(() => void)[]>([])
  // Guarda síncrona contra clique duplo no mesmo frame (além da guarda de
  // fase e do isBusy/isHubUninstallInProgress no main).
  const clickingRef = useRef(false)
  const argsRef = useRef<HubUninstallArgsState>({
    wipeUserData: false,
    skipKloud: false,
    backupPath: null
  })

  useEffect(() => {
    return (): void => {
      unsubRef.current.forEach((unsub) => unsub())
      unsubRef.current = []
    }
  }, [])

  // Carrega o portão do app (dev/prod e desinstalador) ao abrir.
  useEffect(() => {
    if (!open) return
    let mounted = true
    window.api
      .getHubUninstallStatus()
      .then((res) => {
        if (!mounted) return
        setHubStatus({ available: res.available, isPackaged: res.isPackaged })
        setHubStatusLoading(false)
      })
      .catch(() => {
        if (!mounted) return
        setHubStatus({ available: false, isPackaged: false })
        setHubStatusLoading(false)
      })
    return (): void => {
      mounted = false
    }
  }, [open])

  // Enquanto running ou choice, a seção pai fica sem interação.
  useEffect(() => {
    onRunningChange?.(phase === 'running' || phase === 'choice')
  }, [phase, onRunningChange])

  // Fase running: inscreve nos eventos e dispara o fluxo. Todo setState
  // acontece dentro de callbacks de evento / promise, nunca síncrono no corpo.
  useEffect(() => {
    if (phase !== 'running') return

    const unsubProgress = window.api.onUninstallProgress((data) => {
      if (!HUB_STEP_IDS.has(data.stepId)) return // ignora steps crus do subfluxo do Kloud Games
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
      if (res.paused) {
        setKloudError(res.kloudError ?? res.error ?? 'motivo desconhecido')
        setPhase('choice')
        return
      }
      if (!res.success) {
        const message = res.error ?? 'Não foi possível desinstalar o Kolnd Hub.'
        setErrorBanner(message)
        setWipeErrors(res.wipeErrors ?? [])
        showToast(`Falha ao desinstalar o Kolnd Hub: ${message}`, 'error')
        setPhase('confirm')
        return
      }
      // success: o app encerra sozinho para o NSIS assumir — sem tela pós-spawn.
    })

    unsubRef.current = [unsubProgress, unsubLog, unsubComplete]

    void window.api
      .uninstallHub(argsRef.current)
      .then((res) => {
        // O evento uninstall:complete já tratou o desfecho; isto é só um
        // cinto de segurança para rejeições/falhas sem evento.
        if (!res.success && !res.paused && res.error) {
          setErrorBanner(res.error)
          setWipeErrors(res.wipeErrors ?? [])
          setPhase('confirm')
        }
      })
      .catch((err: unknown) => {
        setErrorBanner(
          err instanceof Error
            ? err.message
            : 'Falha inesperada ao iniciar a desinstalação do Kolnd Hub.'
        )
        setPhase('confirm')
      })

    return (): void => {
      unsubProgress()
      unsubLog()
      unsubComplete()
    }
  }, [phase, showToast])

  // Em 'running' o modal é infechável (Esc, backdrop e o X ficam desligados
  // no primitivo Modal); em 'confirm' e 'choice', Esc/backdrop/X fecham.
  const handleBackdropClick = useCallback((): void => {
    onClose()
  }, [onClose])

  const resetRunState = (): void => {
    setProgress(0)
    setStepLabel('')
    setCurrentStepId(null)
    setSeenSteps([])
    setLogs([])
    setErrorBanner(null)
    setWipeErrors([])
  }

  const handleConfirm = (): void => {
    if (clickingRef.current || phase !== 'confirm') return // clique duplo não dispara duas vezes
    clickingRef.current = true
    argsRef.current = { wipeUserData: wipe, skipKloud: false, backupPath }
    resetRunState()
    setPhase('running')
  }

  const handleHubOnly = (): void => {
    if (clickingRef.current || phase !== 'choice') return // clique duplo não dispara duas vezes
    clickingRef.current = true
    // Preserva a escolha de dados e o backup feitos na confirmação.
    argsRef.current = buildSkipKloudHubArgs(wipe, backupPath)
    resetRunState()
    setPhase('running')
  }

  const handleBackup = async (): Promise<void> => {
    setBackupState('busy')
    setBackupError(null)
    try {
      const res = await window.api.backupHubData()
      if (res.success) {
        setBackupPath(res.path)
        setBackupState('done')
      } else {
        setBackupError(res.error ?? 'Não foi possível fazer o backup dos dados.')
        setBackupState('error')
      }
    } catch (err) {
      setBackupError(
        err instanceof Error ? err.message : 'Não foi possível fazer o backup dos dados.'
      )
      setBackupState('error')
    }
  }

  const handleOpenBackupFolder = async (): Promise<void> => {
    if (!backupPath) return
    try {
      await window.api.openPath(backupPath)
    } catch {
      // Melhor esforço — o caminho continua visível como texto.
    }
  }

  // O modal inteiro fica bloqueado em dev ou quando o desinstalador não existe.
  const isPackaged = hubStatus?.isPackaged === true
  const available = hubStatus?.available === true
  const gateBlocked = hubStatusLoading || !isPackaged || !available
  const canConfirm = !gateBlocked && confirmCode.trim().toLowerCase() === 'kolnd hub'

  if (!open) return null

  const gateMessage = hubStatusLoading
    ? 'Carregando status do desinstalador…'
    : !isPackaged
      ? 'Disponível apenas no app instalado — a desinstalação do Kolnd Hub só funciona no app empacotado.'
      : 'Desinstalador não encontrado — desinstale pelo aplicativo Configurações do Windows → Aplicativos → Kolnd Hub.'

  return (
    <Modal
      disableClose={phase === 'running'}
      ariaLabel="Desinstalar o Kolnd Hub?"
      onClose={handleBackdropClick}
      closeLabel="Fechar"
    >
      {/* ── confirm ── */}
      {phase === 'confirm' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-danger-border bg-danger-bg">
            <Zap size={32} className="text-danger" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-bold text-ink-primary">Desinstalar o Kolnd Hub?</h3>
          <p className="text-xs leading-relaxed text-ink-secondary">
            Esta é a sequência que vai acontecer, nesta ordem:
          </p>

          <ol className="w-full space-y-2 text-left text-xs text-ink-secondary">
            <li className="flex gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border border-danger-border font-mono text-[9px] text-danger">
                1
              </span>
              <span>
                <Gamepad2 size={12} className="mr-1 inline text-ink-tertiary" aria-hidden="true" />
                <strong className="text-ink-primary">Kloud Games</strong> será desinstalado primeiro
                (se estiver instalado) — suas{' '}
                <span className="text-ink-primary">
                  Streams Moonlight ativas serão interrompidas
                </span>
                . Se algo falhar, você decide se desinstala só o Hub.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border border-danger-border font-mono text-[9px] text-danger">
                2
              </span>
              <span>
                <Monitor size={12} className="mr-1 inline text-ink-tertiary" aria-hidden="true" />
                <strong className="text-ink-primary">O que o Windows apaga</strong>: a pasta de
                instalação (<span className="font-mono">%LOCALAPPDATA%\Programs\Kolnd Hub</span>),
                os atalhos e a entrada em Aplicativos — pelo desinstalador do Kolnd Hub (NSIS,
                per-user — não exige administrador).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-pill border border-danger-border font-mono text-[9px] text-danger">
                3
              </span>
              <span>
                <Trash2 size={12} className="mr-1 inline text-ink-tertiary" aria-hidden="true" />
                <strong className="text-ink-primary">O que o Hub apaga</strong> (só se você escolher
                apagar): <span className="font-mono">config.json</span>,{' '}
                <span className="font-mono">first-run-complete.flag</span>,{' '}
                <span className="font-mono">logs\</span> e{' '}
                <span className="font-mono">game-icons\</span> — em{' '}
                <span className="font-mono">%APPDATA%\kolnd-hub</span>.
              </span>
            </li>
          </ol>

          <p className="w-full text-left text-[11px] leading-relaxed text-ink-tertiary">
            O Mark LVII (assistente) será removido junto com a pasta do Kolnd Hub — inclusive a
            chave de API e a memória, que ficam em{' '}
            <span className="font-mono">resources\programs\MarkLVII</span> dentro da instalação.
            Faça o backup abaixo se quiser guardá-las. O Absolem também é removido com a pasta do
            Hub (<span className="font-mono">resources\programs\Absolem</span>), mas os dados dele
            em <span className="font-mono">%APPDATA%\absolem</span> são preservados.
          </p>

          {gateBlocked && (
            <div className="w-full rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-warn">
              ⚠ {gateMessage}
            </div>
          )}
          {errorBanner && (
            <div
              role="alert"
              className="w-full rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-left text-[11px] leading-relaxed text-danger"
            >
              ⚠ {errorBanner}
              <br />
              {wipeErrors.length > 0
                ? 'Nada do que já foi apagado será restaurado — o wipe é irreversível por sua escolha.'
                : 'Seus dados e configurações não foram apagados.'}{' '}
              Se quiser sair de qualquer forma, feche esta janela e desinstale o Kolnd Hub pelo
              aplicativo Configurações do Windows → Aplicativos → Kolnd Hub.
            </div>
          )}
          {wipeErrors.length > 0 && (
            <div className="w-full rounded-control border border-warn-border bg-warn-bg px-3 py-2 text-left">
              <p className="text-[11px] leading-relaxed text-warn">
                ⚠ {wipeErrors.length}{' '}
                {wipeErrors.length === 1 ? 'item não pôde' : 'itens não puderam'} ser apagados
                (travados por outro programa/antivírus) — o restante foi removido normalmente.
                Detalhes:
              </p>
              <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[10px] text-warn">
                {wipeErrors.map((item) => (
                  <li key={item} className="break-all">
                    • {item}
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => void window.api.openHubLogsFolder()}
                title="Abrir pasta de logs"
              >
                <FolderOpen size={12} aria-hidden="true" /> Abrir pasta de logs
              </Button>
            </div>
          )}

          <fieldset disabled={gateBlocked} className="w-full space-y-4">
            {/* ── Opções de dados (radio exclusivo) ── */}
            <div className="space-y-2 text-left">
              <label
                aria-labelledby="hub-data-keep-text"
                className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2 transition-colors ${
                  !wipe
                    ? 'border-success-border bg-success-bg'
                    : 'border-[var(--border-subtle)] bg-surface-2 hover:border-[var(--border-strong)]'
                }`}
              >
                <input
                  type="radio"
                  name="hub-data"
                  className="mt-1 accent-success"
                  checked={!wipe}
                  onChange={() => setWipe(false)}
                />
                <span id="hub-data-keep-text">
                  <span className="text-xs font-semibold text-ink-primary">
                    Manter meus dados e configurações{' '}
                    <Badge tone="success" className="ml-1 align-middle">
                      recomendado
                    </Badge>
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-secondary">
                    %APPDATA%\kolnd-hub fica intacto (config, logs, biblioteca e ícones).
                  </span>
                </span>
              </label>
              <label
                aria-labelledby="hub-data-wipe-text"
                className={`flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2 transition-colors ${
                  wipe
                    ? 'border-danger-border bg-danger-bg'
                    : 'border-[var(--border-subtle)] bg-surface-2 hover:border-[var(--border-strong)]'
                }`}
              >
                <input
                  type="radio"
                  name="hub-data"
                  className="mt-1 accent-danger"
                  checked={wipe}
                  onChange={() => setWipe(true)}
                />
                <span id="hub-data-wipe-text">
                  <span className="text-xs font-semibold text-ink-primary">
                    Apagar também meus dados e configurações{' '}
                    <span className="text-danger">(irreversível)</span>
                  </span>
                </span>
              </label>
              {wipe && (
                <ul className="list-inside list-disc space-y-1 rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-[11px] text-danger">
                  <li>config.json e first-run-complete.flag (suas preferências)</li>
                  <li>logs\ (histórico de registros)</li>
                  <li>game-icons\ (cache de ícones da Biblioteca)</li>
                </ul>
              )}
            </div>

            {/* ── Backup voluntário ── */}
            {backupState === 'done' && backupPath ? (
              <div className="w-full rounded-control border border-success-border bg-success-bg px-3 py-2 text-left">
                <p className="text-[11px] text-success">✓ Backup salvo em:</p>
                <p className="mt-1 break-all font-mono text-[10px] text-success">{backupPath}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={handleOpenBackupFolder}
                  title="Abrir a pasta do backup"
                >
                  <FolderOpen size={14} aria-hidden="true" /> Abrir pasta
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBackup}
                  disabled={backupState === 'busy'}
                  title="Copia %APPDATA%\kolnd-hub para Documentos antes de desinstalar"
                >
                  <Archive size={14} aria-hidden="true" />{' '}
                  {backupState === 'busy' ? 'Fazendo backup…' : 'Fazer backup dos meus dados'}
                </Button>
                {backupState === 'error' && backupError && (
                  <p className="text-[11px] text-danger">⚠ {backupError}</p>
                )}
              </div>
            )}

            <div className="mt-1">
              <label
                htmlFor="uninstall-hub-confirm"
                className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-ink-tertiary"
              >
                Digite <span className="font-mono text-danger">Kolnd Hub</span> para confirmar
              </label>
              <Input
                id="uninstall-hub-confirm"
                type="text"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                className="text-center font-mono"
                placeholder="Kolnd Hub"
              />
              <p className="mt-1 text-[10px] text-ink-tertiary">
                Não diferencia maiúsculas/minúsculas.
              </p>
            </div>
          </fieldset>

          <div className="mt-2 flex justify-center gap-3">
            <Button variant="secondary" data-autofocus onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={!canConfirm} onClick={handleConfirm}>
              <Trash2 size={14} aria-hidden="true" /> Desinstalar Kolnd Hub
            </Button>
          </div>
        </div>
      )}

      {/* ── running ── */}
      {phase === 'running' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-danger-border bg-danger-bg">
            <Zap size={32} className="animate-pulse text-danger" aria-hidden="true" />
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

      {/* ── choice — Kloud Games falhou; só o Hub? ── */}
      {phase === 'choice' && (
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-card border border-warn-border bg-warn-bg">
            <AlertCircle size={32} className="text-warn" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-bold text-ink-primary">
            Não foi possível desinstalar o Kloud Games
          </h3>
          <p className="text-sm leading-relaxed text-ink-secondary">
            Não foi possível desinstalar o Kloud Games (motivo:{' '}
            <span className="text-warn">{kloudError ?? 'desconhecido'}</span>). Deseja desinstalar
            apenas o Kolnd Hub mesmo assim?
          </p>
          <p className="text-[11px] text-ink-tertiary">
            Sua escolha de dados ({wipe ? 'apagar tudo' : 'manter meus dados'}
            {backupPath ? ', backup feito' : ''}) será mantida.
          </p>
          <div className="mt-2 flex w-full flex-col items-center gap-3">
            <Button variant="danger" className="w-full" onClick={handleHubOnly}>
              <Trash2 size={14} aria-hidden="true" /> Desinstalar só o Hub
            </Button>
            <Button variant="secondary" className="w-full" data-autofocus onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
