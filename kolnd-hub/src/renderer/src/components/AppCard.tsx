import { motion } from 'framer-motion'
import { Play, Square, ExternalLink } from 'lucide-react'
import { AppConfig, AppState } from '../types'

interface AppCardProps {
  app: AppConfig
  state?: AppState
  onLaunch: () => void
  onStop: () => void
  onClick: () => void
  delay: number
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.4, ease: 'easeOut' }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className="glass glass-hover rounded-xl overflow-hidden cursor-pointer group"
      style={
        {
          '--glow-color': isRunning ? `${app.color}30` : 'transparent'
        } as React.CSSProperties
      }
      onClick={onClick}
    >
      {/* ── Color accent bar ─────────────────────────── */}
      <div
        className="h-1 w-full transition-all duration-500"
        style={{
          background: isRunning
            ? `linear-gradient(90deg, ${app.color}, ${app.color}80)`
            : isError
              ? 'linear-gradient(90deg, #EF4444, #EF444480)'
              : `linear-gradient(90deg, ${app.color}40, transparent)`
        }}
      />

      <div className="p-5">
        {/* ── Header ─────────────────────────────────── */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-transform duration-300 group-hover:scale-110"
              style={{ background: `${app.color}15` }}
            >
              {app.icon}
            </div>

            {/* Name + status */}
            <div>
              <h3 className="text-sm font-semibold text-white group-hover:text-white transition-colors">
                {app.name}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    isRunning
                      ? 'bg-emerald-400 animate-pulse'
                      : isError
                        ? 'bg-red-400'
                        : 'bg-slate-600'
                  }`}
                />
                <span
                  className={`text-[11px] font-medium ${
                    isRunning
                      ? 'text-emerald-400'
                      : isError
                        ? 'text-red-400'
                        : 'text-slate-500'
                  }`}
                  title={isBackground ? 'Rodando em segundo plano' : undefined}
                >
                  {isBackground ? 'Ativo' : isRunning ? 'Em execução' : isError ? 'Erro' : 'Parado'}
                </span>
              </div>
            </div>
          </div>

          {/* URL shortcut (only when running) */}
          {app.url && isRunning && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                window.api.openExternal(app.url!)
              }}
              className="p-1.5 rounded-lg hover:bg-white/10 text-slate-500 hover:text-white transition-all opacity-0 group-hover:opacity-100"
              title="Abrir no navegador"
            >
              <ExternalLink size={14} />
            </button>
          )}
        </div>

        {/* ── Description ────────────────────────────── */}
        <p className="text-xs text-slate-500 leading-relaxed mb-4 line-clamp-2">{app.description}</p>

        {/* ── Tags ───────────────────────────────────── */}
        <div className="flex items-center gap-1.5 mb-4">
          {app.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{
                background: `${app.color}10`,
                color: `${app.color}cc`
              }}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* ── Action button ──────────────────────────── */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            isRunning ? onStop() : onLaunch()
          }}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all duration-300 ${
            isRunning
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
              : 'text-white hover:opacity-90 border border-transparent'
          }`}
          style={
            !isRunning
              ? {
                  background: `linear-gradient(135deg, ${app.color}25, ${app.color}10)`,
                  borderColor: `${app.color}30`
                }
              : undefined
          }
        >
          {isRunning ? (
            <>
              <Square size={12} /> Parar
            </>
          ) : (
            <>
              <Play size={12} /> Iniciar
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}
