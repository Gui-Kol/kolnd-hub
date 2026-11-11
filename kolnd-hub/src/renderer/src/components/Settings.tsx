import { useState } from 'react'
import { motion } from 'framer-motion'
import { Save, RotateCcw, FolderOpen, Terminal } from 'lucide-react'
import { AppConfig } from '../types'

interface SettingsProps {
  apps: AppConfig[]
  onSave: (apps: AppConfig[]) => void
}

export function Settings({ apps, onSave }: SettingsProps): JSX.Element {
  const [editedApps, setEditedApps] = useState<AppConfig[]>(
    apps.map((a) => ({ ...a }))
  )
  const [saved, setSaved] = useState(false)

  const handleChange = (index: number, field: keyof AppConfig, value: string): void => {
    setEditedApps((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
    setSaved(false)
  }

  const handleSave = (): void => {
    onSave(editedApps)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = (): void => {
    setEditedApps(apps.map((a) => ({ ...a })))
    setSaved(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-2xl font-bold text-white">Configurações</h2>
          <p className="text-sm text-slate-500 mt-1">
            Configure os caminhos e comandos de cada programa
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white glass glass-hover"
          >
            <RotateCcw size={13} /> Resetar
          </button>
          <button
            onClick={handleSave}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 ${
              saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30'
            }`}
          >
            <Save size={13} /> {saved ? 'Salvo! ✓' : 'Salvar'}
          </button>
        </div>
      </motion.div>

      {/* ── App config cards ─────────────────────────── */}
      <div className="space-y-4">
        {editedApps.map((app, index) => (
          <motion.div
            key={app.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="glass rounded-xl p-5"
          >
            {/* App header */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
                style={{ background: `${app.color}15` }}
              >
                {app.icon}
              </div>
              <h3 className="text-sm font-semibold text-white">{app.name}</h3>
            </div>

            {/* Editable fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 mb-1.5">
                  <Terminal size={11} /> Comando
                </label>
                <input
                  type="text"
                  value={app.command}
                  onChange={(e) => handleChange(index, 'command', e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                  placeholder="ex: python main.py"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 mb-1.5">
                  <FolderOpen size={11} /> Diretório de trabalho
                </label>
                <input
                  type="text"
                  value={app.cwd}
                  onChange={(e) => handleChange(index, 'cwd', e.target.value)}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                  placeholder="ex: ../Mark-LVI"
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Info note ────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="glass rounded-xl p-4 flex items-start gap-3"
      >
        <span className="text-lg">💡</span>
        <div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Os caminhos relativos (como <code className="text-slate-300 bg-white/5 px-1 rounded">../deepseek-harness</code>) são
            resolvidos a partir do diretório de instalação do Kolnd Hub. Use caminhos absolutos se
            os programas estiverem em locais diferentes.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
