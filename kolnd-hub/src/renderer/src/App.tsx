import { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { Layout } from './components/Layout'
import { Dashboard } from './components/Dashboard'
import { Settings } from './components/Settings'
import { Inicializacao } from './components/Inicializacao'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoadingScreen } from './components/LoadingScreen'
import { FirstRunInstall } from './components/FirstRunInstall'
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

function isFirstRunFromQuery(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('first-run') === '1'
  } catch {
    return false
  }
}

function App(): JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [appStates, setAppStates] = useState<Record<string, AppState>>({})
  const [apps, setApps] = useState<AppConfig[]>(defaultApps)
  const [notice, setNotice] = useState<Notice | null>(null)
  // A loading screen só sai quando DOIS eventos ocorreram:
  //  1. os dados essenciais terminaram de carregar (perfil, inicialização, status);
  //  2. a animação de carregamento concluiu (evita que a tela suma num flash).
  const [dataReady, setDataReady] = useState(false)
  const [animationDone, setAnimationDone] = useState(false)
  const isLoading = !dataReady || !animationDone
  const handleLoadingReady = useCallback((): void => setAnimationDone(true), [])
  const [pcName, setPcName] = useState<string | null>(null)
  const [bgProcesses, setBgProcesses] = useState<SystemProcess[]>([])
  const [startupItems, setStartupItems] = useState<StartupItem[]>([])
  const [startupImportance, setStartupImportance] = useState<Record<string, ImportanceLevel>>({})
  const [isFirstRun, setIsFirstRun] = useState<boolean>(isFirstRunFromQuery())
  const [exitModalOpen, setExitModalOpen] = useState<boolean>(false)

  // Aplica o caminho resolvido do KLOUD_GAMES.exe na config do app (e persiste),
  // para que abrir/fechar pelo Hub funcione sempre com o caminho real.
  const applyKloudGamesConfig = useCallback((exePath: string): void => {
    const dir = exePath.replace(/[\\/][^\\/]*$/, '')
    const command = `"${exePath}"`
    setApps((prev) => {
      const next = prev.map((a) => (a.id === 'kloud-games' ? { ...a, command, cwd: dir } : a))
      localStorage.setItem('kolnd-hub-apps', JSON.stringify(next))
      return next
    })
  }, [])

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
        const parsed = JSON.parse(saved) as AppConfig[]

        // Old defaults → new bundled paths. Only entries that still hold the
        // old default values are migrated; anything the user customized is
        // left untouched.
        const legacyDefaults: Record<string, Array<{ command: string; cwd: string }>> = {
          'mark-lvi': [{ command: 'py main.py', cwd: '../Mark-LVI' }],
          'kloud-games': [
            { command: 'kloud-games.exe', cwd: '../kloud-games' },
            // MSI-era default: jogo instalado pelo Hub na 1ª execução
            { command: 'KLOUD_GAMES.exe', cwd: 'resources/programs/kloud-games' }
          ]
        }

        const migrate = (a: AppConfig): AppConfig => {
          const legacy = (legacyDefaults[a.id] ?? []).find(
            (l) => l.command === a.command && l.cwd === a.cwd
          )
          if (legacy) {
            const def = defaultApps.find((d) => d.id === a.id)
            return def ? { ...def, ...a, command: def.command, cwd: def.cwd } : a
          }
          return a
        }

        // Merge saved values onto the current defaults so apps added in newer
        // versions appear too, instead of localStorage hiding them forever.
        const merged = defaultApps.map((def) => {
          const savedApp = parsed.find((a) => a.id === def.id)
          return savedApp ? migrate({ ...def, ...savedApp }) : def
        })
        const mergedIds = new Set(merged.map((a) => a.id))
        setApps([...merged, ...parsed.map(migrate).filter((a) => !mergedIds.has(a.id))])
      } catch {
        // Ignore corrupted data
      }
    }
  }, [])

  // Kloud Games: revalida os caminhos salvos em resources/programs/kloud-games
  // (kloud-games.paths.json) e ajusta a config do app para o caminho real do .exe.
  useEffect(() => {
    window.api
      .kloudGamesStatus()
      .then((status) => {
        if (status.exePath) applyKloudGamesConfig(status.exePath)
      })
      .catch(() => {
        // Sem status: mantém os defaults (%ProgramFiles%\KLOUD_GAMES).
      })
  }, [applyKloudGamesConfig])

  // Nome do computador (exibe na aba lateral e na página de inicialização).
  useEffect(() => {
    window.api.systemPcName().then(setPcName).catch(() => setPcName(null))
  }, [])

  // ── Carregamento inicial (tela de loading) ────────────────────────
  // Mantém a tela de loading visível até que os dados essenciais para
  // todas as funcionalidades estejam disponíveis, evitando travamentos
  // e engasgos ao usar o hub.
  useEffect(() => {
    let mounted = true

    const init = async (): Promise<void> => {
      await Promise.allSettled([
        // Perfil do sistema (nome do PC, usado na sidebar e inicialização).
        window.api.systemPcName().then((name) => {
          if (mounted) setPcName(name)
        }),
        // Programas configurados para iniciar com o PC.
        window.api.startupList().then((items) => {
          if (mounted) setStartupItems(items)
        }),
        // Status inicial de todos os apps gerenciados pelo Hub.
        window.api.getAllStatus().then((status) => {
          if (mounted) {
            setAppStates(status as Record<string, AppState>)
          }
        })
      ])

      if (mounted) setDataReady(true)
    }

    init()

    return (): void => {
      mounted = false
    }
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
    let items: StartupItem[] = []
    try {
      items = await window.api.startupList()
    } catch (err) {
      setNotice({
        id: Date.now(),
        text: `Não foi possível listar a inicialização: ${err instanceof Error ? err.message : String(err)}`
      })
    }
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

  // Remove vários itens da inicialização em lote.
  const handleRemoveBatchStartup = useCallback(
    async (items: StartupItem[]): Promise<void> => {
      const result = await window.api.startupRemoveBatch(items)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível remover alguns itens da inicialização: ${result.errors.join(', ')}`
        })
        return
      }
      await loadStartupItems()
    },
    [loadStartupItems]
  )

  // Verifica se um app configurado no Hub já está na inicialização do Windows.
  const isAppInStartup = useCallback(
    (app: AppConfig, items: StartupItem[]): boolean => {
      const exe = executableName(app.command)
      if (!exe) return false
      return items.some(
        (item) =>
          executableName(item.path) === exe ||
          executableName(item.name) === exe
      )
    },
    []
  )

  // Apps configurados no Hub que ainda não iniciam com o PC.
  const appsNotInStartup = useMemo(() => {
    return defaultApps.filter((app) => !isAppInStartup(app, startupItems))
  }, [startupItems, isAppInStartup])

  const handleAddStartup = useCallback(
    async (app: AppConfig): Promise<void> => {
      const result = await window.api.startupAdd({
        name: app.name,
        path: app.command
      })
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível adicionar "${app.name}" à inicialização: ${result.error ?? 'erro desconhecido'}`
        })
        return
      }
      await loadStartupItems()
    },
    [loadStartupItems]
  )

  // Adiciona vários apps à inicialização em lote.
  const handleAddBatchStartup = useCallback(
    async (apps: AppConfig[]): Promise<void> => {
      const result = await window.api.startupAddBatch(
        apps.map((a) => ({ name: a.name, path: a.command }))
      )
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível adicionar alguns apps à inicialização: ${result.errors.join(', ')}`
        })
        return
      }
      await loadStartupItems()
    },
    [loadStartupItems]
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
      // Kloud Games: procura o .exe; se não existir, abre o MSI embutido
      // para instalação e salva os caminhos detectados.
      if (app.id === 'kloud-games') {
        const result = await window.api.kloudGamesLaunch()
        if (!result.success) {
          setNotice({
            id: Date.now(),
            text: `Não foi possível iniciar ${app.name}: ${result.error ?? 'erro desconhecido'}`
          })
          return
        }
        if (result.exePath) applyKloudGamesConfig(result.exePath)
        if (result.installedNow) {
          setNotice({ id: Date.now(), text: 'Kloud Games foi instalado e iniciado.' })
        }
        return
      }

      const result = await window.api.launchApp(app.id, app.command, app.cwd)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível iniciar ${app.name}: ${result.error ?? 'erro desconhecido'}`
        })
      }
    },
    [applyKloudGamesConfig]
  )

  const handleStop = useCallback(
    async (appId: string): Promise<void> => {
      const app = apps.find((a) => a.id === appId)
      const result = await window.api.stopApp(appId, app?.command)
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: `Não foi possível parar o programa: ${result.error ?? 'erro desconhecido'}`
        })
      } else {
        // Atualiza a UI imediatamente para processos encerrados fora do Hub.
        setAppStates((prev) => ({
          ...prev,
          [appId]: { ...prev[appId], status: 'stopped' }
        }))
      }
    },
    [apps]
  )

  const handleSaveApps = useCallback((updatedApps: AppConfig[]): void => {
    setApps(updatedApps)
    localStorage.setItem('kolnd-hub-apps', JSON.stringify(updatedApps))
  }, [])

  // Solicita ao processo principal que encerre tudo (processos, servidores,
  // segundo plano) e feche o Hub completamente.
  const handleExit = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.shutdownHub()
      if (!result.success) {
        setNotice({
          id: Date.now(),
          text: 'Não foi possível encerrar o Hub completamente.'
        })
      }
    } catch (err) {
      setNotice({
        id: Date.now(),
        text: `Erro ao encerrar o Hub: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }, [])

  const saveDefaultAppConfigs = useCallback((): void => {
    setApps(defaultApps)
    localStorage.setItem('kolnd-hub-apps', JSON.stringify(defaultApps))
  }, [])

  const runningCount = Object.values(effectiveStates).filter((s) => s.status === 'running').length

  return (
    <>
      {/* ── Tela de primeira execução ─────────────────── */}
      {isFirstRun ? (
        <FirstRunInstall
          onComplete={() => {
            saveDefaultAppConfigs()
            setIsFirstRun(false)
            // Vai direto para o Hub: a animação da loading screen só faz
            // sentido na abertura do app, não após a primeira execução.
            setAnimationDone(true)
          }}
        />
      ) : isLoading ? (
        <LoadingScreen onReady={handleLoadingReady} />
      ) : (
        <>
          <Layout
            currentPage={currentPage}
            onNavigate={setCurrentPage}
            runningCount={runningCount}
            pcName={pcName}
            onExit={() => setExitModalOpen(true)}
          >
            {currentPage === 'dashboard' ? (
              <Dashboard
                apps={apps}
                appStates={effectiveStates}
                onLaunch={handleLaunch}
                onStop={handleStop}
              />
            ) : currentPage === 'inicializacao' ? (
              <ErrorBoundary>
                <Inicializacao
                  pcName={pcName ?? ''}
                  items={startupItems}
                  importance={startupImportance}
                  labels={IMPORTANCE_LABELS}
                  onRemove={handleRemoveStartup}
                  onRemoveBatch={handleRemoveBatchStartup}
                  onAdd={handleAddStartup}
                  onAddBatch={handleAddBatchStartup}
                  onReload={loadStartupItems}
                  appsNotInStartup={appsNotInStartup}
                />
              </ErrorBoundary>
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

          {/* ── Modal: confirmação de saída ──────────────── */}
          {exitModalOpen && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center"
              onClick={(e) => {
                if (e.target === e.currentTarget) setExitModalOpen(false)
              }}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div
                className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-[#0f1117]/95 p-6 shadow-2xl backdrop-blur-xl"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle size={24} className="mt-0.5 shrink-0 text-red-400" />
                  <div>
                    <h2 className="text-lg font-bold text-white">Encerrar Kolnd Hub?</h2>
                    <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                      Todos os programas e servidores iniciados pelo Hub serão fechados,
                      incluindo o que estiver rodando em segundo plano. Nada do Kolnd Hub
                      permanecerá aberto.
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    onClick={() => setExitModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
                  >
                    Não
                  </button>
                  <button
                    onClick={handleExit}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-500 shadow-glow-red transition-colors"
                  >
                    Sim, encerrar
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

export default App
