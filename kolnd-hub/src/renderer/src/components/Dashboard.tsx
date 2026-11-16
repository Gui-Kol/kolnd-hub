import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, Cpu, Gamepad2, Wifi, Code, Clock } from 'lucide-react'
import { AppCard } from './AppCard'
import { AppDetailModal } from './AppDetailModal'
import { AppConfig, AppState } from '../types'

interface DashboardProps {
  apps: AppConfig[]
  appStates: Record<string, AppState>
  onLaunch: (app: AppConfig) => void
  onStop: (appId: string) => void
}

const categoryMeta: Record<string, { label: string; icon: any; color: string; glow: string }> = {
  ai: {
    label: 'Inteligência Artificial',
    icon: Cpu,
    color: 'text-neon-cyan',
    glow: 'shadow-glow-cyan'
  },
  gaming: {
    label: 'Gaming',
    icon: Gamepad2,
    color: 'text-neon-purple',
    glow: 'shadow-glow-purple'
  },
  streaming: {
    label: 'Streaming',
    icon: Wifi,
    color: 'text-playstation-500',
    glow: 'shadow-glow-blue'
  },
  dev: {
    label: 'Development',
    icon: Code,
    color: 'text-kloud-500',
    glow: 'shadow-glow-orange'
  }
}

export function Dashboard({ apps, appStates, onLaunch, onStop }: DashboardProps): JSX.Element {
  const [selectedApp, setSelectedApp] = useState<AppConfig | null>(null)

  const runningCount = Object.values(appStates).filter((s) => s.status === 'running').length
  const stoppedCount = apps.length - runningCount

  const categories = ['ai', 'gaming', 'streaming', 'dev'] as const
  const groupedApps = categories
    .map((cat) => ({
      category: cat,
      ...categoryMeta[cat],
      apps: apps.filter((a) => a.category === cat)
    }))
    .filter((g) => g.apps.length > 0)

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* ── Header estilo perfil Steam ───────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-white tracking-tight gradient-text gradient-rainbow text-shadow">
              Ferramentas
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Seus programas do ecossistema, num só lugar
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="glass rounded-xl px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Activity size={12} className="text-slate-400" />
              <span>{apps.length} títulos</span>
            </div>
            <div
              className="glass rounded-xl px-4 py-2 flex items-center gap-2"
              role="status"
              aria-live="polite"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-emerald-400">{runningCount} online</span>
            </div>
          </div>
        </div>

        <div className="mt-4 glass rounded-2xl p-5 flex items-center gap-6 border border-white/[0.06]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
              Todos os sistemas operacionais
            </span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-slate-600" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {stoppedCount} offline
            </span>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-slate-400" />
            <span className="text-xs text-slate-400">Latência: 12ms</span>
          </div>
        </div>
      </motion.div>

      {/* ── Jogos agrupados por categoria ────────────── */}
      {groupedApps.map((group, gi) => {
        const Icon = group.icon
        return (
          <motion.div
            key={group.category}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + gi * 0.08 }}
            className="space-y-3"
          >
            {/* Cabeçalho da categoria estilo Steam */}
            <div className="flex items-center gap-3 mb-1">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  group.color
                } ${group.glow}`}
              >
                <Icon size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest">
                  {group.label}
                </h3>
                <div className="h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-white/[0.03] px-2 py-0.5 rounded-full border border-white/10">
                {group.apps.length}
              </span>
            </div>

            {/* Cards em grade */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {group.apps.map((app, i) => (
                <AppCard
                  key={app.id}
                  app={app}
                  state={appStates[app.id]}
                  onLaunch={() => onLaunch(app)}
                  onStop={() => onStop(app.id)}
                  onClick={() => setSelectedApp(app)}
                  delay={0.15 + gi * 0.08 + i * 0.03}
                />
              ))}
            </div>
          </motion.div>
        )
      })}

      {/* ── Detalhe modal ────────────────────────────── */}
      <AnimatePresence>
        {selectedApp && (
          <AppDetailModal
            app={selectedApp}
            state={appStates[selectedApp.id]}
            onLaunch={() => onLaunch(selectedApp)}
            onStop={() => onStop(selectedApp.id)}
            onClose={() => setSelectedApp(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
