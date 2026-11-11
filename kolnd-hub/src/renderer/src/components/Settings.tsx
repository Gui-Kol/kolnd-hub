import { useState } from 'react'
import { motion } from 'framer-motion'
import { Save, RotateCcw, Terminal, FolderOpen, AlertCircle } from 'lucide-react'
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
    <div className="max-w-5xl mx-auto space-y-8">
      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <h2 className="text-3xl font-bold text-white tracking-tight gradient-text gradient-rainbow text-shadow">
            Configurações
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Ajuste comandos e diretórios de trabalho dos seus títulos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white glass glass-hover transition-all"
          >
            <RotateCcw size={14} /> Resetar tudo
          </button>
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow ${
              saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-glow-cyan'
                : 'bg-gradient-to-r from-kloud-500 to-nintendo-500 text-white shadow-glow-red hover:from-kloud-600 hover:to-nintendo-600'
            }`}
          >
            <Save size={14} /> {saved ? 'Salvo!' : 'Salvar alterações'}
          </button>
        </div>
      </motion.div>

      <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mx-2">
        Gerenciador de títulos
      </p>

      {/* ── Cards de configuração ────────────────────── */}
      <div className="space-y-4">
        {editedApps.map((app, index) => (
          <motion.div
            key={app.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
            className="glass rounded-2xl p-6 border-l-4 border-transparent hover:border-kloud-500/50 transition-all"
          >
            {/* Cabeçalho do app */}
            <div className="flex items-center gap-3.5 mb-5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${app.color}25, ${app.color}10)`,
                  boxShadow: `0 0 20px ${app.color}40`
                }}
              >
                {app.icon}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{app.name}</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  {app.category.toUpperCase()}
                </p>
              </div>
            </div>

            {/* Campos editáveis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="label-panel">
                  <Terminal size={12} /> Comando
                </label>
                <input
                  type="text"
                  value={app.command}
                  onChange={(e) => handleChange(index, 'command', e.target.value)}
                  className="input-gamer"
                  placeholder="ex: kloud-games.exe"
                />
              </div>
              <div>
                <label className="label-panel">
                  <FolderOpen size={12} /> Diretório de trabalho
                </label>
                <input
                  type="text"
                  value={app.cwd}
                  onChange={(e) => handleChange(index, 'cwd', e.target.value)}
                  className="input-gamer"
                  placeholder="ex: %USERPROFILE%\\Documents\\My Games\\kloud-games"
                />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Nota informativa ─────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="glass rounded-2xl p-6 flex items-start gap-4 border-l-4 border-kloud-500/50"
      >
        <AlertCircle size={22} className="text-kloud-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Caminhos relativos (como
            <code className="text-slate-300 bg-white/5 px-2 py-0.5 rounded font-mono text-[11px]">
              ../deepseek-harness
            </code>
            ) são resolvidos a partir da instalação do Kolnd Hub. Use caminhos absolutos se os
            programas estiverem em locais diferentes.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
