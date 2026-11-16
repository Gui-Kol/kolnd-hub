import { useEffect, useState, useRef, useCallback } from 'react'
import React from 'react'
import { motion } from 'framer-motion'
import { entranceProps, fadeOnlyTransition, useReducedMotion } from '../lib/motion'
import {
  Zap,
  Loader2,
  CheckCircle,
  AlertCircle,
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
    <div className="fixed inset-0 z-[100] bg-[#050508] flex flex-col items-center justify-center overflow-hidden">
      {/* ── Fundo decorativo ─────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-kloud-500/10 rounded-full blur-[120px] animate-pulse" />
        <div
          className="absolute bottom-[-20%] right-[-20%] w-[50%] h-[50%] bg-nintendo-500/10 rounded-full blur-[120px] animate-pulse"
          style={{ animationDelay: '2s' }}
        />
        <div className="scanlines" />
      </div>

      {/* ── Conteúdo central ────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { scale: 0.95 }, { duration: 0.4 })}
        className="glass rounded-3xl p-6 md:p-10 w-full max-w-2xl border border-white/[0.1] shadow-2xl shadow-black/60 relative mx-4"
      >
        {/* Logo e título */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-kloud-500 to-nintendo-500 flex items-center justify-center shadow-glow-orange">
            <Zap size={22} className="text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight gradient-text gradient-kloud">
              Kolnd Hub
            </h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">
              Primeira execução
            </p>
          </div>
        </div>

        <p className="text-center text-sm text-slate-300 mb-6">
          Estamos preparando tudo para que o Kolnd Hub funcione sem que você precise instalar nada
          manualmente.
        </p>

        {/* Barra de progresso */}
        <div className="w-full bg-white/[0.05] rounded-full h-2.5 mb-2 overflow-hidden border border-white/[0.08]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={reduced ? fadeOnlyTransition : { duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-kloud-500 to-nintendo-500 rounded-full shadow-glow-orange"
          />
        </div>
        <div className="flex justify-between items-center mb-6">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">
            {hasError
              ? 'Erro na instalação'
              : completed
                ? 'Instalação concluída'
                : 'Instalando dependências…'}
          </span>
          <span className="text-[10px] font-bold text-slate-400 tracking-wider">{progress}%</span>
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
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors duration-300"
                style={{
                  background: isActive
                    ? 'rgba(249, 115, 22, 0.10)'
                    : isDone
                      ? 'rgba(16, 185, 129, 0.10)'
                      : isError
                        ? 'rgba(239, 68, 68, 0.10)'
                        : 'transparent',
                  border: isActive
                    ? '1px solid rgba(249, 115, 22, 0.35)'
                    : isDone
                      ? '1px solid rgba(16, 185, 129, 0.25)'
                      : isError
                        ? '1px solid rgba(239, 68, 68, 0.25)'
                        : '1px solid transparent'
                }}
              >
                {isDone ? (
                  <CheckCircle size={16} className="text-emerald-400 shrink-0" />
                ) : isActive ? (
                  <Loader2 size={16} className="text-kloud-500 shrink-0 animate-spin" />
                ) : isError ? (
                  <AlertCircle size={16} className="text-red-400 shrink-0" />
                ) : (
                  <StepIcon size={16} className="text-slate-400 shrink-0" />
                )}
                <span
                  className={`text-xs font-medium leading-tight ${
                    isDone
                      ? 'text-emerald-400'
                      : isActive
                        ? 'text-white'
                        : isError
                          ? 'text-red-400'
                          : 'text-slate-400'
                  }`}
                >
                  {step.label}
                  {isActive && step.progress > 0 && (
                    <span className="ml-2 text-[10px] text-slate-400">({step.progress}%)</span>
                  )}
                </span>
                {step.id === 'kloud-games' && isError && (
                  <button
                    onClick={handleRetryKloudGames}
                    className="ml-auto shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 hover:text-red-200 transition-all"
                  >
                    Tentar novamente
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Log em tempo real */}
        <div
          ref={logRef}
          className="bg-black/40 rounded-xl p-4 h-32 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300 border border-white/[0.06]"
        >
          {logs.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {line}
            </div>
          ))}
          {hasError && (
            <div className="text-red-400 mt-2">
              Algo deu errado durante a instalação. Verifique sua conexão e tente novamente.
            </div>
          )}
        </div>

        {/* Botão de cancelar */}
        <div className="flex justify-end mt-4 gap-3">
          <button
            onClick={handleCancel}
            disabled={completed || !hasError}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white glass glass-hover transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {hasError ? 'Tentar novamente mais tarde' : 'Cancelar'}
          </button>
        </div>
      </motion.div>

      {/* Rodapé */}
      <motion.div
        {...entranceProps(reduced, {}, { delay: 0.8 })}
        className="absolute bottom-6 text-[10px] text-slate-400 uppercase tracking-widest font-bold"
      >
        Kolnd Hub • Instalação automática
      </motion.div>
    </div>
  )
}
