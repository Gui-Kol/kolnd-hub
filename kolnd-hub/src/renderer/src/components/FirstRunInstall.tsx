import { useEffect, useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, fadeOnlyTransition, useReducedMotion } from '../lib/motion'
import { Button } from './ui'
import {
  Zap,
  Loader2,
  Check,
  X,
  Download,
  Shield,
  Settings,
  Gamepad2,
  type LucideIcon
} from 'lucide-react'

type FirstRunStep = {
  id: string
  label: string
  icon: LucideIcon
  status: 'pending' | 'running' | 'done' | 'error'
  progress: number
}

const INITIAL_STEPS: FirstRunStep[] = [
  {
    id: 'check',
    label: 'Verificando dependências do sistema…',
    icon: Shield,
    status: 'pending',
    progress: 0
  },
  {
    id: 'python',
    label: 'Instalando Python 3.x e pip…',
    icon: Download,
    status: 'pending',
    progress: 0
  },
  {
    id: 'kloud-games',
    label: 'Instalando Kloud Games…',
    icon: Gamepad2,
    status: 'pending',
    progress: 0
  },
  {
    id: 'programs',
    label: 'Configurando programas do ecossistema…',
    icon: Settings,
    status: 'pending',
    progress: 0
  },
  {
    id: 'finalize',
    label: 'Finalizando instalação…',
    icon: Zap,
    status: 'pending',
    progress: 0
  }
]

interface FirstRunInstallProps {
  onComplete: () => void
}

