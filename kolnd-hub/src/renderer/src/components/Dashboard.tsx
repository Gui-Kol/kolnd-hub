import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, Code, Cpu, Gamepad2, Wifi } from 'lucide-react'
import { AppCard } from './AppCard'
import { AppDetailModal } from './AppDetailModal'
import { AppConfig, AppState } from '../types'

interface DashboardProps {
  apps: AppConfig[]
  appStates: Record<string, AppState>
  onLaunch: (app: AppConfig) => void
  onStop: (appId: string) => void
}

const categoryMeta = {
  ai: { label: 'Inteligência Artificial', icon: Cpu },
  gaming: { label: 'Gaming', icon: Gamepad2 },
  streaming: { label: 'Streaming', icon: Wifi },
  dev: { label: 'Dev', icon: Code }
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
    <div className="max-w-6xl mx-auto space-y-8">
      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-1"
      >
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-sm text-slate-500">Gerencie todos os seus programas em um só lugar</p>
      </motion.div>

      {/* ── Stats bar ────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass rounded-xl p-4 flex items-center gap-6"
      >
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-indigo-400" />
          <span className="text-sm text-slate-400">Total:</span>
          <span className="text-sm font-semibold text-white">{apps.length} programas</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-slate-400">Ativos:</span>
          <span className="text-sm font-semibold text-emerald-400">{runningCount}</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-slate-600" />
          <span className="text-sm text-slate-400">Parados:</span>
          <span className="text-sm font-semibold text-slate-300">{stoppedCount}</span>
        </div>
      </motion.div>

      {/* ── Grouped apps ─────────────────────────────── */}
      {groupedApps.map((group, gi) => {
        const Icon = group.icon
        return (
          <motion.div
            key={group.category}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + gi * 0.1 }}
          >
            {/* Category header */}
            <div className="flex items-center gap-2 mb-4">
              <Icon size={16} className="text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                {group.label}
              </h3>
              <div className="flex-1 h-px bg-white/[0.04]" />
            </div>

            {/* Cards grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.apps.map((app, i) => (
                <AppCard
                  key={app.id}
                  app={app}
                  state={appStates[app.id]}
                  onLaunch={() => onLaunch(app)}
                  onStop={() => onStop(app.id)}
                  onClick={() => setSelectedApp(app)}
                  delay={0.3 + gi * 0.1 + i * 0.05}
                />
              ))}
            </div>
          </motion.div>
        )
      })}

      {/* ── Detail modal ─────────────────────────────── */}
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
