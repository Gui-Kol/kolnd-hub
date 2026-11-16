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
// role="alertdialog" + aria-labelledby, ciclo de Tab preso, Esc fecha apenas
// em confirm/choice, clique no backdrop não fecha durante a execução, e o
// "Abrir pasta" do backup usa window.api.openPath.
//
// Em desenvolvimento (ou no app empacotado sem desinstalador NSIS), todo o
// formulário fica desabilitado com aviso.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Archive, ChevronRight, FolderOpen, Trash2, Zap } from 'lucide-react'
import { buildSkipKloudHubArgs } from '../lib/uninstall'
import { useFocusTrap } from '../lib/useFocusTrap'

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
  wipe: 'Apagando seus dados em %APPDATA%\\kolnd-hub…',
  spawn: 'Iniciando o desinstalador do Kolnd Hub…',
  done: 'Concluído'
}

const HUB_STEP_IDS = new Set(Object.keys(STEP_LABELS))

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
  const [logs, setLogs] = useState<string[]>([])
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  // Itens do %APPDATA% que NÃO puderam ser apagados no wipe (travados) — o
  // restante seguiu; o log lista tudo. Exibido na volta para a fase confirm
  // (ex.: desinstalador NSIS falhou após o wipe).
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

  // Esc fecha só fora da execução; durante 'running' o modal é infechável.
  const handleEscape = useCallback((): void => {
    if (phase === 'confirm' || phase === 'choice') onClose()
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

  const resetRunState = (): void => {
    setProgress(0)
    setStepLabel('')
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
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto py-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="uninstall-hub-modal-title"
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
        className="relative w-full max-w-md space-y-4 rounded-3xl border border-white/[0.08] bg-[#0d0d14]/95 p-6 text-center shadow-2xl shadow-black/60 my-auto"
      >
        {/* ── confirm ── */}
        {phase === 'confirm' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <Zap size={30} className="text-red-400" />
            </div>
            <h3 id="uninstall-hub-modal-title" className="text-lg font-bold text-white">
              Desinstalar o Kolnd Hub?
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Esta é a sequência que vai acontecer, nesta ordem:
            </p>

            <ol className="text-left text-xs text-slate-400 space-y-2">
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-red-400">1.</span>
                <span>
                  <strong className="text-slate-200">Kloud Games</strong> será desinstalado primeiro
                  (se estiver instalado) — suas{' '}
                  <span className="text-slate-200">
                    Streams Moonlight ativas serão interrompidas
                  </span>
                  . Se algo falhar, você decide se desinstala só o Hub.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-red-400">2.</span>
                <span>
                  <strong className="text-slate-200">O que o Hub apaga</strong> (só se você escolher
                  apagar): <span className="font-mono">config.json</span>,{' '}
                  <span className="font-mono">first-run-complete.flag</span>,{' '}
                  <span className="font-mono">logs\</span>,{' '}
                  <span className="font-mono">mark-lvi\</span> e{' '}
                  <span className="font-mono">game-icons\</span> — em{' '}
                  <span className="font-mono">%APPDATA%\kolnd-hub</span>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-red-400">3.</span>
                <span>
                  <strong className="text-slate-200">O que o Windows apaga</strong>: a pasta de
                  instalação (<span className="font-mono">%LOCALAPPDATA%\Programs\Kolnd Hub</span>),
                  os atalhos e a entrada em Aplicativos — pelo desinstalador do Kolnd Hub (NSIS,
                  per-user — não exige administrador).
                </span>
              </li>
            </ol>

            <p className="text-[11px] text-slate-500 leading-relaxed text-left">
              O Mark LVI (assistente) será removido junto com a pasta do Kolnd Hub. Seus dados
              atuais ficam em <span className="font-mono">%APPDATA%\kolnd-hub\mark-lvi</span> e
              seguem a regra acima.
            </p>

            {gateBlocked && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                ⚠ {gateMessage}
              </div>
            )}
            {errorBanner && (
              <div
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300 text-left"
              >
                ⚠ {errorBanner}
                <br />
                Nada do que já foi apagado será restaurado — o wipe é irreversível por sua escolha.
                Se quiser sair de qualquer forma, feche esta janela e desinstale o Kolnd Hub pelo
                aplicativo Configurações do Windows → Aplicativos → Kolnd Hub.
              </div>
            )}
            {wipeErrors.length > 0 && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left">
                <p className="text-[11px] text-amber-300 leading-relaxed">
                  ⚠ {wipeErrors.length}{' '}
                  {wipeErrors.length === 1 ? 'item não pôde' : 'itens não puderam'} ser apagados
                  (travados por outro programa/antivírus) — o restante foi removido normalmente.
                  Detalhes:
                </p>
                <ul className="mt-1 max-h-24 overflow-y-auto text-[10px] font-mono text-amber-200/80 space-y-0.5">
                  {wipeErrors.map((item) => (
                    <li key={item} className="break-all">
                      • {item}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn-ghost text-xs mt-2"
                  onClick={() => void window.api.openHubLogsFolder()}
                  title="Abrir pasta de logs"
                >
                  <FolderOpen size={12} /> Abrir pasta de logs
                </button>
              </div>
            )}

            <fieldset disabled={gateBlocked} className="space-y-4">
              {/* ── Opções de dados (radio exclusivo) ── */}
              <div className="space-y-2 text-left">
                <label
                  aria-labelledby="hub-data-keep-text"
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                    !wipe
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                  }`}
                >
                  <input
                    type="radio"
                    name="hub-data"
                    className="mt-1 accent-emerald-500"
                    checked={!wipe}
                    onChange={() => setWipe(false)}
                  />
                  <span id="hub-data-keep-text">
                    <span className="text-xs font-semibold text-slate-100">
                      Manter meus dados e configurações{' '}
                      <span className="badge bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 ml-1">
                        recomendado
                      </span>
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-1">
                      %APPDATA%\kolnd-hub fica intacto (config, logs, Mark LVI, biblioteca e
                      ícones).
                    </span>
                  </span>
                </label>
                <label
                  aria-labelledby="hub-data-wipe-text"
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                    wipe
                      ? 'border-red-500/40 bg-red-500/10'
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                  }`}
                >
                  <input
                    type="radio"
                    name="hub-data"
                    className="mt-1 accent-red-500"
                    checked={wipe}
                    onChange={() => setWipe(true)}
                  />
                  <span id="hub-data-wipe-text">
                    <span className="text-xs font-semibold text-slate-100">
                      Apagar também meus dados e configurações{' '}
                      <span className="text-red-400">(irreversível)</span>
                    </span>
                  </span>
                </label>
                {wipe && (
                  <ul className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-200/80 space-y-1 list-disc list-inside">
                    <li>config.json e first-run-complete.flag (suas preferências)</li>
                    <li>logs\ (histórico de registros)</li>
                    <li>mark-lvi\ (dados do assistente: chave de API e memória)</li>
                    <li>game-icons\ (cache de ícones da Biblioteca)</li>
                  </ul>
                )}
              </div>

              {/* ── Backup voluntário ── */}
              {backupState === 'done' && backupPath ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-left">
                  <p className="text-[11px] text-emerald-300">✓ Backup salvo em:</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-emerald-200/80">
                    {backupPath}
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenBackupFolder}
                    className="btn-ghost mt-2 text-xs"
                    title="Abrir a pasta do backup"
                  >
                    <FolderOpen size={14} /> Abrir pasta
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={handleBackup}
                    disabled={backupState === 'busy'}
                    className="btn-ghost text-xs"
                    title="Copia %APPDATA%\kolnd-hub para Documentos antes de desinstalar"
                  >
                    <Archive size={14} />{' '}
                    {backupState === 'busy' ? 'Fazendo backup…' : 'Fazer backup dos meus dados'}
                  </button>
                  {backupState === 'error' && backupError && (
                    <p className="text-[11px] text-red-300">⚠ {backupError}</p>
                  )}
                </div>
              )}

              <div className="mt-1">
                <label
                  htmlFor="uninstall-hub-confirm"
                  className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2"
                >
                  Digite <span className="text-red-400 font-mono">Kolnd Hub</span> para confirmar
                </label>
                <input
                  id="uninstall-hub-confirm"
                  type="text"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  className="input-gamer text-center"
                  placeholder="Kolnd Hub"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Não diferencia maiúsculas/minúsculas.
                </p>
              </div>
            </fieldset>

            <div className="mt-2 flex justify-center gap-3">
              <button type="button" className="btn-secondary" data-autofocus onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={!canConfirm}
                onClick={handleConfirm}
              >
                <Trash2 size={14} /> Desinstalar Kolnd Hub
              </button>
            </div>
          </>
        )}

        {/* ── running ── */}
        {phase === 'running' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <Zap size={30} className="text-red-400 animate-pulse" />
            </div>
            <h3 id="uninstall-hub-modal-title" className="text-lg font-bold text-white">
              Desinstalação em andamento
            </h3>
            <p className="text-sm text-slate-400 mt-1" role="status" aria-live="polite">
              {stepLabel || 'Iniciando…'}
            </p>
            <div className="mt-4">
              <div className="flex justify-between mb-1 text-[10px]">
                <span className="text-slate-500">{stepLabel || 'Etapa atual'}</span>
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
                    <span className="text-slate-500">Aguardando log…</span>
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

        {/* ── choice — Kloud Games falhou; só o Hub? ── */}
        {phase === 'choice' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10">
              <AlertCircle size={30} className="text-amber-400" />
            </div>
            <h3 id="uninstall-hub-modal-title" className="text-lg font-bold text-white">
              Não foi possível desinstalar o Kloud Games
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Não foi possível desinstalar o Kloud Games (motivo:{' '}
              <span className="text-amber-300">{kloudError ?? 'desconhecido'}</span>). Deseja
              desinstalar apenas o Kolnd Hub mesmo assim?
            </p>
            <p className="text-[11px] text-slate-500">
              Sua escolha de dados ({wipe ? 'apagar tudo' : 'manter meus dados'}
              {backupPath ? ', backup feito' : ''}) será mantida.
            </p>
            <div className="mt-2 flex flex-col items-center gap-3">
              <button
                type="button"
                className="btn-danger w-full justify-center"
                onClick={handleHubOnly}
              >
                <Trash2 size={14} /> Desinstalar só o Hub
              </button>
              <button
                type="button"
                className="btn-secondary w-full justify-center"
                data-autofocus
                onClick={onClose}
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
