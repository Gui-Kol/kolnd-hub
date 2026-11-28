import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, exitProps, fadeOnlyTransition, useReducedMotion } from '../lib/motion'
import { Zap, Loader2, Check, CheckCircle, Clock, Monitor, Database } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type LoadingStep = {
  id: string
  label: string
  icon: LucideIcon
}

/** Etapas do carregamento inicial do Kolnd Hub. */
const STEPS: LoadingStep[] = [
  {
    id: 'ui',
    label: 'Inicializando interface…',
    icon: Monitor
  },
  {
    id: 'system',
    label: 'Carregando perfil do sistema…',
    icon: Database
  },
  {
    id: 'apps',
    label: 'Verificando programas instalados…',
    icon: Zap
  },
  {
    id: 'status',
    label: 'Sincronizando status dos apps…',
    icon: Clock
  },
  {
    id: 'ready',
    label: 'Tudo pronto! Iniciando Kolnd Hub…',
    icon: CheckCircle
  }
]

const STEP_DURATION_MS = 650
const FINISH_DELAY_MS = 600

interface LoadingScreenProps {
  onReady: () => void
}

export function LoadingScreen({ onReady }: LoadingScreenProps): JSX.Element {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  // Entradas decorativas (card, etapas, rodapé) viram fade curto com reduce.
  const reduced = useReducedMotion()

  // Progresso derivado da etapa atual: sem estado duplicado para dessincronizar.
  const progress = Math.round(((currentStepIndex + 1) / STEPS.length) * 100)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    let step = 0

    const tick = (): void => {
      step += 1
      if (step >= STEPS.length) {
        // Última etapa exibida como concluída antes de liberar o Hub.
        timers.push(setTimeout(onReady, FINISH_DELAY_MS))
        return
      }
      setCurrentStepIndex(step)
      timers.push(setTimeout(tick, STEP_DURATION_MS))
    }

    timers.push(setTimeout(tick, STEP_DURATION_MS))

    return (): void => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [onReady])

  const activeStep = STEPS[currentStepIndex]
  const ActiveIcon = activeStep.icon

  return (
    <div className="fixed inset-0 z-modal bg-surface-base flex flex-col items-center justify-center overflow-hidden">
      {/* ── Conteúdo central ────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { scale: 0.95 }, { duration: 0.4 })}
        exit={exitProps(reduced, { scale: 0.9 })}
        className="bg-surface-1 rounded-card p-8 md:p-12 w-full max-w-sm text-center border border-[var(--border-subtle)] shadow-elevation-3 relative"
      >
        {/* Logo Kolnd Hub */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-14 h-14 rounded-card bg-accent flex items-center justify-center">
            <Zap size={24} className="text-accent-contrast" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-ink-primary tracking-tight">Kolnd Hub</h2>
            <p className="text-xs text-ink-tertiary uppercase tracking-widest mt-0.5">
              Central de controle
            </p>
          </div>
        </div>

        {/* Mensagem da etapa atual */}
        <motion.div {...entranceProps(reduced, { y: 10 }, { delay: 0.2 })} className="mb-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ActiveIcon size={18} className="text-accent" />
            <span className="text-sm font-semibold text-ink-primary">{activeStep.label}</span>
          </div>
          {currentStepIndex < STEPS.length - 1 && (
            <p className="text-[11px] text-ink-tertiary mt-1">
              Aguarde enquanto preparamos tudo para funcionar sem travamentos.
            </p>
          )}
        </motion.div>

        {/* Barra de progresso */}
        <div className="w-full bg-surface-sunken rounded-pill h-2 mb-8 overflow-hidden border border-[var(--border-subtle)]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={reduced ? fadeOnlyTransition : { duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-accent rounded-pill"
          />
        </div>
        <span className="text-[11px] font-bold text-ink-tertiary tracking-wider tabular-nums">
          {progress}% concluído
        </span>

        {/* Lista de etapas */}
        <div className="mt-8 space-y-2">
          {STEPS.map((step, i) => {
            const StepIcon = step.icon
            const isDone = i < currentStepIndex
            const isActive = i === currentStepIndex
            return (
              <motion.div
                key={step.id}
                {...entranceProps(reduced, { x: -10 }, { delay: 0.1 + i * 0.08 })}
                className={`flex items-center gap-3 px-3 py-2 rounded-control border transition-colors duration-300 ${
                  isActive
                    ? 'bg-accent-muted border-accent-border'
                    : isDone
                      ? 'bg-success-bg border-success-border'
                      : 'bg-transparent border-transparent'
                }`}
              >
                {isDone ? (
                  <Check size={14} className="text-success shrink-0" />
                ) : isActive ? (
                  <Loader2 size={14} className="text-accent shrink-0 animate-spin" />
                ) : (
                  <StepIcon size={14} className="text-ink-tertiary shrink-0" />
                )}
                <span
                  className={`text-xs font-medium leading-tight ${
                    isDone ? 'text-success' : isActive ? 'text-ink-primary' : 'text-ink-tertiary'
                  }`}
                >
                  {step.label}
                </span>
              </motion.div>
            )
          })}
        </div>
      </motion.div>

      {/* Rodapé discreto */}
      <motion.div
        {...entranceProps(reduced, {}, { delay: 0.8 })}
        className="absolute bottom-8 text-[10px] text-ink-tertiary uppercase tracking-widest font-bold"
      >
        Kolnd Hub • Carregamento seguro
      </motion.div>
    </div>
  )
}
