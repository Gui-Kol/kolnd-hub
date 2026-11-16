import { motion } from 'framer-motion'
import { Play, Square, ExternalLink } from 'lucide-react'
import { AppConfig, AppState } from '../types'
import { entranceProps, useReducedMotion } from '../lib/motion'

interface AppCardProps {
  app: AppConfig
  state?: AppState
  onLaunch: () => void
  onStop: () => void
  onClick: () => void
  delay: number
}

const categoryBadge: Record<string, { label: string; className: string }> = {
  ai: { label: 'IA', className: 'badge-neon-cyan' },
  gaming: { label: 'JOGO', className: 'badge-neon-purple' },
  streaming: { label: 'STREAM', className: 'badge-playstation' },
  dev: { label: 'DEV', className: 'badge-kloud' }
}

export function AppCard({
  app,
  state,
  onLaunch,
  onStop,
  onClick,
  delay
}: AppCardProps): JSX.Element {
  const isRunning = state?.status === 'running'
  const isError = state?.status === 'error'
  const isBackground = state?.source === 'background'
  // Movimento decorativo (entrada com stagger, hover-lift, tap) some com reduce.
  const reduced = useReducedMotion()

  const badge = categoryBadge[app.category] ?? {
    label: app.category.toUpperCase(),
    className: 'badge-steam'
  }

  return (
    <motion.div
      {...entranceProps(reduced, { y: 20, scale: 0.95 }, { delay, duration: 0.5, ease: 'easeOut' })}
      whileHover={reduced ? undefined : { y: -6, transition: { duration: 0.3 } }}
      whileTap={reduced ? undefined : { scale: 0.98 }}
      className="glass-card cursor-pointer group relative overflow-hidden"
      onClick={onClick}
      data-testid="app-card"
    >
      {/* Brilho de borda baseado no estado */}
      <div
        className="absolute inset-0 rounded-2xl border p-[1px] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          borderImage: isRunning
            ? `linear-gradient(135deg, ${app.color}, #ef4444) 1`
            : `linear-gradient(135deg, ${app.color}80, transparent) 1`
        }}
      />

      {/* Overlay de gradiente sutil */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-60" />

      {/* Tag da categoria */}
      <div className="absolute top-4 left-4 z-10">
        <span className={`badge ${badge.className} shadow`}>{badge.label}</span>
      </div>

      {/* Status running overlay */}
      {isRunning && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 backdrop-blur-sm">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] font-bold text-emerald-400">Online</span>
        </div>
      )}

      {/* Conteúdo do card */}
      <div className="relative z-20 p-5 pt-10">
        {/* Cabeçalho com ícone e nome */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shadow-lg transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110"
              style={{
                background: `linear-gradient(135deg, ${app.color}25, ${app.color}10)`,
                boxShadow: `0 0 20px ${app.color}40`
              }}
            >
              {app.icon}
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight group-hover:text-white transition-colors">
                {app.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className={`w-2 h-2 rounded-full transition-colors ${
                    isRunning
                      ? 'bg-emerald-400 animate-pulse'
                      : isError
                        ? 'bg-red-400'
                        : 'bg-slate-700'
                  }`}
                />
                <span
                  className={`text-[10px] font-bold ${
                    isRunning ? 'text-emerald-400' : isError ? 'text-red-400' : 'text-slate-400'
                  }`}
                  title={isBackground ? 'Rodando em segundo plano' : undefined}
                >
                  {isBackground ? 'Ativo' : isRunning ? 'Executando' : isError ? 'Erro' : 'Parado'}
                </span>
              </div>
            </div>
          </div>

          {/* Atalho URL */}
          {app.url && isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.api.openExternal(app.url!)
              }}
              className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-neon-cyan/70"
              title="Abrir no navegador"
            >
              <ExternalLink size={14} />
            </button>
          )}
        </div>

        {/* Descrição */}
        <p className="text-[11px] text-slate-400 leading-relaxed mb-5 line-clamp-2 font-medium">
          {app.description}
        </p>

        {/* Tags */}
        <div className="flex items-center gap-2 mb-6">
          {app.tags.map((tag) => (
            <span
              key={tag}
              className="text-[9px] px-2 py-0.5 rounded-full font-bold border"
              style={{
                background: `${app.color}10`,
                borderColor: `${app.color}30`,
                color: `${app.color}cc`
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Barra de ação */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (isRunning) {
              onStop()
            } else {
              onLaunch()
            }
          }}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow focus-visible:ring-2 focus-visible:ring-neon-cyan/70 ${
            isRunning
              ? 'bg-red-600/20 text-red-400 hover:bg-red-600/40 hover:text-red-300 border border-red-500/30 shadow-glow-red'
              : `text-white bg-gradient-to-r from-${app.color}/20 to-${app.color}/10 border border-${app.color}/40 hover:from-${app.color}/40 hover:to-${app.color}/20 hover:border-${app.color}/60 shadow-glow-orange`
          }`}
        >
          {isRunning ? (
            <>
              <Square size={13} /> Parar
            </>
          ) : (
            <>
              <Play size={13} /> Iniciar
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}
