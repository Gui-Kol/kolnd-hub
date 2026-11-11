import { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { Layout } from './components/Layout'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/Settings'
import { Inicializacao } from './components/Inicializacao'
import { apps as defaultApps } from './config/apps'
import {
  AppConfig,
  AppState,
  Page,
  SystemProcess,
  ImportanceLevel,
  StartupItem,
  IMPORTANCE_LABELS
} from './types'
import { executableName, matchesProcess, classifyImportance } from './lib/startup'

interface Notice {
  id: number
  text: string
}

function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [appStates, setAppStates] = useState<Record<string, AppState>>({})
  const [apps, setApps] = useState<AppConfig[]>(defaultApps)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pcName, setPcName] = useState<string | null>(null)
  const [bgProcesses, setBgProcesses] = useState<SystemProcess[]>([])
  const [startupItems, setStartupItems] = useState<StartupItem[]>([])
  const [startupImportance, setStartupImportance] = useState<Record<string, ImportanceLevel>>({})

  // Auto-dismiss launch/stop error toasts.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 7000)
    return (): void => clearTimeout(timer)
  }, [notice])

  // Load saved app configs from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('kolnd-hub-apps')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setApps(parsed)
      } catch {
        // Ignore corrupted data
      }
    }
  }, [])

  // Nome do computador (exibe na aba lateral e na página de inicialização).
  useEffect(() => {
    window.api.systemPcName().then(setPcName).catch(() => setPcName(null))
  }, [])

  // Poll do status dos processos lançados pelo Hub (a cada 2s).
  useEffect(() => {
    const poll = async (): Promise<void> => {
      try {
        const status = await window.api.getAllStatus()
        setAppStates((prev) => {
          const next = { ...prev }
          for (const [id, state] of Object.entries(status)) {
            next[id] = state as AppState
          }
          return next
        })
      } catch {
        // Ignore polling errors
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return (): void => clearInterval(interval)
  }, [])

  // Poll de processos do sistema em segundo plano (a cada 5s).
  useEffect(() => {
    const poll = async (): Promise<void> => {
      try {
        const procs = await window.api.systemRunningProcesses()
        setBgProcesses(procs as SystemProcess[])
      } catch {
        // Ignore polling errors
      }
    }

    poll()
    const interval = setInterval(poll, 5000)
    return (): void => clearInterval(interval)
  }, [])

  // Listen for real-time status changes from main process
  useEffect(() => {
    const unsub = window.api.onStatusChanged((appId, status) => {
      setAppStates((prev) => ({
        ...prev,
        [appId]: { ...prev[appId], status: status as AppState['status'] }
      }))
    })
    return unsub
  }, [])

  // ── Itens de inicialização do PC ──────────────────────────────
  const loadStartupItems = useCallback(async (): Promise<void> => {
    const items = await window.api.startupList()
    setStartupItems(items)

    let map: Record<string, ImportanceLevel> = {}
    try {
      const saved = localStorage.getItem('kolnd-hub-startup-importance')
      map = saved ? JSON.parse(saved) : {}
    } catch {
      // Ignore corrupted data
    }

    const next: Record<string, ImportanceLevel> = {}
    for (const item of items) {
      next[item.id] = map[item.id] ?? classifyImportance(item)
    }
    setStartupImportance(next)
  }, [])

  useEffect(() => {
    loadStartupItems()
  }, [loadStartupItems])

  const handleRemoveStartup = useCallback(
    async (item: StartupItem): Promise<void> => {
      if (
        !window.confirm(
          `Remover "${item.name}" da inicialização do ${pcName ?? 'este PC'}?`
        )
      ) {
        return
      }

      const result = await window.api.startupRemove(item)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível remover da inicialização: ${result.error ?? 'erro desconhecido'}`
        })
        return
      }

      await loadStartupItems()
    },
    [pcName, loadStartupItems]
  )

  const handleImportanceChange = useCallback(
    (itemId: string, level: ImportanceLevel): void => {
      setStartupImportance((prev) => {
        const next = { ...prev, [itemId]: level }
        localStorage.setItem('kolnd-hub-startup-importance', JSON.stringify(next))
        return next
      })
    },
    []
  )

  // ── Estado efetivo de cada app ────────────────────────────────
  // Prioridade: processo lançado pelo Hub > detectado em segundo plano > parado.
  const appEffectiveState = useCallback(
    (app: AppConfig): AppState => {
      const hub = appStates[app.id]
      if (hub?.status === 'running') {
        return { ...hub, source: 'hub' }
      }

      const runningInBackground = bgProcesses.some((p) => matchesProcess(app, p))
      if (runningInBackground) {
        return { status: 'running', source: 'background' }
      }

      return hub ?? { status: 'stopped' }
    },
    [appStates, bgProcesses]
  )

  const effectiveStates = useMemo(() => {
    const map: Record<string, AppState> = {}
    for (const app of apps) {
      map[app.id] = appEffectiveState(app)
    }
    return map
  }, [apps, appEffectiveState])

  const handleLaunch = useCallback(
    async (app: AppConfig): Promise<void> => {
      const result = await window.api.launchApp(app.id, app.command, app.cwd)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível iniciar ${app.name}: ${result.error ?? 'erro desconhecido'}`
        })
      }
    },
    []
  )

  const handleStop = useCallback(async (appId: string): Promise<void> => {
    const result = await window.api.stopApp(appId)
    if (!result.success) {
      setNotice({
        id: Date.now(),
        text: `Não foi possível parar o programa: ${result.error ?? 'erro desconhecido'}`
      })
    }
  }, [])

  const handleSaveApps = useCallback((updatedApps: AppConfig[]): void => {
    setApps(updatedApps)
    localStorage.setItem('kolnd-hub-apps', JSON.stringify(updatedApps))
  }, [])

  const runningCount = Object.values(effectiveStates).filter((s) => s.status === 'running').length

  return (
    <>
      <Layout
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        runningCount={runningCount}
        pcName={pcName}
      >
        {currentPage === 'dashboard' ? (
          <Dashboard
            apps={apps}
            appStates={effectiveStates}
            onLaunch={handleLaunch}
            onStop={handleStop}
          />
        ) : currentPage === 'inicializacao' ? (
          <Inicializacao
            pcName={pcName ?? ''}
            items={startupItems}
            importance={startupImportance}
            labels={IMPORTANCE_LABELS}
            onImportanceChange={handleImportanceChange}
            onRemove={handleRemoveStartup}
            onReload={loadStartupItems}
          />
        ) : (
          <Settings apps={apps} onSave={handleSaveApps} />
        )}
      </Layout>

      {/* ── Error toast ──────────────────────────────── */}
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-[60] flex max-w-md items-start gap-3 rounded-xl border border-red-500/25 bg-[#1a1014]/95 px-4 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-400" />
            <p className="text-xs leading-relaxed text-red-100">{notice.text}</p>
            <button
              onClick={() => setNotice(null)}
              className="ml-2 shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:text-white"
              aria-label="Fechar aviso"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export default App
