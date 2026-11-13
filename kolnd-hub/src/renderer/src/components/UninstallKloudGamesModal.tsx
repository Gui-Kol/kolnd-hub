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
import { AlertCircle, Check, ChevronRight, FolderOpen, Trash2, X } from 'lucide-react'

type Phase = 'confirm' | 'running' | 'done' | 'error'

interface UninstallKloudGamesModalProps {
  open: boolean
  /** O Kloud Games está em execução (exibe aviso no confirm). */
  isRunning?: boolean
  /** Instalação parcial detectada (exibe aviso no confirm). */
  isPartial?: boolean
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

export function UninstallKloudGamesModal({
  open,
  isRunning = false,
  isPartial = false,
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
  const [confirmCode, setConfirmCode] = useState('')
  const [progress, setProgress] = useState(0)
  const [stepLabel, setStepLabel] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [result, setResult] = useState<{
    success: boolean
    error?: string
    report?: unknown
  } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const unsubRef = useRef<(() => void)[]>([])

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
      setResult(res)
      setPhase(res.success ? 'done' : 'error')
    })

    unsubRef.current = [unsubProgress, unsubLog, unsubComplete]

    void window.api
      .uninstallKloudGames()
      .catch((err) => {
        setResult({
          success: false,
          error:
            err instanceof Error ? err.message : 'Falha inesperada ao iniciar a desinstalação.'
        })
        setPhase('error')
      })

    return (): void => {
      unsubProgress()
      unsubLog()
      unsubComplete()
    }
  }, [phase])

  // Toasts finais (mesmo padrão dos demais toasts do App, via onToast).
  useEffect(() => {
    if (!result) return
    if (phase === 'done') {
      const report = result.report as { remaining?: string[] } | undefined
      const remaining = report?.remaining ?? []
      if (remaining.length > 0) {
        showToast(
          'Kloud Games desinstalado parcialmente. Alguns itens permaneceram.',
          'success'
        )
      } else {
        showToast('Kloud Games desinstalado.', 'success')
      }
    } else if (phase === 'error') {
      showToast(
        `Falha ao desinstalar o Kloud Games: ${result.error ?? 'erro desconhecido'}`,
        'error'
      )
    }
  }, [phase, result, showToast])

  const canConfirm = confirmCode.trim().toUpperCase() === 'KLOUD_GAMES'

  const getFocusables = (): HTMLElement[] => {
    const panel = panelRef.current
    if (!panel) return []
    const nodes = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    return Array.from(nodes).filter(
      (n) => n.offsetParent !== null || n.tagName === 'INPUT'
    )
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (phase === 'confirm') {
          e.preventDefault()
          onClose()
        }
        // running: ignora Esc (modal não-fechável)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const focusables = getFocusables()
        if (!focusables.length) return
        const current = focusables.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey
          ? current <= 0
            ? focusables.length - 1
            : current - 1
          : current >= focusables.length - 1
            ? 0
            : current + 1
        focusables[next]?.focus()
      }
    },
    [phase, onClose]
  )

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
    setPhase('running')
  }

  const handleRetry = (): void => {
    setPhase('confirm')
    setConfirmCode('')
    setResult(null)
    setProgress(0)
    setStepLabel('')
    setLogs([])
  }

  const handleOpenLogs = async (): Promise<void> => {
    try {
      await window.api.openHubLogsFolder()
    } catch {
      // Ignorar
    }
  }

  const errorMessage = result?.error ?? 'Não foi possível desinstalar o Kloud Games.'
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
  const needsReboot = Boolean(result?.success && (result as { needsReboot?: boolean }).needsReboot)
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
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md space-y-4 rounded-3xl border border-white/[0.08] bg-[#0d0d14]/95 p-6 text-center shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── confirm ── */}
        {phase === 'confirm' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <AlertCircle size={30} className="text-red-400" />
            </div>
            <h3 id="uninstall-modal-title" className="text-lg font-bold text-white">
              Desinstalar o Kloud Games?
            </h3>
            <p className="text-sm text-slate-400">Serão removidos:</p>
            <ul className="text-left text-xs text-slate-400 space-y-1">
              <li>
                Programa e dados em C:\Program Files\KLOUD_GAMES — incluindo config\
              </li>
              <li>Serviço KLOUD_GAMESsvc</li>
              <li>Regras de firewall do Kloud Games</li>
              <li>Entrada do PATH do sistema</li>
              <li>Atalhos do Menu Iniciar</li>
            </ul>
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
            {isPartial && (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                ⚠ Instalação quebrada detectada: tentaremos limpar mesmo assim.
              </div>
            )}
            <div className="mt-5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                Digite <span className="text-red-400 font-mono">KLOUD_GAMES</span> para confirmar
              </label>
              <input
                type="text"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                className="input-gamer text-center"
                placeholder="KLOUD_GAMES"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Não diferencia maiúsculas/minúsculas.
              </p>
            </div>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" className="btn-secondary" autoFocus onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={!canConfirm}
                onClick={handleConfirm}
              >
                <Trash2 size={14} /> Desinstalar
              </button>
            </div>
          </>
        )}

        {/* ── running ── */}
        {phase === 'running' && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <AlertCircle size={30} className="text-red-400 animate-pulse" />
            </div>
            <h3 className="text-lg font-bold text-white">Desinstalação em andamento</h3>
            <p className="text-sm text-slate-400 mt-1">{stepLabel || 'Iniciando…'}</p>
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
                    logs.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))
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
                <h3 className="text-lg font-bold text-white">
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
                <p className="mt-3 text-[10px] text-slate-500">
                  Orientação: use o Painel de Controle → Aplicativos ou remova manualmente os itens
                  restantes.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold text-white">Kloud Games desinstalado</h3>
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
                {needsReboot && (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                    ⚠ Reinicie o PC para concluir a remoção de alguns arquivos.
                  </div>
                )}
              </>
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
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <AlertCircle size={30} className="text-red-400" />
            </div>
            <h3 className="text-lg font-bold text-white">Falha ao desinstalar</h3>
            <p className="text-sm text-slate-400 mt-1">{errorMessage}</p>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" className="btn-danger" onClick={handleRetry}>
                <Trash2 size={14} /> Tentar novamente
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
