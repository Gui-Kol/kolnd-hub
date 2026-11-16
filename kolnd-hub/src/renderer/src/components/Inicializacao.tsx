import { useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import {
  Monitor,
  Trash2,
  RefreshCw,
  Plus,
  CheckCircle2,
  Trash,
  Square,
  Play,
  AlertTriangle,
  ArrowUpCircle
} from 'lucide-react'
import { PcUpdates } from './PcUpdates'
import { PcCleanup } from './PcCleanup'
import {
  StartupItem,
  ImportanceLevel,
  IMPORTANCE_LEVELS,
  IMPORTANCE_LABELS,
  STARTUP_LOCATION_LABEL,
  STARTUP_SCOPE_LABEL
} from '../types'
import { AppConfig } from '../types'
import { classifyImportance } from '../lib/startup'

type PcTab = 'inicializacao' | 'atualizacoes' | 'limpeza'

const PC_TABS: Array<{ id: PcTab; label: string; icon: typeof Monitor }> = [
  { id: 'inicializacao', label: 'Inicialização', icon: Monitor },
  { id: 'atualizacoes', label: 'Atualizações', icon: ArrowUpCircle },
  { id: 'limpeza', label: 'Limpeza', icon: Trash2 }
]

const appImportance = (app: AppConfig): ImportanceLevel =>
  classifyImportance({
    id: app.id,
    name: app.name,
    path: app.command,
    location: 'registro',
    scope: 'usuario'
  })

interface InicializacaoProps {
  pcName: string
  items: StartupItem[]
  importance: Record<string, ImportanceLevel>
  labels: typeof IMPORTANCE_LABELS
  onRemove: (item: StartupItem) => void
  onRemoveBatch: (items: StartupItem[]) => void
  onAdd: (app: AppConfig) => void
  onAddBatch: (apps: AppConfig[]) => void
  onReload: () => Promise<void>
  appsNotInStartup: AppConfig[]
}

export function Inicializacao({
  pcName,
  items,
  importance,
  labels,
  onRemove,
  onRemoveBatch,
  onAdd,
  onAddBatch,
  onReload,
  appsNotInStartup
}: InicializacaoProps): JSX.Element {
  // Entradas decorativas (header, seções, itens de lista) viram fade curto com reduce.
  const reduced = useReducedMotion()
  const [refreshing, setRefreshing] = useState(false)
  const [selectedToRemove, setSelectedToRemove] = useState<Set<string>>(new Set())
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<PcTab>('inicializacao')
  // A aba Atualizações só é montada na primeira visita — e fica montada (oculta)
  // depois disso, para não desmontar a fila de atualizações em andamento.
  const [atualizacoesMounted, setAtualizacoesMounted] = useState(false)

  const handleRefresh = async (): Promise<void> => {
    setRefreshing(true)
    await onReload()
    setRefreshing(false)
  }

  const handleRemove = async (item: StartupItem): Promise<void> => {
    await onRemove(item)
  }

  const handleRemoveBatch = async (): Promise<void> => {
    const selected = items.filter((i) => selectedToRemove.has(i.id))
    if (selected.length === 0) return
    await onRemoveBatch(selected)
    setSelectedToRemove(new Set())
  }

  const handleAdd = async (app: AppConfig): Promise<void> => {
    await onAdd(app)
  }

  const handleAddBatch = async (): Promise<void> => {
    const selected = appsNotInStartup.filter((a) => selectedToAdd.has(a.id))
    if (selected.length === 0) return
    await onAddBatch(selected)
    setSelectedToAdd(new Set())
  }

  const toggleSelectRemove = (id: string): void => {
    setSelectedToRemove((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAdd = (id: string): void => {
    setSelectedToAdd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllRemove = (): void => {
    setSelectedToRemove(new Set(items.map((i) => i.id)))
  }

  const clearSelectRemove = (): void => {
    setSelectedToRemove(new Set())
  }

  const selectAllAdd = (): void => {
    setSelectedToAdd(new Set(appsNotInStartup.map((a) => a.id)))
  }

  const goToTab = (tab: PcTab): void => {
    setActiveTab(tab)
    if (tab === 'atualizacoes') setAtualizacoesMounted(true)
  }

  const clearSelectAdd = (): void => {
    setSelectedToAdd(new Set())
  }

  const isRemoveSelectedAll = items.length > 0 && items.every((i) => selectedToRemove.has(i.id))
  const isAddSelectedAll =
    appsNotInStartup.length > 0 && appsNotInStartup.every((a) => selectedToAdd.has(a.id))

  const categoryColor = (category: string) => {
    const colors: Record<string, string> = {
      ai: 'text-neon-cyan',
      gaming: 'text-neon-purple-light',
      streaming: 'text-playstation-300',
      dev: 'text-kloud-500'
    }
    return colors[category] ?? 'text-slate-400'
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { y: -10 })}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <h2 className="text-3xl font-bold text-white tracking-tight gradient-text gradient-rainbow text-shadow flex items-center gap-3">
            <Monitor size={24} className="text-playstation-400 shrink-0" />
            {pcName}
          </h2>
          <p className="text-sm text-slate-400">Manutenção e inicialização do seu PC</p>
        </div>

        {activeTab === 'inicializacao' && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow ${
              refreshing
                ? 'opacity-60 cursor-not-allowed'
                : 'bg-gradient-to-r from-kloud-500 to-nintendo-500 text-white shadow-glow-red hover:from-kloud-600 hover:to-nintendo-600'
            }`}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Atualizando...' : 'Sincronizar'}
          </button>
        )}
      </motion.div>

      {/* ── Abas do hub "Manutenção do PC" ─────────────── */}
      <div
        role="tablist"
        aria-label="Seções do PC"
        className="glass rounded-2xl p-2 flex flex-col sm:flex-row gap-2"
      >
        {PC_TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => goToTab(id)}
              className={`flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 flex-1 ${
                active
                  ? 'bg-gradient-to-r from-kloud-500 to-nintendo-500 text-white shadow-glow-red'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {label}
            </button>
          )
        })}
      </div>

      {/* ── Aba: Inicialização (conteúdo original, intacto) ── */}
      {activeTab === 'inicializacao' && (
        <>
          {/* ── Seção: iniciam com o PC ──────────────────── */}
          <motion.div {...entranceProps(reduced, { y: 10 })} className="space-y-3">
            {/* Cabeçalho com controles de lote */}
            <div
              className={`glass rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                selectedToRemove.size > 0 ? 'border-red-500/30 bg-red-500/5 shadow-glow-red' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <Monitor size={16} className="text-playstation-400 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Iniciam com o {pcName} ({items.length})
                  </h3>
                  {selectedToRemove.size > 0 && (
                    <p className="text-[10px] font-bold text-red-400 mt-0.5">
                      {selectedToRemove.size} selecionado{selectedToRemove.size > 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                {selectedToRemove.size > 0 ? (
                  <>
                    <button
                      onClick={clearSelectRemove}
                      className="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      Limpar seleção
                    </button>
                    <button
                      onClick={handleRemoveBatch}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-red-400 font-bold border border-red-500/30 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                    >
                      <Trash size={14} /> Remover selecionados
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={isRemoveSelectedAll ? clearSelectRemove : selectAllRemove}
                      className="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      {isRemoveSelectedAll ? 'Selecionar nada' : 'Selecionar tudo'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {items.length === 0 ? (
              <div className="glass rounded-2xl p-10 text-center border-dashed border-white/[0.08]">
                <AlertTriangle size={32} className="mx-auto mb-3 text-slate-400" />
                <p className="text-[12px] font-medium text-slate-400">
                  Nenhum título configurado para iniciar com o {pcName}.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((item) => {
                  const level = importance[item.id] ?? 'opcional'
                  const meta = labels[level]
                  const isSelected = selectedToRemove.has(item.id)
                  return (
                    <motion.div
                      key={item.id}
                      {...entranceProps(reduced, { y: 10 })}
                      className={`glass rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 group ${
                        isSelected ? 'border-red-500/30 bg-red-500/5 ring-1 ring-red-500/20' : ''
                      }`}
                    >
                      {/* Checkbox de seleção */}
                      <div className="shrink-0">
                        <button
                          onClick={() => toggleSelectRemove(item.id)}
                          className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-red-500 text-white border-red-500 shadow-glow-red'
                              : 'bg-white/[0.03] border-white/10 text-slate-400 hover:border-white/30 hover:text-white'
                          }`}
                        >
                          {isSelected ? (
                            <CheckCircle2 size={16} fill="white" />
                          ) : (
                            <Square size={16} />
                          )}
                        </button>
                      </div>

                      {/* ── Nome / caminho / local ─────────── */}
                      <div className="flex flex-col md:flex-row md:items-center gap-4 min-w-0 flex-1">
                        <div className="w-11 h-11 rounded-xl bg-white/[0.03] flex items-center justify-center shrink-0">
                          <Monitor size={20} className="text-slate-400" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="text-sm font-bold text-white truncate" title={item.name}>
                            {item.name}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1.5">
                            <span className="flex items-center gap-1">
                              {STARTUP_LOCATION_LABEL[item.location]}
                            </span>
                            <span className="w-px h-2 bg-white/10" />
                            <span>{STARTUP_SCOPE_LABEL[item.scope]}</span>
                          </div>
                          <code
                            className="text-[10px] text-slate-400 truncate mt-2 block leading-tight"
                            title={item.path}
                          >
                            {item.path}
                          </code>
                        </div>
                      </div>

                      {/* ── Importância (somente leitura) ────────────────────── */}
                      <div className="flex flex-col md:flex-row md:items-center gap-3 shrink-0 w-full md:w-auto">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Importância
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold border`}
                          style={{ color: meta.color }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: meta.color }}
                          />
                          {meta.label}
                        </span>
                      </div>

                      {/* ── Ação individual ───────────────── */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleRemove(item)}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold text-red-400 hover:bg-red-500/10 hover:text-red-300 border border-red-500/20 transition-colors"
                        >
                          <Trash2 size={14} /> Remover
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.div>

          {/* ── Seção: não iniciam com o PC ────────────────── */}
          <motion.div {...entranceProps(reduced, { y: 10 })} className="space-y-3">
            <div
              className={`glass rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                selectedToAdd.size > 0
                  ? 'border-emerald-500/30 bg-emerald-500/5 shadow-glow-cyan'
                  : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <Plus size={16} className="text-emerald-400 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Não iniciam com o {pcName} ({appsNotInStartup.length})
                  </h3>
                  {selectedToAdd.size > 0 && (
                    <p className="text-[10px] font-bold text-emerald-400 mt-0.5">
                      {selectedToAdd.size} selecionado{selectedToAdd.size > 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                {selectedToAdd.size > 0 ? (
                  <>
                    <button
                      onClick={clearSelectAdd}
                      className="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      Limpar seleção
                    </button>
                    <button
                      onClick={handleAddBatch}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-emerald-400 font-bold border border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors"
                    >
                      <Plus size={14} /> Adicionar selecionados
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={isAddSelectedAll ? clearSelectAdd : selectAllAdd}
                      className="flex items-center gap-1 px-3 py-2 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      {isAddSelectedAll ? 'Selecionar nada' : 'Selecionar tudo'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {appsNotInStartup.length === 0 ? (
              <div className="glass rounded-2xl p-10 text-center border-dashed border-white/[0.08]">
                <Play size={32} className="mx-auto mb-3 text-emerald-400" />
                <p className="text-[12px] font-bold text-emerald-400">
                  Todos os títulos já iniciam com o {pcName}! 🎮
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {appsNotInStartup.map((app) => {
                  const isSelected = selectedToAdd.has(app.id)
                  return (
                    <motion.div
                      key={app.id}
                      {...entranceProps(reduced, { y: 10 })}
                      className={`glass rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 group ${
                        isSelected
                          ? 'border-emerald-500/30 bg-emerald-500/5 ring-1 ring-emerald-500/20'
                          : ''
                      }`}
                    >
                      {/* Checkbox de seleção */}
                      <div className="shrink-0">
                        <button
                          onClick={() => toggleSelectAdd(app.id)}
                          className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-emerald-500 text-white border-emerald-500 shadow-glow-cyan'
                              : 'bg-white/[0.03] border-white/10 text-slate-400 hover:border-white/30 hover:text-white'
                          }`}
                        >
                          {isSelected ? (
                            <CheckCircle2 size={16} fill="white" />
                          ) : (
                            <Square size={16} />
                          )}
                        </button>
                      </div>

                      <div className="flex flex-col md:flex-row md:items-center gap-4 min-w-0 flex-1">
                        <div className="w-11 h-11 rounded-xl bg-white/[0.03] flex items-center justify-center shrink-0">
                          <span className="text-lg">{app.icon}</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="text-sm font-bold text-white truncate" title={app.name}>
                            {app.name}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1.5">
                            <span className={`font-bold ${categoryColor(app.category)}`}>
                              {app.category.toUpperCase()}
                            </span>
                            <span className="w-px h-2 bg-white/10" />
                            <span>Configurado no Hub</span>
                          </div>
                          <code
                            className="text-[10px] text-slate-400 truncate mt-2 block leading-tight"
                            title={app.command}
                          >
                            {app.command}
                          </code>
                        </div>
                      </div>

                      {/* ── Importância (ao adicionar) ────────────────────── */}
                      <div className="flex flex-col md:flex-row md:items-center gap-3 shrink-0 w-full md:w-auto">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Importância
                        </span>
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold border`}
                          style={{ color: labels[appImportance(app)].color }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: labels[appImportance(app)].color }}
                          />
                          {labels[appImportance(app)].label}
                        </span>
                      </div>

                      {/* ── Ação individual ───────────────── */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleAdd(app)}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-bold text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 border border-emerald-500/20 transition-colors"
                        >
                          <Play size={14} /> Adicionar
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.div>

          {/* ── Legenda de importância ───────────────────── */}
          <motion.div
            {...entranceProps(reduced)}
            className="glass rounded-2xl p-5 flex flex-wrap gap-3 items-center border-l-4 border-neon-purple/50"
          >
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-3">
              Níveis de importância
            </span>
            {IMPORTANCE_LEVELS.map((l) => {
              const m = labels[l]
              return (
                <span key={l} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: m.color }} />
                  <span className="text-[11px] font-bold text-slate-300">{m.label}</span>
                  <span className="text-[10px] text-slate-400">{m.subtitle}</span>
                </span>
              )
            })}
          </motion.div>
        </>
      )}

      {/* ── Aba: Atualizações (winget) — montada na 1ª visita e mantida montada ── */}
      {atualizacoesMounted && (
        <div className={activeTab === 'atualizacoes' ? '' : 'hidden'}>
          <PcUpdates />
        </div>
      )}

      {/* ── Aba: Limpeza (temporários do sistema) ────────── */}
      {activeTab === 'limpeza' && <PcCleanup />}
    </div>
  )
}