export function FirstRunInstall({ onComplete }: FirstRunInstallProps): JSX.Element {
  // Entradas decorativas (card, rodapé) viram fade curto com reduce.
  const reduced = useReducedMotion()
  const [steps, setSteps] = useState<FirstRunStep[]>(INITIAL_STEPS.map((s) => ({ ...s })))
  const [logs, setLogs] = useState<string[]>(['[KolndHub] Iniciando instalação automática…\n'])
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const appendLog = useCallback((line: string): void => {
    setLogs((prev) => [...prev, line])
  }, [])

  const updateStep = useCallback(
    (stepId: string, status: FirstRunStep['status'], progress: number): void => {
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status, progress } : s)))
    },
    []
  )

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    let mounted = true

    // Listeners IPC
    const unsubscribeProgress = window.api.onFirstRunProgress((data) => {
      if (!mounted) return
      updateStep(data.stepId, data.status as FirstRunStep['status'], data.progress)
      if (data.message) {
        appendLog(`[${data.stepId}] ${data.message}\n`)
      }
    })

    const unsubscribeLog = window.api.onFirstRunLog((line) => {
      if (!mounted) return
      appendLog(line)
    })

    const unsubscribeComplete = window.api.onFirstRunComplete((result) => {
      if (!mounted) return
      setCompleted(true)
      if (result.success) {
        appendLog('\n[KolndHub] Instalação concluída com sucesso!\n')
        window.api.firstRunMarkComplete().catch(() => undefined)
        setTimeout(() => onComplete(), 1200)
      } else {
        setError(result.error ?? 'Erro desconhecido durante a instalação.')
        appendLog(`\n[KolndHub] Instalação falhou: ${result.error ?? 'erro desconhecido'}\n`)
      }
    })

    // Inicia a instalação no processo principal
    window.api.firstRunStart().catch((err: Error) => {
      if (mounted) {
        setError(err.message)
        appendLog(`[KolndHub] Erro ao iniciar instalação: ${err.message}\n`)
      }
    })

    return (): void => {
      mounted = false
      unsubscribeProgress()
      unsubscribeLog()
      unsubscribeComplete()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCancel = useCallback(() => {
    window.api.firstRunCancel().catch(() => undefined)
  }, [])

  const handleRetryKloudGames = useCallback(() => {
    window.api.firstRunRetryKloudGames().catch(() => undefined)
  }, [])

  const progress = Math.round(
    (steps.filter((s) => s.status === 'done').length / steps.length) * 100
  )
  const hasError = error !== null || steps.some((s) => s.status === 'error')

  return (
    <div className="fixed inset-0 z-modal bg-surface-base flex flex-col items-center justify-center overflow-hidden">
      {/* ── Conteúdo central ─────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { scale: 0.95 }, { duration: 0.4 })}
        className="bg-surface-1 rounded-card p-6 md:p-10 w-full max-w-2xl border border-[var(--border-subtle)] shadow-elevation-3 relative mx-4"
      >
        {/* Logo e título */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-card bg-accent flex items-center justify-center">
            <Zap size={24} className="text-accent-contrast" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-ink-primary tracking-tight">Kolnd Hub</h2>
            <p className="text-[10px] text-ink-tertiary uppercase tracking-widest mt-0.5">
              Primeira execução
            </p>
          </div>
        </div>

        <p className="text-center text-sm text-ink-secondary mb-6">
          Estamos preparando tudo para que o Kolnd Hub funcione sem que você precise instalar nada
          manualmente.
        </p>

        {/* Barra de progresso */}
        <div className="w-full bg-surface-sunken rounded-pill h-2.5 mb-2 overflow-hidden border border-[var(--border-subtle)]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={reduced ? fadeOnlyTransition : { duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-accent rounded-pill"
          />
        </div>
        <div className="flex justify-between items-center mb-6">
          <span
            className={`text-[10px] uppercase tracking-wider ${
              hasError ? 'text-danger' : completed ? 'text-success' : 'text-ink-tertiary'
            }`}
          >
            {hasError
              ? 'Erro na instalação'
              : completed
                ? 'Instalação concluída'
                : 'Instalando dependências…'}
          </span>
          <span className="text-[10px] font-bold text-ink-tertiary tracking-wider tabular-nums">
            {progress}%
          </span>
        </div>

        {/* Lista de etapas */}
        <div className="space-y-2 mb-6">
          {steps.map((step) => {
            const StepIcon = step.icon
            const isDone = step.status === 'done'
            const isActive = step.status === 'running'
            const isError = step.status === 'error'
            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-control border transition-colors duration-300 ${
                  isActive
                    ? 'bg-accent-muted border-accent-border'
                    : isDone
                      ? 'bg-success-bg border-success-border'
                      : isError
                        ? 'bg-danger-bg border-danger-border'
                        : 'bg-transparent border-transparent'
                }`}
              >
                {isDone ? (
                  <Check size={16} className="text-success shrink-0" />
                ) : isActive ? (
                  <Loader2 size={16} className="text-accent shrink-0 animate-spin" />
                ) : isError ? (
                  <X size={16} className="text-danger shrink-0" />
                ) : (
                  <StepIcon size={16} className="text-ink-tertiary shrink-0" />
                )}
                <span
                  className={`text-xs font-medium leading-tight ${
                    isDone
                      ? 'text-success'
                      : isActive
                        ? 'text-ink-primary'
                        : isError
                          ? 'text-danger'
                          : 'text-ink-tertiary'
                  }`}
                >
                  {step.label}
                  {isActive && step.progress > 0 && (
                    <span className="ml-2 text-[10px] text-ink-tertiary tabular-nums">
                      ({step.progress}%)
                    </span>
                  )}
                </span>
                {step.id === 'kloud-games' && isError && (
                  <Button
                    variant="subtle-danger"
                    size="sm"
                    onClick={handleRetryKloudGames}
                    className="ml-auto shrink-0"
                  >
                    Tentar novamente
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {/* Log em tempo real */}
        <div
          ref={logRef}
          className="bg-surface-sunken rounded-control p-4 h-32 overflow-y-auto font-mono text-[11px] leading-relaxed text-ink-secondary border border-[var(--border-subtle)]"
        >
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {line}
            </div>
          ))}
          {hasError && (
            <div className="text-danger mt-2">
              Algo deu errado durante a instalação. Verifique sua conexão e tente novamente.
            </div>
          )}
        </div>

        {/* Botão de cancelar */}
        <div className="flex justify-end mt-4 gap-3">
          <Button variant="secondary" onClick={handleCancel} disabled={completed || !hasError}>
            {hasError ? 'Tentar novamente mais tarde' : 'Cancelar'}
          </Button>
        </div>
      </motion.div>

      {/* Rodapé */}
      <motion.div
        {...entranceProps(reduced, {}, { delay: 0.8 })}
        className="absolute bottom-6 text-[10px] text-ink-tertiary uppercase tracking-widest font-bold"
      >
        Kolnd Hub • Instalação automática
      </motion.div>
    </div>
  )
}
