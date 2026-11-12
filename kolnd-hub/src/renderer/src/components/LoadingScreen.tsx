import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, Loader2, CheckCircle, Clock, Monitor, Database } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type LoadingStep = {
  id: string
  label: string
  icon: LucideIcon
  color: string
}

/** Etapas do carregamento inicial do Kolnd Hub. */
const STEPS: LoadingStep[] = [
  {
    id: 'ui',
    label: 'Inicializando interface…',
    icon: Monitor,
    color: 'text-kloud-500'
  },
  {
    id: 'system',
    label: 'Carregando perfil do sistema…',
    icon: Database,
    color: 'text-neon-cyan'
  },
  {
    id: 'apps',
    label: 'Verificando programas instalados…',
    icon: Zap,
    color: 'text-nintendo-500'
  },
  {
    id: 'status',
    label: 'Sincronizando status dos apps…',
    icon: Clock,
    color: 'text-neon-purple'
  },
  {
    id: 'ready',
    label: 'Tudo pronto! Iniciando Kolnd Hub…',
    icon: CheckCircle,
    color: 'text-emerald-400'
  }
]

const STEP_DURATION_MS = 650
const FINISH_DELAY_MS = 600

interface LoadingScreenProps {
  onReady: () => void
}

export function LoadingScreen({ onReady }: LoadingScreenProps): JSX.Element {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)

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
    <div className="fixed inset-0 z-[100] bg-[#050508] flex flex-col items-center justify-center overflow-hidden">
      {/* ── Fundo decorativo ─────────────────────────── */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-kloud-500/10 rounded-full blur-[120px] animate-pulse"
        />
        <div
          className="absolute bottom-[-20%] right-[-20%] w-[50%] h-[50%] bg-nintendo-500/10 rounded-full blur-[120px] animate-pulse"
          style={{ animationDelay: '2s' }}
        />
        <div className="scanlines" />
      </div>

      {/* ── Conteúdo central ────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.4 }}
        className="glass rounded-3xl p-8 md:p-12 w-full max-w-sm text-center border border-white/[0.1] shadow-2xl shadow-black/60 relative"
      >
        {/* Logo Kolnd Hub */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div
            className="w-14 h-14 rounded-2xl bg-gradient-to-br from-kloud-500 to-nintendo-500 flex items-center justify-center shadow-glow-orange shadow-glow-red"
            style={{ animation: 'float 6s ease-in-out infinite' }}
          >
            <Zap size={24} className="text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight gradient-text gradient-kloud">
              Kolnd Hub
            </h2>
            <p className="text-xs text-slate-500 uppercase tracking-widest mt-0.5">
              Central de controle
            </p>
          </div>
        </div>

        {/* Mensagem da etapa atual */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-6"
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            <ActiveIcon size={18} className={activeStep.color} />
            <span className="text-sm font-semibold text-slate-200">{activeStep.label}</span>
          </div>
          {currentStepIndex < STEPS.length - 1 && (
            <p className="text-[11px] text-slate-500 mt-1">
              Aguarde enquanto preparamos tudo para funcionar sem travamentos.
            </p>
          )}
        </motion.div>

        {/* Barra de progresso */}
        <div className="w-full bg-white/[0.05] rounded-full h-2 mb-8 overflow-hidden border border-white/[0.08]">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-kloud-500 to-nintendo-500 rounded-full shadow-glow-orange shadow-glow-red relative overflow-hidden"
          >
            {/* Faixa brilhante móvel na barra */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-skew" />
          </motion.div>
        </div>
        <span className="text-[11px] font-bold text-slate-400 tracking-wider">
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
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.08 }}
                className="flex items-center gap-3 px-3 py-2 rounded-xl transition-colors duration-300"
                style={{
                  background: isActive
                    ? 'rgba(249, 115, 22, 0.10)'
                    : isDone
                      ? 'rgba(16, 185, 129, 0.10)'
                      : 'transparent',
                  border: isActive
                    ? '1px solid rgba(249, 115, 22, 0.35)'
                    : isDone
                      ? '1px solid rgba(16, 185, 129, 0.25)'
                      : '1px solid transparent'
                }}
              >
                {isDone ? (
                  <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                ) : isActive ? (
                  <Loader2 size={14} className="text-kloud-500 shrink-0 animate-spin" />
                ) : (
                  <StepIcon size={14} className="text-slate-600 shrink-0" />
                )}
                <span
                  className={`text-xs font-medium leading-tight ${
                    isDone
                      ? 'text-emerald-400'
                      : isActive
                        ? 'text-white'
                        : 'text-slate-500'
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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="absolute bottom-8 text-[10px] text-slate-600 uppercase tracking-widest font-bold"
      >
        Kolnd Hub • Carregamento seguro
      </motion.div>
    </div>
  )
}
