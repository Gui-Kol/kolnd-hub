import { useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { Monitor, Trash2, RefreshCw, Plus, Play, ArrowUpCircle, Trash } from 'lucide-react'
import { PcUpdates } from './PcUpdates'
import { PcCleanup } from './PcCleanup'
import { Badge, Button, Card, EmptyState } from './ui'
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

// Matiz semântico preservado (13.14): crítico=vermelho→danger · recomendado=âmbar→
// warning · opcional=azul→accent · inútil=cinza→neutral. Sem cores novas.
const IMPORTANCE_BADGE_TONE: Record<ImportanceLevel, 'danger' | 'warning' | 'accent' | 'neutral'> =
  {
    critico: 'danger',
    recomendado: 'warning',
    opcional: 'accent',
    inutil: 'neutral'
  }

const IMPORTANCE_DOT_CLASS: Record<ImportanceLevel, string> = {
  critico: 'bg-danger',
  recomendado: 'bg-warn',
  opcional: 'bg-accent',
  inutil: 'bg-ink-tertiary'
}

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

  const categoryColor = (category: string): string =>
    category === 'ai' ? 'text-accent' : 'text-ink-tertiary'

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ── Header ───────────────────────────────────── */}
      <motion.div
        {...entranceProps(reduced, { y: -10 })}
        className="flex flex-col justify-between gap-4 md:flex-row md:items-center"
      >
        <div className="space-y-1">
          <h2 className="flex items-center gap-3 text-[28px] font-bold leading-9 tracking-tight text-ink-primary md:text-[32px] md:leading-10">
            <Monitor size={24} className="shrink-0 text-accent" aria-hidden="true" />
            {pcName}
          </h2>
          <p className="text-[13px] text-ink-secondary">Manutenção e inicialização do seu PC</p>
        </div>

        {activeTab === 'inicializacao' && (
          <Button
            variant="primary"
            size="md"
            onClick={handleRefresh}
            disabled={refreshing}
            className="shadow-elevation-1"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
            {refreshing ? 'Atualizando...' : 'Sincronizar'}
          </Button>
        )}
      </motion.div>

      {/* ── Abas do hub "Manutenção do PC" ─────────────── */}
      <div
        role="tablist"
        aria-label="Seções do PC"
        className="flex flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-surface-1 p-1.5 sm:flex-row"
      >
        {PC_TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => goToTab(id)}
              className={`flex flex-1 items-center justify-center gap-2.5 rounded-control border px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors duration-2 ${
                active
                  ? 'border-accent-border bg-accent-muted text-accent'
                  : 'border-transparent text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
              }`}
            >
              <Icon size={16} className="shrink-0" aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>

      {/* ── Aba: Inicialização (conteúdo original, intacto) ── */}
      {activeTab === 'inicializacao' && (
        <>
          {/* ── Seção: iniciam com o PC ──────────────────── */}
          <motion.section {...entranceProps(reduced, { y: 10 })} className="space-y-3">
            {/* Cabeçalho com controles de lote */}
            <Card
              className={`flex flex-col justify-between gap-4 p-5 md:flex-row md:items-center ${
                selectedToRemove.size > 0 ? 'border-danger-border bg-danger-bg' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-accent">
                  <Monitor size={16} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary">
                    Iniciam com o {pcName} ({items.length})
                  </h3>
                  {selectedToRemove.size > 0 && (
                    <Badge tone="danger" className="mt-1.5">
                      {selectedToRemove.size} selecionado{selectedToRemove.size > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex w-full items-center gap-2 md:w-auto">
                {selectedToRemove.size > 0 ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={clearSelectRemove}>
                      Limpar seleção
                    </Button>
                    <Button variant="danger" size="sm" onClick={handleRemoveBatch}>
                      <Trash size={14} aria-hidden="true" /> Remover selecionados (
                      {selectedToRemove.size})
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={isRemoveSelectedAll ? clearSelectRemove : selectAllRemove}
                  >
                    {isRemoveSelectedAll ? 'Selecionar nada' : 'Selecionar tudo'}
                  </Button>
                )}
              </div>
            </Card>

            {items.length === 0 ? (
              <EmptyState
                icon={Monitor}
                tone="muted"
                title={`Nenhum título configurado para iniciar com o ${pcName}.`}
                className="border-dashed p-10"
              />
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
                      className={`group flex flex-col justify-between gap-4 rounded-card border bg-surface-1 p-4 transition-colors duration-2 md:flex-row md:items-center ${
                        isSelected
                          ? 'border-danger-border bg-danger-bg'
                          : 'border-[var(--border-subtle)]'
                      }`}
                    >
                      {/* Checkbox de seleção */}
                      <div className="flex shrink-0 items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRemove(item.id)}
                          aria-label={`Selecionar ${item.name}`}
                          className="h-5 w-5 shrink-0 accent-accent"
                        />
                      </div>

                      {/* ── Nome / caminho / local ─────────── */}
                      <div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-center">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2">
                          <Monitor size={20} className="text-ink-tertiary" aria-hidden="true" />
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <div
                            className="truncate text-sm font-semibold text-ink-primary"
                            title={item.name}
                          >
                            {item.name}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-tertiary">
                            <span className="flex items-center gap-1">
                              {STARTUP_LOCATION_LABEL[item.location]}
                            </span>
                            <span
                              aria-hidden="true"
                              className="h-2 w-px bg-[var(--border-subtle)]"
                            />
                            <span>{STARTUP_SCOPE_LABEL[item.scope]}</span>
                          </div>
                          <code
                            className="mt-2 block truncate font-mono text-[10px] leading-tight text-ink-tertiary"
                            title={item.path}
                          >
                            {item.path}
                          </code>
                        </div>
                      </div>

                      {/* ── Importância (somente leitura) ────────────────────── */}
                      <div className="flex w-full shrink-0 flex-col gap-3 md:w-auto md:flex-row md:items-center">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                          Importância
                        </span>
                        <Badge tone={IMPORTANCE_BADGE_TONE[level]}>
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-pill ${IMPORTANCE_DOT_CLASS[level]}`}
                          />
                          {meta.label}
                        </Badge>
                      </div>

                      {/* ── Ação individual ───────────────── */}
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="subtle-danger"
                          size="sm"
                          onClick={() => handleRemove(item)}
                        >
                          <Trash2 size={14} aria-hidden="true" /> Remover
                        </Button>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.section>

          {/* ── Seção: não iniciam com o PC ────────────────── */}
          <motion.section {...entranceProps(reduced, { y: 10 })} className="space-y-3">
            <Card
              className={`flex flex-col justify-between gap-4 p-5 md:flex-row md:items-center ${
                selectedToAdd.size > 0 ? 'border-success-border bg-success-bg' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-success">
                  <Plus size={16} aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-ink-primary">
                    Não iniciam com o {pcName} ({appsNotInStartup.length})
                  </h3>
                  {selectedToAdd.size > 0 && (
                    <Badge tone="success" className="mt-1.5">
                      {selectedToAdd.size} selecionado{selectedToAdd.size > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex w-full items-center gap-2 md:w-auto">
                {selectedToAdd.size > 0 ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={clearSelectAdd}>
                      Limpar seleção
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleAddBatch}>
                      <Plus size={14} aria-hidden="true" /> Adicionar selecionados (
                      {selectedToAdd.size})
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={isAddSelectedAll ? clearSelectAdd : selectAllAdd}
                  >
                    {isAddSelectedAll ? 'Selecionar nada' : 'Selecionar tudo'}
                  </Button>
                )}
              </div>
            </Card>

            {appsNotInStartup.length === 0 ? (
              <EmptyState
                icon={Play}
                tone="success"
                title={`Todos os títulos já iniciam com o ${pcName}! 🎮`}
                className="border-dashed border-success-border p-10"
              />
            ) : (
              <div className="space-y-3">
                {appsNotInStartup.map((app) => {
                  const isSelected = selectedToAdd.has(app.id)
                  const appLevel = appImportance(app)
                  return (
                    <motion.div
                      key={app.id}
                      {...entranceProps(reduced, { y: 10 })}
                      className={`group flex flex-col justify-between gap-4 rounded-card border bg-surface-1 p-4 transition-colors duration-2 md:flex-row md:items-center ${
                        isSelected
                          ? 'border-success-border bg-success-bg'
                          : 'border-[var(--border-subtle)]'
                      }`}
                    >
                      {/* Checkbox de seleção */}
                      <div className="flex shrink-0 items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectAdd(app.id)}
                          aria-label={`Selecionar ${app.name}`}
                          className="h-5 w-5 shrink-0 accent-accent"
                        />
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col gap-4 md:flex-row md:items-center">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2">
                          <span className="text-lg" aria-hidden="true">
                            {app.icon}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <div
                            className="truncate text-sm font-semibold text-ink-primary"
                            title={app.name}
                          >
                            {app.name}
                          </div>
                          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-tertiary">
                            <span className={`font-semibold ${categoryColor(app.category)}`}>
                              {app.category.toUpperCase()}
                            </span>
                            <span
                              aria-hidden="true"
                              className="h-2 w-px bg-[var(--border-subtle)]"
                            />
                            <span>Configurado no Hub</span>
                          </div>
                          <code
                            className="mt-2 block truncate font-mono text-[10px] leading-tight text-ink-tertiary"
                            title={app.command}
                          >
                            {app.command}
                          </code>
                        </div>
                      </div>

                      {/* ── Importância (ao adicionar) ────────────────────── */}
                      <div className="flex w-full shrink-0 flex-col gap-3 md:w-auto md:flex-row md:items-center">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                          Importância
                        </span>
                        <Badge tone={IMPORTANCE_BADGE_TONE[appLevel]}>
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-pill ${IMPORTANCE_DOT_CLASS[appLevel]}`}
                          />
                          {labels[appLevel].label}
                        </Badge>
                      </div>

                      {/* ── Ação individual ───────────────── */}
                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="primary" size="sm" onClick={() => handleAdd(app)}>
                          <Play size={14} aria-hidden="true" /> Adicionar
                        </Button>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.section>

          {/* ── Legenda de importância ───────────────────── */}
          <motion.div
            {...entranceProps(reduced)}
            className="flex flex-wrap items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-surface-1 p-5"
          >
            <span aria-hidden="true" className="h-6 w-[3px] rounded-pill bg-accent" />
            <span className="mr-3 text-[10px] font-semibold uppercase tracking-widest text-ink-tertiary">
              Níveis de importância
            </span>
            {IMPORTANCE_LEVELS.map((l) => {
              const m = labels[l]
              return (
                <span key={l} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-pill ${IMPORTANCE_DOT_CLASS[l]}`}
                  />
                  <span className="text-[11px] font-semibold text-ink-secondary">{m.label}</span>
                  <span className="text-[10px] text-ink-tertiary">{m.subtitle}</span>
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
