import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Monitor, Trash2, RefreshCw } from 'lucide-react'
import {
  StartupItem,
  ImportanceLevel,
  IMPORTANCE_LEVELS,
  IMPORTANCE_LABELS,
  STARTUP_LOCATION_LABEL,
  STARTUP_SCOPE_LABEL
} from '../types'

interface InicializacaoProps {
  pcName: string
  items: StartupItem[]
  importance: Record<string, ImportanceLevel>
  labels: typeof IMPORTANCE_LABELS
  onImportanceChange: (itemId: string, level: ImportanceLevel) => void
  onRemove: (item: StartupItem) => void
  onReload: () => Promise<void>
}

export function Inicializacao({
  pcName,
  items,
  importance,
  labels,
  onImportanceChange,
  onRemove,
  onReload
}: InicializacaoProps): JSX.Element {
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    await onReload()
    setRefreshing(false)
  }

  const handleRemove = async (item: StartupItem): Promise<void> => {
    if (
      !window.confirm(`Remover "${item.name}" da inicialização do ${pcName}?`)
    ) {
      return
    }
    await onRemove(item)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Monitor size={22} className="text-indigo-400 shrink-0" />
            {pcName}
          </h2>
          <p className="text-sm text-slate-500">
            Aplicativos configurados para iniciar junto com o seu PC
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-300 ${
            refreshing
              ? 'opacity-60 cursor-not-allowed'
              : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30'
          }`}
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Atualizando...' : 'Atualizar'}
        </button>
      </motion.div>

      {/* ── Lista de inicialização ───────────────────── */}
      {items.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-xl p-12 text-center"
        >
          <Monitor size={40} className="mx-auto mb-4 text-slate-600" />
          <h3 className="text-sm font-semibold text-white">Nenhum aplicativo na inicialização</h3>
          <p className="text-[12px] text-slate-500 mt-1">
            Nada está configurado para iniciar junto com o {pcName}.
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const level = importance[item.id] ?? 'opcional'
            const meta = labels[level]
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 group"
              >
                {/* ── Nome / caminho / local ─────────── */}
                <div className="flex flex-col md:flex-row md:items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center shrink-0">
                    <Monitor size={18} className="text-slate-500" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="text-sm font-semibold text-white truncate" title={item.name}>
                      {item.name}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5">
                      <span className="flex items-center gap-1">
                        {STARTUP_LOCATION_LABEL[item.location]}
                      </span>
                      <span className="w-px h-2 bg-white/10" />
                      <span>{STARTUP_SCOPE_LABEL[item.scope]}</span>
                    </div>
                    <code
                      className="text-[10px] text-slate-500 truncate mt-1 block leading-tight"
                      title={item.path}
                    >
                      {item.path}
                    </code>
                  </div>
                </div>

                {/* ── Importância ────────────────────── */}
                <div className="flex flex-col md:flex-row md:items-center gap-2 shrink-0 w-full md:w-auto">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Importância
                  </span>
                  <select
                    value={level}
                    onChange={(e) =>
                      onImportanceChange(item.id, e.target.value as ImportanceLevel)
                    }
                    className="text-xs bg-white/[0.03] border border-white/[0.08] rounded-lg px-2 py-1.5 text-slate-200 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                    style={{ color: meta.color }}
                  >
                    {IMPORTANCE_LEVELS.map((l) => {
                      const m = labels[l]
                      return (
                        <option key={l} value={l} style={{ color: m.color }}>
                          {m.label}
                        </option>
                      )
                    })}
                  </select>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${meta.badge}`}
                    title={meta.subtitle}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                    {meta.label}
                  </span>
                </div>

                {/* ── Ação ───────────────────────────── */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleRemove(item)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 border border-red-500/20 transition-colors"
                  >
                    <Trash2 size={13} /> Remover da inicialização
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* ── Legenda de importância ───────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="glass rounded-xl p-4 flex flex-wrap gap-3 items-center"
      >
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mr-2">
          Níveis de importância
        </span>
        {IMPORTANCE_LEVELS.map((l) => {
          const m = labels[l]
          return (
            <span key={l} className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
              <span className="text-[11px] font-medium text-slate-300">{m.label}</span>
              <span className="text-[10px] text-slate-500">{m.subtitle}</span>
            </span>
          )
        })}
      </motion.div>
    </div>
  )
}
